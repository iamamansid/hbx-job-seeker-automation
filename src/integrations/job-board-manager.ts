import { config, type Config } from "../config/index";
import { MemoryManager } from "../memory/memory-manager";
import { JobApplicationOrchestrator } from "../orchestrator/orchestrator";
import { type JobListing, type JobScraper, type PortalSource } from "../types/index";
import { logger } from "../utils/logger";

type PortalTemplate = {
  name: PortalSource;
  enabled: boolean;
  maxPages: number;
  searchKeywords: string[];
  location: string;
  visaSponsorshipFilter: boolean;
};

export type PortalConfig = {
  name: PortalSource;
  enabled: boolean;
  scraper: JobScraper;
  maxPages: number;
  searchKeywords: string[];
  location: string;
  visaSponsorshipFilter: boolean;
};

export const DEFAULT_PORTALS: PortalTemplate[] = [
  {
    name: "LinkedIn",
    enabled: true,
    maxPages: 3,
    searchKeywords: [
      "Java Developer visa sponsorship Australia",
      "482 visa sponsor Java Australia",
      "Spring Boot visa sponsorship Australia",
    ],
    location: "Australia",
    visaSponsorshipFilter: true,
  },
  {
    name: "Seek",
    enabled: true,
    maxPages: 5,
    searchKeywords: ["java developer visa sponsorship"],
    location: "Australia",
    visaSponsorshipFilter: true,
  },
  {
    name: "Indeed",
    enabled: true,
    maxPages: 5,
    searchKeywords: ["java developer visa sponsorship"],
    location: "Australia",
    visaSponsorshipFilter: true,
  },
  {
    name: "ETaxJobs",
    enabled: true,
    maxPages: 3,
    searchKeywords: ["java"],
    location: "australia",
    visaSponsorshipFilter: false,
  },
  {
    name: "WorkVisa",
    enabled: true,
    maxPages: 3,
    searchKeywords: ["java developer"],
    location: "australia",
    visaSponsorshipFilter: false,
  },
];

export const createDefaultPortalConfigs = (scrapers: Record<PortalSource, JobScraper>): PortalConfig[] =>
  DEFAULT_PORTALS.map((portal) => ({
    ...portal,
    scraper: scrapers[portal.name],
  }));

export class JobBoardManager {
  constructor(
    private readonly orchestrator: JobApplicationOrchestrator,
    private readonly memory: MemoryManager,
    private readonly portals: PortalConfig[],
    private readonly runtimeConfig: Config = config,
  ) {}

  async initialize(): Promise<void> {
    logger.info(`Job board manager initialized with ${this.portals.length} portal(s)`);
  }

  async searchAndApply(): Promise<void> {
    const activePortals = this.portals.filter(
      (portal) =>
        portal.enabled && this.runtimeConfig.search.targetPortals.includes(portal.name),
    );

    logger.info(`Searching ${activePortals.length} enabled portal(s)`);

    const knownJobUrls = await this.memory.getKnownJobUrls();
    const uniqueUrls = new Set<string>(knownJobUrls);
    const collectedJobs: JobListing[] = [];

    for (const portal of activePortals) {
      try {
        const maxPages = Math.min(portal.maxPages, this.runtimeConfig.search.maxPagesPerPortal);
        logger.info(`Searching portal ${portal.name}`, {
          keywords: portal.searchKeywords,
          location: portal.location,
          maxPages,
        });

        const jobs = await portal.scraper.searchJobs(portal.searchKeywords, portal.location, maxPages);

        const filteredJobs = portal.visaSponsorshipFilter || this.runtimeConfig.search.visaSponsorshipOnly
          ? jobs.filter((job) => job.visaSponsorshipMentioned)
          : jobs;

        for (const job of filteredJobs) {
          if (uniqueUrls.has(job.url)) {
            continue;
          }

          uniqueUrls.add(job.url);
          await this.memory.storeJobListing(job);
          collectedJobs.push(job);
        }
      } catch (error) {
        logger.error(`Portal ${portal.name} failed during search`, { error });
      }
    }

    logger.info(`Collected ${collectedJobs.length} unique job(s) across all portals`);
    await this.orchestrator.processJobs(collectedJobs);
  }
}
