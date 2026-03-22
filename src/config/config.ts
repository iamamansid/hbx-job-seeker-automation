import "dotenv/config";

import fs from "fs";
import path from "path";

import { type SearchQuery } from "../seek/types";

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }

  return value.trim().toLowerCase() === "true";
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const requireEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} environment variable is required.`);
  }

  return value;
};

const rootDir = process.cwd();
const dataDir = path.join(rootDir, "data");
const assetsDir = path.join(rootDir, "assets");
const logsDir = path.join(dataDir, "logs");

const resolveResumePath = (): string => {
  const candidates = [
    process.env.RESUME_PATH?.trim(),
    path.join(assetsDir, "resume.pdf"),
    path.join(dataDir, "resume.pdf"),
  ].filter((value): value is string => Boolean(value));

  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  return existing ?? path.join(assetsDir, "resume.pdf");
};

export const APPLICANT = {
  firstName: "Aman",
  lastName: "Siddiqui",
  email: requireEnv("SEEK_EMAIL"),
  phone: "+919415584405",
  location: "India (Open to Relocate — Adelaide/Sydney/Melbourne)",
  linkedIn: "linkedin.com/in/aman-siddiqui",
  workRights: "Will require 482 sponsorship",
  visaStatus: "Overseas applicant seeking employer sponsorship",
  requiresSponsorship: true,
  yearsExperience: 3,
  currentTitle: "Lead API Developer",
  currentCompany: "MetLife",
  targetTitles: [
    "Java Developer",
    "Senior Java Developer",
    "Backend Engineer",
    "Software Engineer",
    "Java Spring Boot Developer",
    "API Developer",
    "Integration Developer",
    "Microservices Engineer",
    "AI Integration Engineer",
    "GenAI Engineer",
    "LLM Engineer",
    "AI Backend Developer",
    "Azure Cloud Engineer",
    "Full Stack Java Developer",
    "Software Engineer Java",
  ],
  primarySkills: [
    "Java",
    "Spring Boot",
    "Microservices",
    "REST API",
    "Azure",
    "Docker",
    "Kubernetes",
    "PostgreSQL",
    "MongoDB",
    "GenAI",
    "Azure OpenAI",
    "LLM",
    "Gemini",
    "Python",
  ],
  secondarySkills: [
    "React",
    "JavaScript",
    "TypeScript",
    "AWS",
    "CI/CD",
    "Jenkins",
    "Git",
    "Agile",
    "Spring Batch",
    "Hibernate",
  ],
  salaryExpectationMin: 110000,
  salaryExpectationMax: 150000,
  education: "B.Tech Mechanical Engineering, SVNIT Surat (8.5 GPA)",
  additionalEducation: "M.Tech CS, BITS Pilani (in progress)",
} as const;

export const SEARCH_QUERIES: SearchQuery[] = [
  { keywords: "java developer 482 sponsorship", location: "All Australia" },
  { keywords: "java spring boot visa sponsorship", location: "All Australia" },
  { keywords: "backend engineer java sponsor", location: "All Australia" },
  { keywords: "java developer visa sponsor", location: "All Australia" },
  { keywords: "software engineer java 482", location: "All Australia" },
  { keywords: "AI engineer java sponsorship", location: "All Australia" },
  { keywords: "genai engineer visa sponsor", location: "All Australia" },
  { keywords: "llm engineer backend sponsor", location: "All Australia" },
  { keywords: "azure openai developer sponsorship", location: "All Australia" },
  { keywords: "java developer", location: "Adelaide SA" },
  { keywords: "java developer", location: "Sydney NSW" },
  { keywords: "java developer", location: "Melbourne VIC" },
  { keywords: "spring boot developer", location: "All Australia" },
  { keywords: "microservices engineer java", location: "All Australia" },
];

export const SEEK_URL_PARAMS = {
  dateRange: "14",
  workType: "242",
  sortMode: "ListedDate",
} as const;

export interface SeekAutomationConfig {
  seek: {
    email: string;
    loginUrl: string;
    homeUrl: string;
  };
  browser: {
    headless: boolean;
    userAgent: string;
    viewport: {
      width: number;
      height: number;
    };
    locale: string;
    timezoneId: string;
    geolocation: {
      latitude: number;
      longitude: number;
    };
    acceptLanguage: string;
  };
  paths: {
    rootDir: string;
    dataDir: string;
    assetsDir: string;
    logsDir: string;
    resumePath: string;
    coverLetterBasePath: string;
  };
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  limits: {
    maxDailyApplications: number;
    maxSessionApplications: number;
    maxPagesPerQuery: number;
    maxApplicationsPerSessionHardCap: number;
  };
  timing: {
    betweenApplications: [number, number];
    betweenNavigations: [number, number];
    betweenFieldFills: [number, number];
    betweenSearchQueries: [number, number];
  };
  scheduler: {
    timezone: string;
    morningCron: string;
    eveningCron: string;
  };
  ai: {
    apiKey: string;
    model: "gemini-2.5-pro";
    maxOutputTokens: number;
    minDelayBetweenCallsMs: number;
  };
  telegram: {
    botToken: string;
    chatId: string;
    enabled: boolean;
  };
  logging: {
    level: string;
  };
  dryRun: boolean;
}

export const seekConfig: SeekAutomationConfig = {
  seek: {
    email: requireEnv("SEEK_EMAIL"),
    loginUrl: "https://www.seek.com.au/account/login",
    homeUrl: "https://www.seek.com.au/",
  },
  browser: {
    headless: parseBoolean(process.env.BROWSER_HEADLESS, false),
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    locale: "en-AU",
    timezoneId: "Australia/Adelaide",
    geolocation: { latitude: -34.9285, longitude: 138.6007 },
    acceptLanguage: "en-AU,en;q=0.9",
  },
  paths: {
    rootDir,
    dataDir,
    assetsDir,
    logsDir,
    resumePath: resolveResumePath(),
    coverLetterBasePath: path.join(assetsDir, "cover_letter_base.txt"),
  },
  database: {
    host: requireEnv("DB_HOST"),
    port: parseNumber(process.env.DB_PORT, 5432),
    database: process.env.DB_NAME?.trim() || process.env.DB_DATABASE?.trim() || "postgres",
    user: requireEnv("DB_USER"),
    password: requireEnv("DB_PASSWORD"),
  },
  limits: {
    maxDailyApplications: parseNumber(process.env.MAX_DAILY_APPLICATIONS, 30),
    maxSessionApplications: parseNumber(process.env.MAX_SESSION_APPLICATIONS, 15),
    maxPagesPerQuery: parseNumber(process.env.MAX_PAGES_PER_QUERY, 3),
    maxApplicationsPerSessionHardCap: 15,
  },
  timing: {
    betweenApplications: [45_000, 120_000],
    betweenNavigations: [2_000, 5_000],
    betweenFieldFills: [300, 800],
    betweenSearchQueries: [30_000, 60_000],
  },
  scheduler: {
    timezone: "Australia/Adelaide",
    morningCron: "0 8 * * 1-5",
    eveningCron: "0 18 * * 1-5",
  },
  ai: {
    apiKey: requireEnv("GEMINI_API_KEY"),
    model: "gemini-2.5-pro",
    maxOutputTokens: 1024,
    minDelayBetweenCallsMs: 1_000,
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "",
    chatId: process.env.TELEGRAM_CHAT_ID?.trim() ?? "",
    enabled: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_CHAT_ID?.trim()),
  },
  logging: {
    level: process.env.LOG_LEVEL?.trim() ?? "info",
  },
  dryRun: parseBoolean(process.env.DRY_RUN, false),
};
