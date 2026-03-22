import type { BrowserContext, BrowserContextOptions, Page } from "playwright";

import { config, type Config } from "../config/index";
import { BrowserLifecycleManager } from "../browser/browser-lifecycle-manager";
import {
  JobDescriptionSchema,
  JobListingSchema,
  type JobDescription,
  type JobListing,
  type JobScraper,
  type PortalSource,
} from "../types/index";
import { logger } from "../utils/logger";

export abstract class BaseJobScraper implements JobScraper {
  protected readonly visaKeywords = [
    "visa sponsorship",
    "482 visa",
    "willing to sponsor",
    "sponsor overseas",
    "visa support",
    "overseas applicants welcome",
  ];

  constructor(
    protected readonly browserLifecycleManager: BrowserLifecycleManager,
    protected readonly runtimeConfig: Config = config,
  ) {}

  abstract searchJobs(keywords: string[], location: string, maxPages: number): Promise<JobListing[]>;

  abstract extractJobDetails(url: string): Promise<JobListing>;

  protected async withPage<T>(
    action: (page: Page, context: BrowserContext) => Promise<T>,
    contextOptions: BrowserContextOptions = {},
  ): Promise<T> {
    const { context, page } = await this.browserLifecycleManager.createPage(contextOptions);
    try {
      return await action(page, context);
    } finally {
      await this.browserLifecycleManager.closePage(page);
      await this.browserLifecycleManager.closeContext(context);
    }
  }

  protected async navigate(page: Page, url: string): Promise<void> {
    logger.info(`Navigating to ${url}`);
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: this.runtimeConfig.browser.timeout,
    });
  }

  protected toAbsoluteUrl(baseUrl: string, href: string | null | undefined): string {
    if (!href) {
      return "";
    }

    try {
      return new URL(href, baseUrl).toString();
    } catch {
      return href;
    }
  }

  protected normalizeText(value: string | null | undefined): string {
    return value?.replace(/\s+/g, " ").trim() ?? "";
  }

  protected hasVisaSponsorshipMention(description: string): boolean {
    const lowered = description.toLowerCase();
    return this.visaKeywords.some((keyword) => lowered.includes(keyword));
  }

  protected parseResponsibilities(description: string): string[] {
    const lines = description
      .split(/\n|•|·|-/)
      .map((line) => line.trim())
      .filter((line) => line.length > 20);
    return lines.slice(0, 8);
  }

  protected parseRequirements(description: string): string[] {
    const patterns = [
      "java",
      "spring boot",
      "microservices",
      "rest",
      "azure",
      "gcp",
      "docker",
      "kubernetes",
      "sql",
      "aws",
    ];

    const lowered = description.toLowerCase();
    return patterns
      .filter((pattern) => lowered.includes(pattern))
      .map((pattern) => pattern.replace(/\b\w/g, (match) => match.toUpperCase()));
  }

  protected extractSalary(description: string): string | undefined {
    const salaryMatch = description.match(/AUD?\s?\$?\s?\d[\d,]*(?:\s?-\s?AUD?\s?\$?\s?\d[\d,]*)?/i);
    return salaryMatch?.[0]?.replace(/\s+/g, " ").trim();
  }

  protected buildListing(params: {
    title: string;
    company: string;
    location: string;
    url: string;
    description: string;
    salary?: string;
    portalSource: PortalSource;
    visaSponsorshipMentioned?: boolean;
  }): JobListing {
    return JobListingSchema.parse({
      ...params,
      salary: params.salary,
      visaSponsorshipMentioned:
        params.visaSponsorshipMentioned ?? this.hasVisaSponsorshipMention(params.description),
      scrapedAt: new Date(),
    });
  }

  protected dedupeJobs(jobs: JobListing[]): JobListing[] {
    const unique = new Map<string, JobListing>();
    for (const job of jobs) {
      if (!unique.has(job.url)) {
        unique.set(job.url, job);
      }
    }

    return [...unique.values()];
  }

  protected sortByVisaRelevancy(jobs: JobListing[]): JobListing[] {
    return [...jobs].sort((left, right) => {
      const leftScore = Number(left.visaSponsorshipMentioned) * 10 + Number(Boolean(left.salary));
      const rightScore = Number(right.visaSponsorshipMentioned) * 10 + Number(Boolean(right.salary));
      return rightScore - leftScore;
    });
  }
}

export const jobListingToDescription = (job: JobListing): JobDescription =>
  JobDescriptionSchema.parse({
    jobTitle: job.title,
    companyName: job.company,
    location: job.location,
    requirements: [],
    responsibilities: [],
    benefits: [],
    workType: undefined,
    fullDescription: job.description,
    salaryRange: job.salary,
    url: job.url,
  });
