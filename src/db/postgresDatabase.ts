import "dotenv/config";

import fs from "fs/promises";
import path from "path";

import { Pool } from "pg";

import { type JobDetails, type JobSearchListing, type TopMatch } from "../seek/types";
import { logger } from "../utils/logger";
import {
  AppliedLogEntrySchema,
  type AppliedLogEntry,
  JobRecordSchema,
  type JobRecord,
} from "./schema";

const REPORT_TIMEZONE = "Australia/Adelaide";
const TERMINAL_STATUSES: JobRecord["status"][] = ["applied", "external", "queued", "duplicate"];
const MIGRATIONS_DIR = path.resolve(process.cwd(), "src", "db", "migrations");
const SEEK_MIGRATION_FILES = [
  "V4__seek_browser_session.sql",
  "V5__seek_jobs.sql",
  "V6__seek_run_sessions.sql",
  "V7__seek_blacklist.sql",
  "V8__updated_at_triggers.sql",
  "V9__reporting_views.sql",
] as const;

type JobStatusCounts = Record<string, number>;

type DbJobRow = {
  id: string;
  seek_url: string;
  title: string;
  company: string;
  location: string;
  salary: string | null;
  posted_date: string | null;
  key_requirements: string | null;
  sponsorship_score: JobRecord["sponsorshipScore"];
  relevance_score: number;
  sponsorship_signals: string[] | null;
  exclude_reasons: string[] | null;
  status: JobRecord["status"];
  applied_at: Date | string | null;
  application_id: string | null;
  cover_letter_used: string | null;
  error_message: string | null;
  notes: string | null;
  scraped_at: Date | string;
  external_url: string | null;
};

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

let initialized = false;
let poolClosed = false;
let migrationBootstrapPromise: Promise<void> | null = null;

const toIsoString = (value: Date | string | null | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const mapRowToJobRecord = (row: DbJobRow): JobRecord =>
  JobRecordSchema.parse({
    id: row.id,
    title: row.title,
    company: row.company,
    location: row.location,
    url: row.seek_url,
    salary: row.salary ?? undefined,
    postedDate: row.posted_date ?? toIsoString(row.scraped_at) ?? new Date().toISOString(),
    scrapedAt: toIsoString(row.scraped_at) ?? new Date().toISOString(),
    sponsorshipScore: row.sponsorship_score,
    relevanceScore: row.relevance_score,
    sponsorshipSignals: row.sponsorship_signals ?? [],
    excludeReasons: row.exclude_reasons ?? [],
    keyRequirements: row.key_requirements ?? "",
    status: row.status,
    appliedAt: toIsoString(row.applied_at),
    applicationId: row.application_id ?? undefined,
    coverLetterUsed: row.cover_letter_used ?? undefined,
    notes: row.notes ?? undefined,
    errorMessage: row.error_message ?? row.external_url ?? undefined,
  });

const getTopMatches = (jobs: JobRecord[]): TopMatch[] =>
  [...jobs]
    .sort((left, right) => right.relevanceScore - left.relevanceScore)
    .slice(0, 3)
    .map((job) => ({
      id: job.id,
      title: job.title,
      company: job.company,
      score: job.relevanceScore,
    }));

const countCookies = (storageStateJson: string): number => {
  try {
    const parsed = JSON.parse(storageStateJson) as { cookies?: unknown[] };
    return Array.isArray(parsed.cookies) ? parsed.cookies.length : 0;
  } catch {
    return 0;
  }
};

const ensureSeekSchema = async (): Promise<void> => {
  if (migrationBootstrapPromise) {
    await migrationBootstrapPromise;
    return;
  }

  migrationBootstrapPromise = (async () => {
    const client = await pool.connect();

    try {
      const tableCheck = await client.query<{ exists: boolean }>(
        `
          SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'seek_browser_session'
          ) AS exists
        `,
      );

      if (tableCheck.rows[0]?.exists) {
        return;
      }

      logger.warn("SEEK persistence tables were missing. Bootstrapping migrations V4-V9 now.");

      await client.query("BEGIN");

      for (const fileName of SEEK_MIGRATION_FILES) {
        const sql = await fs.readFile(path.join(MIGRATIONS_DIR, fileName), "utf8");
        await client.query(sql);
        await upsertFlywayHistory(client, fileName);
      }

      await client.query("COMMIT");
      logger.info("SEEK persistence schema bootstrapped successfully.");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      logger.error("Failed to bootstrap SEEK persistence schema", { error });
      throw error;
    } finally {
      client.release();
    }
  })();

  try {
    await migrationBootstrapPromise;
  } finally {
    migrationBootstrapPromise = null;
  }
};

const upsertFlywayHistory = async (client: { query: Pool["query"] }, fileName: string): Promise<void> => {
  const match = /^V(\d+)__(.+)\.sql$/i.exec(fileName);
  if (!match) {
    return;
  }

  const version = match[1];
  const description = match[2].replace(/_/g, " ");

  const historyTableExists = await client.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'flyway_schema_history'
      ) AS exists
    `,
  );

  if (!historyTableExists.rows[0]?.exists) {
    return;
  }

  const alreadyRecorded = await client.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM flyway_schema_history
        WHERE version = $1
      ) AS exists
    `,
    [version],
  );

  if (alreadyRecorded.rows[0]?.exists) {
    return;
  }

  const rankResult = await client.query<{ next_rank: number }>(
    "SELECT COALESCE(MAX(installed_rank), 0) + 1 AS next_rank FROM flyway_schema_history",
  );

  await client.query(
    `
      INSERT INTO flyway_schema_history (
        installed_rank,
        version,
        description,
        type,
        script,
        checksum,
        installed_by,
        installed_on,
        execution_time,
        success
      ) VALUES (
        $1,
        $2,
        $3,
        'SQL',
        $4,
        NULL,
        CURRENT_USER,
        NOW(),
        0,
        TRUE
      )
    `,
    [rankResult.rows[0]?.next_rank ?? 1, version, description, fileName],
  );
};

