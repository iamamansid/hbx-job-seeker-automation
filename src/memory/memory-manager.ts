import { Pool } from "pg";
import { config, type Config } from "../config/index";
import { logger } from "../utils/logger";
import { type JobListing, type PortalSource } from "../types/index";

export type RunStatus = "RUNNING" | "COMPLETED" | "FAILED";
export type JobEventType = "SCRAPED" | "ANALYZED" | "PLANNED" | "APPLIED" | "REJECTED" | "FAILED";

export class MemoryManager {
  private pool: Pool | null = null;
  private currentRunId: number | null = null;

  constructor(private readonly runtimeConfig: Config = config) {}

  async initialize(): Promise<void> {
    if (this.pool) return;

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is required for PostgreSQL connection");
    }

    this.pool = new Pool({
      connectionString,
      // Default to 10 connections for this application script
      max: 10,
    });

    // We no longer call createTables here, because Flyway will manage schema migrations.
    logger.info("PostgreSQL memory manager initialized.");
  }

  /**
   * Starts a new Agent Run and records it in the database.
   */
  async startRun(searchTerms: string, location: string): Promise<number> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO agent_run (status, search_terms, location) VALUES ($1, $2, $3) RETURNING id`,
      ["RUNNING", searchTerms, location]
    );
    this.currentRunId = parseInt(result.rows[0].id, 10);
    logger.info(`Started new Agent Run ID: ${this.currentRunId}`);
    return this.currentRunId;
  }

  /**
   * Finalizes the current Agent Run.
   */
  async endRun(status: "COMPLETED" | "FAILED"): Promise<void> {
    const pool = this.ensurePool();
    if (!this.currentRunId) return;

    await pool.query(
      `UPDATE agent_run SET status = $1, end_time = NOW() WHERE id = $2`,
      [status, this.currentRunId]
    );
    logger.info(`Ended Agent Run ID: ${this.currentRunId} with status ${status}`);
    this.currentRunId = null;
  }

  /**
   * Stores a newly scraped job listing, or updates if the URL already exists.
   * Emits a SCRAPED event for the job.
   */
  async storeJobListing(job: JobListing): Promise<number> {
    const pool = this.ensurePool();
    
    // UPSERT the job listing
    const result = await pool.query(
      `INSERT INTO job_listing (
        run_id, title, company, location, url, description, 
        portal_source, salary, visa_sponsorship_mentioned
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (url) DO UPDATE SET 
        title = EXCLUDED.title,
        company = EXCLUDED.company,
        location = EXCLUDED.location,
        description = EXCLUDED.description,
        salary = EXCLUDED.salary,
        portal_source = EXCLUDED.portal_source,
        visa_sponsorship_mentioned = EXCLUDED.visa_sponsorship_mentioned
      RETURNING id
      `,
      [
        this.currentRunId,
        job.title,
        job.company,
        job.location,
        job.url,
        job.description,
        job.portalSource,
        job.salary || null,
        job.visaSponsorshipMentioned
      ]
    );

    const jobId = parseInt(result.rows[0].id, 10);

    // Record SCRAPED event
    await this.logEvent(jobId, 'SCRAPED', `Scraped from ${job.portalSource}`);
    
    return jobId;
  }

  /**
   * Looks up a job by its unique URL
   */
  async getJobIdByUrl(url: string): Promise<number | null> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT id FROM job_listing WHERE url = $1`,
      [url]
    );
    return result.rows.length ? parseInt(result.rows[0].id, 10) : null;
  }

  /**
   * Logs an event for a specific job in the pipeline (e.g. ANALYZED, PLANNED, APPLIED)
   */
  async logEvent(jobId: number, eventType: JobEventType, message: string, data?: any): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `INSERT INTO job_event (job_id, event_type, event_message, event_data)
       VALUES ($1, $2, $3, $4)`,
      [jobId, eventType, message, data ? JSON.stringify(data) : null]
    );
  }

  /**
   * Retrieves all URLs that have ever been recorded to prevent duplicate scrapes/processing if needed
   */
  async getKnownJobUrls(): Promise<Set<string>> {
    const pool = this.ensurePool();
    const result = await pool.query(`SELECT url FROM job_listing`);
    return new Set(result.rows.map(row => row.url));
  }

  /**
   * Checks if a specific job has successfully been applied to ("APPLIED" event exists)
   */
  async hasAppliedBefore(jobUrl: string): Promise<boolean> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT 1 FROM job_event je 
       JOIN job_listing jl ON je.job_id = jl.id 
       WHERE jl.url = $1 AND je.event_type = 'APPLIED' LIMIT 1`,
      [jobUrl]
    );
    return result.rows.length > 0;
  }

  /**
   * Checks if a job has been rejected during analysis ("REJECTED" event exists)
   */
  async isJobRejected(jobUrl: string): Promise<boolean> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT 1 FROM job_event je 
       JOIN job_listing jl ON je.job_id = jl.id 
       WHERE jl.url = $1 AND je.event_type = 'REJECTED' LIMIT 1`,
      [jobUrl]
    );
    return result.rows.length > 0;
  }

  /**
   * Legacy interface to record rejection
   */
  async recordRejectedJob(jobUrl: string, companyName: string, reason: string): Promise<void> {
    let jobId = await this.getJobIdByUrl(jobUrl);
    if (!jobId) {
       // If job doesn't exist yet, we store a stub to track it
       jobId = await this.storeJobListing({
         url: jobUrl,
         title: "Unknown",
         company: companyName,
         location: "Unknown",
         description: "",
         portalSource: "LinkedIn", // Stub
         visaSponsorshipMentioned: false,
         scrapedAt: new Date()
       } as JobListing);
    }
    await this.logEvent(jobId, 'REJECTED', reason);
  }

  async getStatistics(): Promise<{
    totalApplications: number;
    appliedCount: number;
    failedCount: number;
    uniqueCompanies: number;
    successRate: number;
  }> {
    const pool = this.ensurePool();
    
    // Applications attempted means we reached the execution phase
    // Note: With the new event system, 'failed' is tracked by absence of APPLIED after PLANNED? 
    // Or we should introduce a FAILED_APPLICATION event.
    // For now we map this from job_events:
    
    const result = await pool.query(`
      SELECT 
        COUNT(DISTINCT jl.id) as total_jobs,
        COUNT(DISTINCT CASE WHEN je.event_type = 'APPLIED' THEN jl.id END) as applied_count,
        COUNT(DISTINCT CASE WHEN je.event_type = 'FAILED' THEN jl.id END) as failed_count,
        COUNT(DISTINCT jl.company) as unique_companies
      FROM job_listing jl
      LEFT JOIN job_event je ON jl.id = je.job_id
    `);
    
    const row = result.rows[0];
    const appliedCount = parseInt(row.applied_count) || 0;
    const failedCount = parseInt(row.failed_count) || 0;
    const totalApplications = parseInt(row.total_jobs) || 0;
    
    const completed = appliedCount + failedCount;
    const successRate = completed === 0 ? 0 : (appliedCount / completed) * 100;
    
    return {
      totalApplications,
      appliedCount,
      failedCount,
      uniqueCompanies: parseInt(row.unique_companies) || 0,
      successRate
    };
  }

  async close(): Promise<void> {
    if (!this.pool) return;
    logger.info("Closing PostgreSQL connection pool...");
    await this.pool.end();
    this.pool = null;
  }

  private ensurePool(): Pool {
    if (!this.pool) {
      throw new Error("Database pool not initialized. Call initialize() first.");
    }
    return this.pool;
  }
}
