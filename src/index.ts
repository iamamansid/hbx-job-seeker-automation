import cron from "node-cron";
import { type Browser, type BrowserContext, type Page } from "playwright";

import { browserManager } from "./browser/browserManager";
import { createSessionContext, saveSession, sessionExists } from "./browser/sessionManager";
import { SEARCH_QUERIES, seekConfig } from "./config/config";
import { createJobRecord, createJobRecordFromListing, db } from "./db/jobDatabase";
import { blacklistFilter, loadBlacklistFromDb } from "./filters/blacklistFilter";
import { relevanceFilter } from "./filters/relevanceFilter";
import { sponsorshipFilter } from "./filters/sponsorshipFilter";
import { notifier } from "./notifications/notifier";
import { applyToJob } from "./seek/seekApplier";
import { parseSeekJobDetails } from "./seek/seekJobParser";
import { ensureLoggedIn } from "./seek/seekLogin";
import { syncSeekProfile } from "./seek/seekProfileSync";
import { seekSearch } from "./seek/seekSearch";
import { CaptchaDetectedError, type SessionSummary, type TopMatch } from "./seek/types";
import { humanDelay } from "./utils/humanDelay";
import { logger } from "./utils/logger";
import { formatInTimezone } from "./utils/time";

let captchaBlockedUntil = 0;
let runInFlight = false;

const updateTopMatches = (topMatches: TopMatch[], candidate: TopMatch): TopMatch[] =>
  [...topMatches, candidate]
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);

const createEmptySummary = (trigger: "manual" | "cron"): SessionSummary => ({
  trigger,
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  applied: 0,
  external: 0,
  errors: 0,
  skipped: 0,
  duplicates: 0,
  dryRunQueued: 0,
  topMatches: [],
});

