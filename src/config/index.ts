import "dotenv/config";

import { PortalSourceSchema, type PortalSource } from "../types/index";

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }

  return value.trim().toLowerCase() === "true";
};

const parseInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseFloatValue = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
};

const requireEnv = (...names: string[]): string => {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }

  throw new Error(`${names[0]} env var required`);
};

const parsePortalSources = (value: string | undefined): PortalSource[] => {
  const rawValues = (value ?? "LinkedIn,Seek,Indeed,ETaxJobs,WorkVisa")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return rawValues.map((item) => PortalSourceSchema.parse(item));
};

export interface Config {
  llm: {
    geminiApiKey: string;
    model: string;
    timeoutMs: number;
    temperature: number;
    topP: number;
  };
  candidate: {
    name: string;
    email: string;
    phone: string;
    linkedInUrl: string;
    resumePath: string;
    portfolioUrl: string;
    currentLocation: string;
    willingToRelocate: boolean;
    requiresSponsorship: boolean;
    visaStatus: string;
    yearsOfExperience: number;
    primarySkills: string[];
    secondarySkills: string[];
  };
  browser: {
    headless: boolean;
    slowMo: number;
    timeout: number;
    userAgent: string;
  };
  search: {
    targetCountry: string;
    targetPortals: PortalSource[];
    visaSponsorshipOnly: boolean;
    maxApplicationsPerRun: number;
    maxPagesPerPortal: number;
    searchTerms: string[];
  };
  agent: {
    maxRetries: number;
    maxSteps: number;
    enableAutoSubmit: boolean;
    verificationMode: boolean;
  };
  database: {
    url?: string;
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    schema: string;
    ssl: boolean;
    maxPoolSize: number;
    connectTimeoutMs: number;
  };
  migrations: {
    autoMigrate: boolean;
    schemaHistoryTable: string;
    dockerImage: string;
  };
  memory: {
    maxHistoryDays: number;
  };
  logging: {
    level: string;
  };
}

export const config: Config = {
  llm: {
    geminiApiKey: requireEnv("GEMINI_API_KEY"),
    model: "gemini-2.5-pro",
    timeoutMs: parseInteger(process.env.GEMINI_TIMEOUT_MS, 120_000),
    temperature: parseFloatValue(process.env.GEMINI_TEMPERATURE, 0.2),
    topP: parseFloatValue(process.env.GEMINI_TOP_P, 0.9),
  },
  candidate: {
    name: requireEnv("CANDIDATE_NAME"),
    email: requireEnv("CANDIDATE_EMAIL"),
    phone: requireEnv("CANDIDATE_PHONE"),
    linkedInUrl: requireEnv("CANDIDATE_LINKEDIN_URL", "LINKEDIN_URL"),
    resumePath: requireEnv("CANDIDATE_RESUME_PATH", "RESUME_PATH"),
    portfolioUrl: process.env.CANDIDATE_PORTFOLIO_URL?.trim() ?? process.env.PORTFOLIO_URL?.trim() ?? "",
    currentLocation: process.env.CANDIDATE_CURRENT_LOCATION?.trim() ?? process.env.CURRENT_LOCATION?.trim() ?? "",
    willingToRelocate: parseBoolean(process.env.WILLING_TO_RELOCATE, true),
    requiresSponsorship: parseBoolean(process.env.REQUIRES_SPONSORSHIP, true),
    visaStatus: process.env.VISA_STATUS?.trim() ?? "",
    yearsOfExperience: parseInteger(process.env.YEARS_EXPERIENCE, 3),
    primarySkills: (process.env.PRIMARY_SKILLS ?? "Java,Spring Boot,Microservices,REST APIs")
      .split(",")
      .map((skill) => skill.trim())
      .filter(Boolean),
    secondarySkills: (process.env.SECONDARY_SKILLS ?? "Azure,GCP,Docker,Kubernetes")
      .split(",")
      .map((skill) => skill.trim())
      .filter(Boolean),
  },
  browser: {
    headless: parseBoolean(process.env.BROWSER_HEADLESS, true),
    slowMo: parseInteger(process.env.BROWSER_SLOW_MO, 250),
    timeout: parseInteger(process.env.BROWSER_TIMEOUT, 30_000),
    userAgent:
      process.env.BROWSER_USER_AGENT?.trim() ??
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  },
  search: {
    targetCountry: process.env.TARGET_COUNTRY?.trim() || "Australia",
    targetPortals: parsePortalSources(process.env.TARGET_PORTALS),
    visaSponsorshipOnly: parseBoolean(process.env.VISA_SPONSORSHIP_ONLY, true),
    maxApplicationsPerRun: parseInteger(process.env.MAX_APPLICATIONS_PER_RUN, 20),
    maxPagesPerPortal: parseInteger(process.env.MAX_PAGES_PER_PORTAL, 5),
    searchTerms: (process.env.SEARCH_TERMS ?? "java developer visa sponsorship")
      .split(",")
      .map((term) => term.trim())
      .filter(Boolean),
  },
  agent: {
    maxRetries: parseInteger(process.env.MAX_RETRIES, 3),
    maxSteps: parseInteger(process.env.MAX_STEPS, 50),
    enableAutoSubmit: parseBoolean(process.env.ENABLE_AUTO_SUBMIT, false),
    verificationMode: parseBoolean(process.env.VERIFICATION_MODE, false),
  },
  database: {
    url: process.env.DATABASE_URL?.trim() || undefined,
    host: process.env.DB_HOST?.trim() || process.env.POSTGRES_HOST?.trim() || "34.131.245.190",
    port: parseInteger(process.env.DB_PORT ?? process.env.POSTGRES_PORT, 5432),
    database: process.env.DB_NAME?.trim() || process.env.DB_DATABASE?.trim() || process.env.POSTGRES_DB?.trim() || "postgres",
    user: process.env.DB_USER?.trim() || process.env.POSTGRES_USER?.trim() || "postgres",
    password: process.env.DB_PASSWORD?.trim() || process.env.POSTGRES_PASSWORD?.trim() || "",
    schema: process.env.DB_SCHEMA?.trim() || process.env.POSTGRES_SCHEMA?.trim() || "public",
    ssl: parseBoolean(process.env.POSTGRES_SSL, false),
    maxPoolSize: parseInteger(process.env.POSTGRES_MAX_POOL_SIZE, 10),
    connectTimeoutMs: parseInteger(process.env.POSTGRES_CONNECT_TIMEOUT_MS, 10_000),
  },
  migrations: {
    autoMigrate: parseBoolean(process.env.FLYWAY_AUTO_MIGRATE, true),
    schemaHistoryTable:
      process.env.FLYWAY_SCHEMA_HISTORY_TABLE?.trim() || "flyway_schema_history",
    dockerImage: process.env.FLYWAY_DOCKER_IMAGE?.trim() || "flyway/flyway:10-alpine",
  },
  memory: {
    maxHistoryDays: parseInteger(process.env.MAX_HISTORY_DAYS, 90),
  },
  logging: {
    level: process.env.LOG_LEVEL?.trim() || "info",
  },
};
