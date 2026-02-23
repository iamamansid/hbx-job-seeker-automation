import dotenv from "dotenv";

dotenv.config();

const toInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toFloat = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseFloat(value || "");
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }
  return value.toLowerCase() === "true";
};

const toList = (value: string | undefined): string[] =>
  (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const requiredEnv = (name: string, fallback: string = ""): string => {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : fallback;
};

export interface AppConfig {
  candidate: {
    name: string;
    email: string;
    phone: string;
    linkedInUrl: string;
    portfolioUrl: string;
    currentLocation: string;
    willingToRelocate: boolean;
    requiresSponsorship: boolean;
    visaStatus: string;
    yearsOfExperience: number;
    primarySkills: string[];
    secondarySkills: string[];
    resumePath: string;
  };
  ollama: {
    baseUrl: string;
    model: string;
    temperature: number;
    topP: number;
  };
  browser: {
    headless: boolean;
    slowMo: number;
    timeout: number;
  };
  agent: {
    maxRetries: number;
    maxSteps: number;
    enableAutoSubmit: boolean;
    verificationMode: boolean;
  };
  search: {
    terms: string[];
    maxJobsToApply: number;
    jobBoards: string[];
  };
  memory: {
    dbPath: string;
    maxHistoryDays: number;
  };
}

export const config: AppConfig = {
  candidate: {
    name: requiredEnv("CANDIDATE_NAME", "Candidate"),
    email: requiredEnv("CANDIDATE_EMAIL", "candidate@example.com"),
    phone: requiredEnv("CANDIDATE_PHONE", "+10000000000"),
    linkedInUrl: requiredEnv("LINKEDIN_URL"),
    portfolioUrl: requiredEnv("PORTFOLIO_URL"),
    currentLocation: requiredEnv("CURRENT_LOCATION", "Unknown"),
    willingToRelocate: toBool(process.env.WILLING_TO_RELOCATE, false),
    requiresSponsorship: toBool(process.env.REQUIRES_SPONSORSHIP, false),
    visaStatus: requiredEnv("VISA_STATUS", "Unknown"),
    yearsOfExperience: toInt(process.env.YEARS_EXPERIENCE, 0),
    primarySkills: toList(process.env.PRIMARY_SKILLS),
    secondarySkills: toList(process.env.SECONDARY_SKILLS),
    resumePath: requiredEnv("RESUME_PATH", "./data/resume.pdf"),
  },
  ollama: {
    baseUrl: requiredEnv("OLLAMA_BASE_URL", "http://localhost:11434"),
    model: requiredEnv("OLLAMA_MODEL", "gpt-oss:120b-cloud"),
    temperature: toFloat(process.env.OLLAMA_TEMPERATURE, 0.7),
    topP: toFloat(process.env.OLLAMA_TOP_P, 0.9),
  },
  browser: {
    headless: toBool(process.env.BROWSER_HEADLESS, true),
    slowMo: toInt(process.env.BROWSER_SLOW_MO, 500),
    timeout: toInt(process.env.BROWSER_TIMEOUT, 30000),
  },
  agent: {
    maxRetries: toInt(process.env.MAX_RETRIES, 3),
    maxSteps: toInt(process.env.MAX_STEPS, 50),
    enableAutoSubmit: toBool(process.env.ENABLE_AUTO_SUBMIT, false),
    verificationMode: toBool(process.env.VERIFICATION_MODE, true),
  },
  search: {
    terms: (process.env.SEARCH_TERMS || "Java Backend Developer")
      .split("|")
      .map((term) => term.trim())
      .filter((term) => term.length > 0),
    maxJobsToApply: toInt(process.env.MAX_JOBS_TO_APPLY, 5),
    jobBoards: toList(process.env.JOB_BOARDS),
  },
  memory: {
    dbPath: requiredEnv("DB_PATH", "./data/applications.db"),
    maxHistoryDays: toInt(process.env.MAX_HISTORY_DAYS, 90),
  },
};
