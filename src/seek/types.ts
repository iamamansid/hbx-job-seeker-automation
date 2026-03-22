export type SponsorshipStatus = "confirmed" | "likely" | "silent" | "excluded";

export type ScreeningFieldType = "text" | "radio" | "select" | "number";

export interface SearchQuery {
  keywords: string;
  location: string;
}

export interface JobSearchListing {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  teaser: string;
  salary?: string;
  listedAt?: string;
}

export interface JobDetails extends JobSearchListing {
  description: string;
  postedDate: string;
  scrapedAt: string;
  sponsorshipScore: SponsorshipStatus;
  sponsorshipSignals: string[];
  excludeReasons: string[];
  keyRequirements: string;
  relevanceScore?: number;
  relevanceRationale?: string;
}

export interface SponsorshipDecision {
  status: SponsorshipStatus;
  reasons: string[];
}

export interface RelevanceAssessment {
  score: number;
  heuristicScore: number;
  aiScore: number;
  rationale: string;
  matchingSkills: string[];
  concerns: string[];
}

export interface ApplicationResult {
  success: boolean;
  type: "seek-native" | "external" | "dry-run";
  submitted: boolean;
  applicationId?: string;
  confirmationUrl?: string;
  externalUrl?: string;
  coverLetter?: string;
  stepHistory: string[];
  notes?: string;
}

export interface TopMatch {
  id: string;
  title: string;
  company: string;
  score: number;
}

export interface SessionSummary {
  trigger: "manual" | "cron";
  startedAt: string;
  finishedAt: string;
  applied: number;
  external: number;
  errors: number;
  skipped: number;
  duplicates: number;
  dryRunQueued: number;
  topMatches: TopMatch[];
}

export interface BlacklistMatchResult {
  blocked: boolean;
  reasons: string[];
}

export class CaptchaDetectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptchaDetectedError";
  }
}
