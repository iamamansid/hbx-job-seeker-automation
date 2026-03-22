import { z } from "zod";

export const JobRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  url: z.string().url(),
  salary: z.string().optional(),
  postedDate: z.string(),
  scrapedAt: z.string(),
  sponsorshipScore: z.enum(["confirmed", "likely", "silent", "excluded"]),
  relevanceScore: z.number().min(0).max(100),
  sponsorshipSignals: z.array(z.string()),
  excludeReasons: z.array(z.string()),
  keyRequirements: z.string(),
  status: z.enum([
    "pending",
    "skipped",
    "queued",
    "applying",
    "applied",
    "failed",
    "external",
    "duplicate",
  ]),
  appliedAt: z.string().optional(),
  applicationId: z.string().optional(),
  coverLetterUsed: z.string().optional(),
  notes: z.string().optional(),
  errorMessage: z.string().optional(),
});

export type JobRecord = z.infer<typeof JobRecordSchema>;

export const JobsDatabaseSchema = z.object({
  jobs: z.array(JobRecordSchema).default([]),
});

export type JobsDatabase = z.infer<typeof JobsDatabaseSchema>;

export const AppliedLogEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  company: z.string(),
  url: z.string().url(),
  relevanceScore: z.number().min(0).max(100),
  appliedAt: z.string(),
});

export type AppliedLogEntry = z.infer<typeof AppliedLogEntrySchema>;

export const BlacklistSchema = z.object({
  companies: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  jobIds: z.array(z.string()).default([]),
});

export type BlacklistPayload = z.infer<typeof BlacklistSchema>;