const processJob = async (
  page: Page,
  listing: Awaited<ReturnType<typeof seekSearch>>[number],
  summary: SessionSummary,
  counters: { sessionApplied: number; dayApplied: number },
  runCounts: {
    discovered: number;
    applied: number;
    skipped: number;
    external: number;
    failed: number;
    duplicate: number;
  },
): Promise<void> => {
  try {
    const overrideNotes: string[] = [];

    logger.info("Processing SEEK job candidate", {
      jobId: listing.id,
      company: listing.company,
      title: listing.title,
      location: listing.location,
      listedAt: listing.listedAt,
      url: listing.url,
    });

    if (await db.alreadyApplied(listing.id)) {
      await db.upsert(createJobRecordFromListing(listing, { status: "duplicate" }));
      summary.duplicates += 1;
      runCounts.duplicate += 1;
      logger.info("Skipping duplicate SEEK job", {
        jobId: listing.id,
        company: listing.company,
        title: listing.title,
      });
      return;
    }

    const parseStartedAt = Date.now();
    const job = await parseSeekJobDetails(page, listing);
    logger.info("Parsed SEEK job details", {
      jobId: job.id,
      company: job.company,
      title: job.title,
      location: job.location,
      sponsorshipScore: job.sponsorshipScore,
      keyRequirementsPreview: job.keyRequirements.slice(0, 300),
      durationMs: Date.now() - parseStartedAt,
    });

    const blacklistMatch = blacklistFilter(job);
    if (blacklistMatch.blocked) {
      job.excludeReasons = [...new Set([...job.excludeReasons, ...blacklistMatch.reasons])];
      overrideNotes.push(`Blacklist override applied: ${blacklistMatch.reasons.join(", ")}`);
      logger.warn("Blacklist matched, but continuing because apply-all mode is enabled", {
        jobId: job.id,
        company: job.company,
        title: job.title,
        reasons: blacklistMatch.reasons,
      });
    }

    const sponsorshipDecision = sponsorshipFilter(job);
    job.sponsorshipScore = sponsorshipDecision.status;
    job.sponsorshipSignals = sponsorshipDecision.reasons;
    job.excludeReasons = sponsorshipDecision.status === "excluded" ? sponsorshipDecision.reasons : [];

    if (sponsorshipDecision.status === "excluded") {
      overrideNotes.push(`Sponsorship exclusion overridden: ${sponsorshipDecision.reasons.join(", ")}`);
      logger.warn("Sponsorship exclusion matched, but continuing because apply-all mode is enabled", {
        jobId: job.id,
        company: job.company,
        title: job.title,
        sponsorshipStatus: sponsorshipDecision.status,
        reasons: sponsorshipDecision.reasons,
      });
    }

    logger.info("SEEK sponsorship decision completed", {
      jobId: job.id,
      company: job.company,
      title: job.title,
      sponsorshipStatus: sponsorshipDecision.status,
      reasons: sponsorshipDecision.reasons,
    });

    const relevanceStartedAt = Date.now();
    const relevance = await relevanceFilter(job);
    job.relevanceScore = relevance.score;
    job.relevanceRationale = relevance.rationale;
    summary.topMatches = updateTopMatches(summary.topMatches, {
      id: job.id,
      title: job.title,
      company: job.company,
      score: relevance.score,
    });

    if (relevance.score < 50) {
      overrideNotes.push(`Low relevance override applied at ${relevance.score}/100.`);
      logger.warn("Low relevance score detected, but continuing because apply-all mode is enabled", {
        jobId: job.id,
        company: job.company,
        title: job.title,
        heuristicScore: relevance.heuristicScore,
        aiScore: relevance.aiScore,
        finalScore: relevance.score,
        rationale: relevance.rationale,
        concerns: relevance.concerns,
        durationMs: Date.now() - relevanceStartedAt,
      });
    } else {
      logger.info("SEEK job passed filters and is queued for apply flow", {
        jobId: job.id,
        company: job.company,
        title: job.title,
        heuristicScore: relevance.heuristicScore,
        aiScore: relevance.aiScore,
        finalScore: relevance.score,
        rationale: relevance.rationale,
        concerns: relevance.concerns,
        durationMs: Date.now() - relevanceStartedAt,
      });
    }

    logger.info("SEEK job queued for apply flow", {
      jobId: job.id,
      company: job.company,
      title: job.title,
      heuristicScore: relevance.heuristicScore,
      aiScore: relevance.aiScore,
      finalScore: relevance.score,
      rationale: relevance.rationale,
      concerns: relevance.concerns,
      overrideNotes,
      durationMs: Date.now() - relevanceStartedAt,
    });

    await db.upsert(
      createJobRecord(job, {
        status: "applying",
        relevanceScore: relevance.score,
        excludeReasons: job.excludeReasons,
        notes: [relevance.rationale, ...overrideNotes].filter(Boolean).join(" | "),
      }),
    );

    await humanDelay(...seekConfig.timing.betweenApplications);
    const applyStartedAt = Date.now();
    const result = await applyToJob(page, job);
    logger.info("SEEK apply flow returned result", {
      jobId: job.id,
      company: job.company,
      title: job.title,
      resultType: result.type,
      submitted: result.submitted,
      applicationId: result.applicationId,
      confirmationUrl: result.confirmationUrl,
      notes: result.notes,
      stepHistory: result.stepHistory,
      durationMs: Date.now() - applyStartedAt,
    });

    if (result.type === "external") {
      await db.upsert(
        createJobRecord(job, {
          status: "external",
          relevanceScore: relevance.score,
          excludeReasons: job.excludeReasons,
          notes: [result.notes, ...overrideNotes].filter(Boolean).join(" | "),
          errorMessage: result.externalUrl,
        }),
      );
      summary.external += 1;
      runCounts.external += 1;
      logger.info("SEEK job requires external manual application", {
        jobId: job.id,
        company: job.company,
        title: job.title,
        externalUrl: result.externalUrl,
      });
      return;
    }

    if (result.type === "dry-run") {
      await db.upsert(
        createJobRecord(job, {
          status: "queued",
          relevanceScore: relevance.score,
          coverLetterUsed: result.coverLetter,
          excludeReasons: job.excludeReasons,
          notes: [result.notes, ...overrideNotes].filter(Boolean).join(" | "),
        }),
      );
      summary.dryRunQueued += 1;
      logger.info("DRY_RUN queued SEEK job without submission", {
        jobId: job.id,
        company: job.company,
        title: job.title,
        coverLetterLength: result.coverLetter?.length ?? 0,
        notes: result.notes,
        stepHistory: result.stepHistory,
      });
      return;
    }

    counters.sessionApplied += 1;
    counters.dayApplied += 1;
    summary.applied += 1;
    runCounts.applied += 1;

    await db.upsert(
        createJobRecord(job, {
          status: "applied",
          relevanceScore: relevance.score,
          appliedAt: new Date().toISOString(),
          applicationId: result.applicationId,
          coverLetterUsed: result.coverLetter,
          excludeReasons: job.excludeReasons,
          notes: [relevance.rationale, ...overrideNotes].filter(Boolean).join(" | "),
        }),
      );

    await db.appendAppliedLog({
      id: job.id,
      title: job.title,
      company: job.company,
      url: job.url,
      relevanceScore: relevance.score,
      appliedAt: new Date().toISOString(),
    });

    await notifier.sendApplicationSuccess(job.title, job.company, relevance.score);
    logger.info("Applied successfully to SEEK job", {
      jobId: job.id,
      company: job.company,
      title: job.title,
      relevanceScore: relevance.score,
    });
  } catch (error) {
    summary.errors += 1;
    runCounts.failed += 1;

    await db.upsert(
      createJobRecordFromListing(listing, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        notes: "Application attempt failed.",
      }),
    );

    if (error instanceof CaptchaDetectedError) {
      throw error;
    }

    logger.error("Failed to process job listing", {
      error,
      jobId: listing.id,
      company: listing.company,
      title: listing.title,
    });
  }
};