const persistJobRecord = async (record: JobRecord): Promise<void> => {
  const externalUrl = record.status === "external" ? record.errorMessage ?? null : null;
  const errorMessage = record.status === "external" ? null : record.errorMessage ?? null;

  await pool.query(
    `
      INSERT INTO seek_job (
        id,
        seek_url,
        title,
        company,
        location,
        salary,
        posted_date,
        key_requirements,
        sponsorship_score,
        relevance_score,
        sponsorship_signals,
        exclude_reasons,
        status,
        applied_at,
        application_id,
        cover_letter_used,
        external_url,
        error_message,
        notes,
        scraped_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9::seek_sponsorship_score, $10,
        $11, $12, $13::seek_job_status, $14, $15, $16, $17, $18, $19, $20
      )
      ON CONFLICT (id) DO UPDATE SET
        seek_url = EXCLUDED.seek_url,
        title = EXCLUDED.title,
        company = EXCLUDED.company,
        location = EXCLUDED.location,
        salary = EXCLUDED.salary,
        posted_date = EXCLUDED.posted_date,
        key_requirements = EXCLUDED.key_requirements,
        sponsorship_score = EXCLUDED.sponsorship_score,
        relevance_score = EXCLUDED.relevance_score,
        sponsorship_signals = EXCLUDED.sponsorship_signals,
        exclude_reasons = EXCLUDED.exclude_reasons,
        status = EXCLUDED.status,
        applied_at = EXCLUDED.applied_at,
        application_id = EXCLUDED.application_id,
        cover_letter_used = EXCLUDED.cover_letter_used,
        external_url = EXCLUDED.external_url,
        error_message = EXCLUDED.error_message,
        notes = EXCLUDED.notes,
        scraped_at = EXCLUDED.scraped_at,
        updated_at = NOW()
    `,
    [
      record.id,
      record.url,
      record.title,
      record.company,
      record.location,
      record.salary ?? null,
      record.postedDate,
      record.keyRequirements,
      record.sponsorshipScore,
      record.relevanceScore,
      record.sponsorshipSignals,
      record.excludeReasons,
      record.status,
      record.appliedAt ?? null,
      record.applicationId ?? null,
      record.coverLetterUsed ?? null,
      externalUrl,
      errorMessage,
      record.notes ?? null,
      record.scrapedAt,
    ],
  );
};

export const createJobRecordFromListing = (
  listing: JobSearchListing,
  overrides: Partial<JobRecord> = {},
): JobRecord =>
  JobRecordSchema.parse({
    id: listing.id,
    title: listing.title,
    company: listing.company,
    location: listing.location,
    url: listing.url,
    salary: listing.salary,
    postedDate: listing.listedAt ?? new Date().toISOString(),
    scrapedAt: new Date().toISOString(),
    sponsorshipScore: "silent",
    relevanceScore: 0,
    sponsorshipSignals: [],
    excludeReasons: [],
    keyRequirements: listing.teaser,
    status: "pending",
    ...overrides,
  });

export const createJobRecord = (job: JobDetails, overrides: Partial<JobRecord> = {}): JobRecord =>
  JobRecordSchema.parse({
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.location,
    url: job.url,
    salary: job.salary,
    postedDate: job.postedDate,
    scrapedAt: job.scrapedAt,
    sponsorshipScore: job.sponsorshipScore,
    relevanceScore: job.relevanceScore ?? 0,
    sponsorshipSignals: job.sponsorshipSignals,
    excludeReasons: job.excludeReasons,
    keyRequirements: job.keyRequirements,
    status: "pending",
    notes: job.relevanceRationale,
    ...overrides,
  });

