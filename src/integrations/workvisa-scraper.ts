import { type Page } from "playwright";
import { config, type Config } from "../config/index";
import { type JobListing } from "../types/index";
import { logger } from "../utils/logger";
import { BrowserLifecycleManager } from "../browser/browser-lifecycle-manager";
import { BaseJobScraper } from "./job-scraper";

export class WorkVisaScraper extends BaseJobScraper {
  constructor(
    browserLifecycleManager: BrowserLifecycleManager,
    runtimeConfig: Config = config,
  ) {
    super(browserLifecycleManager, runtimeConfig);
  }

  async searchJobs(keywords: string[], location: string, maxPages: number): Promise<JobListing[]> {
    return this.withPage(async (page) => {
      const allJobs: JobListing[] = [];
      const query = encodeURIComponent(keywords.join(" "));
      const loc = encodeURIComponent(location);
      
      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const searchUrl = `https://workvisa.com.au/jobs?q=${query}&location=${loc}&page=${pageNum}`;
        await this.navigate(page, searchUrl);
        await page.waitForTimeout(2000);

        const jobsOnPage = await this.extractJobsFromPage(page);
        if (jobsOnPage.length === 0) {
          logger.info(`No jobs found on WorkVisa page ${pageNum}. Stopping pagination.`);
          break;
        }

        allJobs.push(...jobsOnPage);
        logger.info(`Found ${jobsOnPage.length} jobs on WorkVisa page ${pageNum}`);
      }

      return allJobs;
    });
  }

  async extractJobDetails(url: string): Promise<JobListing> {
    return this.withPage(async (page) => {
      await this.navigate(page, url);
      await page.waitForTimeout(2000);

      const title = await page.locator('h1').first().textContent().catch(() => "Unknown Title");
      const company = await page.locator('.company-name').textContent().catch(() => "Unknown Company");
      const location = await page.locator('.job-location').textContent().catch(() => "Unknown Location");
      const description = await page.locator('.job-description-content').textContent().catch(() => "");
      const salary = await page.locator('.salary-range').textContent().catch(() => undefined);

      const visaMentioned = true; // Naturally true for WorkVisa portal given its nature, but we check anyway:
      const keywordsMatch = this.visaKeywords.some(kw => 
        description?.toLowerCase().includes(kw)
      );

      return {
        title: title?.trim() || "Unknown Title",
        company: company?.trim() || "Unknown Company",
        location: location?.trim() || "Unknown Location",
        url,
        description: description?.trim() || "",
        salary: salary?.trim(),
        portalSource: "WorkVisa",
        visaSponsorshipMentioned: keywordsMatch || visaMentioned,
        scrapedAt: new Date(),
      };
    });
  }

  private async extractJobsFromPage(page: Page): Promise<JobListing[]> {
    const jobCards = await page.locator('.job-card').all();
    const jobs: JobListing[] = [];

    for (const card of jobCards) {
      try {
        const titleEl = card.locator('h3 a');
        const title = await titleEl.textContent();
        const href = await titleEl.getAttribute("href");
        
        const company = await card.locator('.company').textContent().catch(() => "Unknown");
        const location = await card.locator('.location').textContent().catch(() => "Unknown");
        
        if (title && href) {
          const url = this.toAbsoluteUrl("https://workvisa.com.au", href);
          jobs.push({
            title: title.trim(),
            company: company?.trim() || "Unknown",
            location: location?.trim() || "Unknown",
            url,
            description: "", 
            portalSource: "WorkVisa",
            visaSponsorshipMentioned: true, // Default true on this portal
            scrapedAt: new Date(),
          });
        }
      } catch (error) {
        logger.warn("Failed to extract job card on WorkVisa", { error });
      }
    }

    return jobs;
  }
}
