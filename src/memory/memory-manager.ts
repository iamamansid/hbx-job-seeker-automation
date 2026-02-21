import sqlite3 from "sqlite3";
import { config } from "../config/index";
import logger from "../utils/logger";
import { ApplicationRecord, ApplicationRecordSchema } from "../types/index";
import { v4 as uuidv4 } from "uuid";

export class MemoryManager {
  private db: sqlite3.Database | null = null;

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(config.memory.dbPath, (err) => {
        if (err) {
          logger.error("Failed to open database:", err);
          reject(err);
        } else {
          logger.info(`Database initialized at ${config.memory.dbPath}`);
          this.createTables()
            .then(() => resolve())
            .catch(reject);
        }
      });
    });
  }

  private async createTables(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      this.db.serialize(() => {
        // Applications table
        this.db!.run(
          `
          CREATE TABLE IF NOT EXISTS applications (
            id TEXT PRIMARY KEY,
            timestamp INTEGER NOT NULL,
            companyName TEXT NOT NULL,
            jobTitle TEXT NOT NULL,
            jobUrl TEXT UNIQUE NOT NULL,
            status TEXT NOT NULL,
            relevanceScore REAL,
            fillRating REAL,
            notes TEXT,
            formDataFilled TEXT,
            errorLog TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
          )
          `,
          (err) => {
            if (err) {
              logger.error("Failed to create applications table:", err);
              reject(err);
            } else {
              logger.info("Applications table ready");
              resolve();
            }
          },
        );

        // Search history table
        this.db!.run(
          `
          CREATE TABLE IF NOT EXISTS search_history (
            id TEXT PRIMARY KEY,
            searchQuery TEXT,
            resultsCount INTEGER,
            timestamp INTEGER,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
          )
          `,
          (err) => {
            if (err) logger.error("Failed to create search_history table:", err);
          },
        );

        // Rejected jobs table (to avoid re-applying)
        this.db!.run(
          `
          CREATE TABLE IF NOT EXISTS rejected_jobs (
            id TEXT PRIMARY KEY,
            jobUrl TEXT UNIQUE NOT NULL,
            companyName TEXT,
            reason TEXT,
            timestamp INTEGER,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
          )
          `,
          (err) => {
            if (err) logger.error("Failed to create rejected_jobs table:", err);
          },
        );

        // Create indexes
        this.db!.run("CREATE INDEX IF NOT EXISTS idx_company ON applications(companyName)");
        this.db!.run("CREATE INDEX IF NOT EXISTS idx_status ON applications(status)");
        this.db!.run("CREATE INDEX IF NOT EXISTS idx_timestamp ON applications(timestamp)");
      });
    });
  }

  /**
   * Record a new application
   */
  async recordApplication(application: Omit<ApplicationRecord, "id" | "timestamp">): Promise<ApplicationRecord> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const id = uuidv4();
      const timestamp = Date.now();
      const formDataStr = JSON.stringify(application.formDataFilled || {});

      this.db.run(
        `
        INSERT INTO applications (id, timestamp, companyName, jobTitle, jobUrl, status, relevanceScore, fillRating, notes, formDataFilled, errorLog)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          id,
          timestamp,
          application.companyName,
          application.jobTitle,
          application.jobUrl,
          application.status,
          application.relevanceScore,
          application.fillRating,
          application.notes,
          formDataStr,
          application.errorLog,
        ],
        (err) => {
          if (err) {
            logger.error("Failed to record application:", err);
            reject(err);
          } else {
            logger.info(`Application recorded: ${application.companyName} - ${application.jobTitle}`);
            resolve({
              ...application,
              id,
              timestamp,
            });
          }
        },
      );
    });
  }

  /**
   * Check if job has already been applied to
   */
  async hasAppliedBefore(jobUrl: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      this.db.get("SELECT id FROM applications WHERE jobUrl = ?", [jobUrl], (err, row) => {
        if (err) {
          logger.error("Failed to check application history:", err);
          reject(err);
        } else {
          resolve(!!row);
        }
      });
    });
  }

  /**
   * Check if job is in rejected list
   */
  async isJobRejected(jobUrl: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      this.db.get("SELECT id FROM rejected_jobs WHERE jobUrl = ?", [jobUrl], (err, row) => {
        if (err) {
          logger.error("Failed to check rejected jobs:", err);
          reject(err);
        } else {
          resolve(!!row);
        }
      });
    });
  }

  /**
   * Record a rejected job
   */
  async recordRejectedJob(jobUrl: string, companyName: string, reason: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      this.db.run(
        "INSERT OR IGNORE INTO rejected_jobs (id, jobUrl, companyName, reason, timestamp) VALUES (?, ?, ?, ?, ?)",
        [uuidv4(), jobUrl, companyName, reason, Date.now()],
        (err) => {
          if (err) {
            logger.error("Failed to record rejected job:", err);
            reject(err);
          } else {
            logger.info(`Job rejected and recorded: ${jobUrl}`);
            resolve();
          }
        },
      );
    });
  }

  /**
   * Get application history
   */
  async getApplicationHistory(limit: number = 50, status?: string): Promise<ApplicationRecord[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      let query = "SELECT * FROM applications";
      const params: any[] = [];

      if (status) {
        query += " WHERE status = ?";
        params.push(status);
      }

      query += " ORDER BY timestamp DESC LIMIT ?";
      params.push(limit);

      this.db.all(query, params, (err, rows) => {
        if (err) {
          logger.error("Failed to retrieve application history:", err);
          reject(err);
        } else {
          const applications = (rows || []).map((row: any) => ({
            ...row,
            formDataFilled: JSON.parse(row.formDataFilled || "{}"),
          }));
          resolve(applications);
        }
      });
    });
  }

  /**
   * Get statistics
   */
  async getStatistics(): Promise<{
    totalApplications: number;
    appliedCount: number;
    failedCount: number;
    uniqueCompanies: number;
    successRate: number;
  }> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      this.db.all(
        `
        SELECT 
          COUNT(*) as totalApplications,
          SUM(CASE WHEN status = 'applied' THEN 1 ELSE 0 END) as appliedCount,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failedCount,
          COUNT(DISTINCT companyName) as uniqueCompanies
        FROM applications
        `,
        (err, rows) => {
          if (err) {
            logger.error("Failed to get statistics:", err);
            reject(err);
          } else {
            const row = (rows || [{}])[0] as any;
            const totalApplications = row.totalApplications || 0;
            const appliedCount = row.appliedCount || 0;
            const failedCount = row.failedCount || 0;
            const uniqueCompanies = row.uniqueCompanies || 0;
            const successRate = totalApplications > 0 ? (appliedCount / totalApplications) * 100 : 0;

            resolve({
              totalApplications,
              appliedCount,
              failedCount,
              uniqueCompanies,
              successRate,
            });
          }
        },
      );
    });
  }

  /**
   * Update application status
   */
  async updateApplicationStatus(
    applicationId: string,
    status: string,
    fillRating?: number,
    notes?: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      this.db.run(
        "UPDATE applications SET status = ?, fillRating = ?, notes = ? WHERE id = ?",
        [status, fillRating, notes, applicationId],
        (err) => {
          if (err) {
            logger.error("Failed to update application:", err);
            reject(err);
          } else {
            logger.info(`Application ${applicationId} updated to status: ${status}`);
            resolve();
          }
        },
      );
    });
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            logger.error("Failed to close database:", err);
            reject(err);
          } else {
            logger.info("Database closed");
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}

export default MemoryManager;