export async function init(): Promise<void> {
  if (initialized) {
    return;
  }

  try {
    await pool.query("SELECT 1");
    await ensureSeekSchema();
    initialized = true;
    logger.info("SEEK PostgreSQL persistence initialized.");
  } catch (error) {
    logger.error("Failed to initialize SEEK PostgreSQL persistence", { error });
    throw error;
  }
}

export async function saveSession(storageStateJson: string): Promise<void> {
  await init();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("UPDATE seek_browser_session SET is_active = FALSE, updated_at = NOW() WHERE is_active = TRUE");
    await client.query(
      `
        INSERT INTO seek_browser_session (
          storage_state_json,
          cookie_count,
          is_active
        ) VALUES ($1, $2, TRUE)
      `,
      [storageStateJson, countCookies(storageStateJson)],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error("Failed to save SEEK browser session", { error });
    throw error;
  } finally {
    client.release();
  }
}

export async function loadSession(): Promise<string | null> {
  await init();
  const result = await pool.query<{
    storage_state_json: string;
    age_days: number | null;
  }>(
    `
      SELECT
        storage_state_json,
        EXTRACT(DAY FROM NOW() - created_at)::INTEGER AS age_days
      FROM seek_browser_session
      WHERE is_active = TRUE
      ORDER BY updated_at DESC
      LIMIT 1
    `,
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  if (row.age_days !== null && row.age_days > 25) {
    logger.warn("SEEK browser session is getting old and may expire soon.", {
      ageDays: row.age_days,
    });
  }

  return row.storage_state_json;
}

export async function sessionExists(): Promise<boolean> {
  await init();
  const result = await pool.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM seek_browser_session
        WHERE is_active = TRUE
      ) AS exists
    `,
  );

  return Boolean(result.rows[0]?.exists);
}

export async function getSessionAgeDays(): Promise<number | null> {
  await init();
  const result = await pool.query<{ age_days: number | null }>(
    `
      SELECT EXTRACT(DAY FROM NOW() - created_at)::INTEGER AS age_days
      FROM seek_browser_session
      WHERE is_active = TRUE
      ORDER BY updated_at DESC
      LIMIT 1
    `,
  );

  return result.rows[0]?.age_days ?? null;
}

export async function upsertJob(job: Partial<JobRecord> & { id: string }): Promise<void> {
  await init();
  const existing = await getJob(job.id);
  const merged = JobRecordSchema.parse({
    ...existing,
    ...job,
  });

  await persistJobRecord(merged);
}

export async function upsert(record: JobRecord): Promise<JobRecord> {
  await init();
  const validated = JobRecordSchema.parse(record);
  await persistJobRecord(validated);
  return validated;
}

export async function alreadyApplied(jobId: string): Promise<boolean> {
  await init();
  const result = await pool.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM seek_job
        WHERE id = $1
          AND status = ANY($2::seek_job_status[])
      ) AS exists
    `,
    [jobId, TERMINAL_STATUSES],
  );

  return Boolean(result.rows[0]?.exists);
}

export async function getJob(jobId: string): Promise<JobRecord | null> {
  await init();
  const result = await pool.query<DbJobRow>("SELECT * FROM seek_job WHERE id = $1 LIMIT 1", [jobId]);
  const row = result.rows[0];
  return row ? mapRowToJobRecord(row) : null;
}

export async function getById(jobId: string): Promise<JobRecord | undefined> {
  const record = await getJob(jobId);
  return record ?? undefined;
}

export async function updateJobStatus(
  jobId: string,
  status: JobRecord["status"],
  extra: Partial<JobRecord> = {},
): Promise<void> {
  const existing = await getJob(jobId);
  if (!existing) {
    throw new Error(`Cannot update status for unknown job ${jobId}.`);
  }

  await upsertJob({
    ...existing,
    ...extra,
    id: jobId,
    status,
  });
}

export async function getJobsByStatus(status: JobRecord["status"]): Promise<JobRecord[]> {
  await init();
  const result = await pool.query<DbJobRow>(
    `
      SELECT *
      FROM seek_job
      WHERE status = $1
      ORDER BY relevance_score DESC, scraped_at DESC
    `,
    [status],
  );

  return result.rows.map(mapRowToJobRecord);
}

export async function countByStatus(): Promise<JobStatusCounts> {
  await init();
  const result = await pool.query<{ status: string; count: string }>(
    `
      SELECT status::TEXT AS status, COUNT(*)::TEXT AS count
      FROM seek_job
      GROUP BY status
    `,
  );

  return result.rows.reduce<JobStatusCounts>((counts, row) => {
    counts[row.status] = Number(row.count);
    return counts;
  }, {});
}