export const run = async (trigger: "manual" | "cron" = "manual"): Promise<SessionSummary> => {
  const summary = createEmptySummary(trigger);
  const runCounts = {
    discovered: 0,
    applied: 0,
    skipped: 0,
    external: 0,
    failed: 0,
    duplicate: 0,
  };

  if (!(await sessionExists())) {
    logger.error(
      "No active SEEK session found in PostgreSQL. Run `npm run login-setup` before starting the bot.",
    );
    process.exit(1);
  }

  if (runInFlight) {
    logger.warn("A SEEK session is already in progress; skipping overlapping trigger.", { trigger });
    return summary;
  }

  if (captchaBlockedUntil > Date.now()) {
    logger.warn("SEEK session skipped because CAPTCHA cooldown is active.", {
      trigger,
      blockedUntil: formatInTimezone(new Date(captchaBlockedUntil), seekConfig.scheduler.timezone),
    });
    return summary;
  }

  runInFlight = true;
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let runSessionId: number | null = null;

  try {
    logger.info("Starting SEEK auto-applier session", {
      trigger,
      headless: seekConfig.browser.headless,
      dryRun: seekConfig.dryRun,
    });

    await db.init();
    runSessionId = await db.startRunSession(seekConfig.dryRun);

    const counters = {
      sessionApplied: 0,
      dayApplied: await db.getTodayAppliedCount(),
    };

    browser = await browserManager.launchBrowser();
    context = await createSessionContext(browser);
    page = await context.newPage();

    await ensureLoggedIn(page);
    await syncSeekProfile(page);

    for (const query of SEARCH_QUERIES) {
      if (
        counters.sessionApplied >= seekConfig.limits.maxSessionApplications ||
        counters.dayApplied >= seekConfig.limits.maxDailyApplications
      ) {
        break;
      }

      const listings = await seekSearch(page, query);
      runCounts.discovered += listings.length;
      logger.info("SEEK query returned listings", {
        keywords: query.keywords,
        location: query.location,
        listings: listings.length,
      });

      for (const listing of listings) {
        if (
          counters.sessionApplied >= seekConfig.limits.maxSessionApplications ||
          counters.dayApplied >= seekConfig.limits.maxDailyApplications
        ) {
          break;
        }

        await processJob(page, listing, summary, counters, runCounts);
      }

      await humanDelay(...seekConfig.timing.betweenSearchQueries);
    }

    const dailySummary = await db.getDailySummary();
    summary.topMatches = dailySummary.topMatches.length > 0 ? dailySummary.topMatches : summary.topMatches;

    logger.info("SEEK session completed", {
      trigger,
      sessionApplied: summary.applied,
      dayApplied: dailySummary.applied,
      external: dailySummary.external,
      errors: dailySummary.errors,
      skipped: dailySummary.skipped,
    });

    if (runSessionId !== null) {
      await db.finishRunSession(
        runSessionId,
        {
          applied: runCounts.applied,
          skipped: runCounts.skipped,
          external: runCounts.external,
          failed: runCounts.failed,
          duplicate: runCounts.duplicate,
          discovered: runCounts.discovered,
        },
        "completed",
      );
    }
  } catch (error) {
    summary.errors += 1;

    if (error instanceof CaptchaDetectedError) {
      captchaBlockedUntil = Date.now() + 2 * 60 * 60 * 1_000;
      logger.warn("CAPTCHA detected; blocking new SEEK runs for 2 hours.", {
        blockedUntil: formatInTimezone(new Date(captchaBlockedUntil), seekConfig.scheduler.timezone),
      });
      await notifier.sendCaptchaDetected(error.message);
    } else {
      logger.error("SEEK session failed", { error });
      await notifier.sendSessionError(error instanceof Error ? error.message : String(error));
    }

    if (runSessionId !== null) {
      await db.finishRunSession(
        runSessionId,
        {
          applied: runCounts.applied,
          skipped: runCounts.skipped,
          external: runCounts.external,
          failed: runCounts.failed,
          duplicate: runCounts.duplicate,
          discovered: runCounts.discovered,
        },
        "failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  } finally {
    summary.finishedAt = new Date().toISOString();

    if (context) {
      await saveSession(context).catch(() => undefined);
    }

    if (browser) {
      await browser.close().catch(() => undefined);
    }

    const dailySummary = await db.getDailySummary().catch(() => ({
      applied: summary.applied,
      external: summary.external,
      errors: summary.errors,
      skipped: summary.skipped + summary.duplicates,
      topMatches: summary.topMatches,
    }));

    summary.applied = dailySummary.applied;
    summary.external = dailySummary.external;
    summary.errors = Math.max(summary.errors, dailySummary.errors);
    summary.skipped = dailySummary.skipped;
    summary.topMatches = dailySummary.topMatches.length > 0 ? dailySummary.topMatches : summary.topMatches;

    await notifier.sendDailySummary(summary);
    runInFlight = false;
  }

  return summary;
};

const startScheduler = (): void => {
  cron.schedule(
    seekConfig.scheduler.morningCron,
    () => {
      void run("cron");
    },
    { timezone: seekConfig.scheduler.timezone },
  );

  cron.schedule(
    seekConfig.scheduler.eveningCron,
    () => {
      void run("cron");
    },
    { timezone: seekConfig.scheduler.timezone },
  );

  logger.info("SEEK scheduler started", {
    timezone: seekConfig.scheduler.timezone,
    morningCron: seekConfig.scheduler.morningCron,
    eveningCron: seekConfig.scheduler.eveningCron,
  });
};

const main = async (): Promise<void> => {
  const once = process.argv.includes("--once");
  const schedule = process.argv.includes("--schedule");

  process.on("unhandledRejection", (error) => {
    logger.error("Unhandled promise rejection in SEEK entrypoint", { error });
  });

  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception in SEEK entrypoint", { error });
  });

  process.on("exit", () => {
    void db.closePool().catch(() => undefined);
  });

  process.on("SIGTERM", () => {
    void db
      .closePool()
      .catch(() => undefined)
      .finally(() => {
        process.exit(0);
      });
  });

  process.on("SIGINT", () => {
    void db
      .closePool()
      .catch(() => undefined)
      .finally(() => {
        process.exit(0);
      });
  });

  await db.init();
  await loadBlacklistFromDb();

  if (schedule) {
    startScheduler();
    return;
  }

  if (once || !schedule) {
    await run("manual");
  }
};

void main();