export async function appendAppliedLog(entry: AppliedLogEntry): Promise<void> {
  await init();
  const validated = AppliedLogEntrySchema.parse(entry);
  const result = await pool.query(
    `
      UPDATE seek_job
      SET
        status = 'applied',
        applied_at = $2,
        relevance_score = $3,
        updated_at = NOW()
      WHERE id = $1
    `,
    [validated.id, validated.appliedAt, validated.relevanceScore],
  );

  if (result.rowCount === 0) {
    logger.warn("Applied-log update skipped because the job row does not exist yet.", {
      jobId: validated.id,
    });
  }
}

export async function getTodayAppliedCount(): Promise<number> {
  await init();
  const result = await pool.query<{ count: string }>(
    `
      SELECT COUNT(*)::TEXT AS count
      FROM seek_job
      WHERE status = 'applied'
        AND applied_at IS NOT NULL
        AND DATE(timezone($1, applied_at)) = DATE(timezone($1, NOW()))
    `,
    [REPORT_TIMEZONE],
  );

  return Number(result.rows[0]?.count ?? 0);
}

export async function getDailySummary(): Promise<{
  applied: number;
  external: number;
  errors: number;
  skipped: number;
  topMatches: TopMatch[];
}> {
  await init();
  const result = await pool.query<DbJobRow>(
    `
      SELECT *
      FROM seek_job
      WHERE DATE(timezone($1, scraped_at)) = DATE(timezone($1, NOW()))
    `,
    [REPORT_TIMEZONE],
  );

  const todayJobs = result.rows.map(mapRowToJobRecord);
  const applied = todayJobs.filter((job) => job.status === "applied").length;
  const external = todayJobs.filter((job) => job.status === "external").length;
  const errors = todayJobs.filter((job) => job.status === "failed").length;
  const skipped = todayJobs.filter((job) => job.status === "skipped" || job.status === "duplicate").length;

  return {
    applied,
    external,
    errors,
    skipped,
    topMatches: getTopMatches(todayJobs),
  };
}

export async function startRunSession(isDryRun: boolean): Promise<number> {
  await init();
  const result = await pool.query<{ id: number }>(
    `
      INSERT INTO seek_run_session (is_dry_run)
      VALUES ($1)
      RETURNING id
    `,
    [isDryRun],
  );

  return result.rows[0].id;
}

export async function finishRunSession(
  runSessionId: number,
  counts: {
    applied: number;
    skipped: number;
    external: number;
    failed: number;
    duplicate: number;
    discovered: number;
  },
  status: "completed" | "failed",
  errorMessage?: string,
): Promise<void> {
  await init();
  await pool.query(
    `
      UPDATE seek_run_session
      SET
        finished_at = NOW(),
        jobs_discovered = $2,
        jobs_applied = $3,
        jobs_skipped = $4,
        jobs_external = $5,
        jobs_failed = $6,
        jobs_duplicate = $7,
        status = CASE
          WHEN is_dry_run = TRUE AND $8 = 'completed' THEN 'dry_run'
          ELSE $8
        END,
        error_message = $9
      WHERE id = $1
    `,
    [
      runSessionId,
      counts.discovered,
      counts.applied,
      counts.skipped,
      counts.external,
      counts.failed,
      counts.duplicate,
      status,
      errorMessage ?? null,
    ],
  );
}

export async function getBlacklist(): Promise<Array<{ type: string; value: string }>> {
  await init();
  const result = await pool.query<{ type: string; value: string }>(
    `
      SELECT entry_type::TEXT AS type, value
      FROM seek_blacklist
      WHERE is_active = TRUE
      ORDER BY entry_type, value
    `,
  );

  return result.rows;
}

export async function addToBlacklist(
  type: "company" | "title_pattern",
  value: string,
  reason?: string,
): Promise<void> {
  await init();
  await pool.query(
    `
      INSERT INTO seek_blacklist (entry_type, value, reason)
      VALUES ($1::seek_blacklist_type, $2, $3)
      ON CONFLICT (entry_type, value) DO NOTHING
    `,
    [type, value, reason ?? null],
  );
}

export async function closePool(): Promise<void> {
  if (poolClosed) {
    return;
  }

  poolClosed = true;
  await pool.end();
}

export const db = {
  init,
  saveSession,
  loadSession,
  sessionExists,
  getSessionAgeDays,
  upsertJob,
  upsert,
  alreadyApplied,
  getJob,
  getById,
  updateJobStatus,
  getJobsByStatus,
  countByStatus,
  appendAppliedLog,
  getTodayAppliedCount,
  getDailySummary,
  startRunSession,
  finishRunSession,
  getBlacklist,
  addToBlacklist,
  closePool,
};

export default db;
