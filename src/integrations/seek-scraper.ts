import { type Page } from "playwright";
import { config, type Config } from "../config/index";
import { type JobListing } from "../types/index";
import { logger } from "../utils/logger";
import { BrowserLifecycleManager } from "../browser/browser-lifecycle-manager";
import { BaseJobScraper } from "./job-scraper";

export class SeekScraper extends BaseJobScraper {
  constructor(
    browserLifecycleManager: BrowserLifecycleManager,
    runtimeConfig: Config = config,
  ) {
    super(browserLifecycleManager, runtimeConfig);
  }

  async searchJobs(keywords: string[], location: string, maxPages: number): Promise<JobListing[]> {
    return this.withPage(async (page) => {
      const allJobs: JobListing[] = [];
      const query = encodeURIComponent(keywords.join(" ") + " visa sponsorship");
      const loc = encodeURIComponent(location);
      
      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const searchUrl = `https://www.seek.com.au/${query}-jobs/in-${loc}?page=${pageNum}`;
        await this.navigate(page, searchUrl);
        await page.waitForTimeout(2000);

        const jobsOnPage = await this.extractJobsFromPage(page);
        if (jobsOnPage.length === 0) {
          logger.info(`No jobs found on Seek page ${pageNum}. Stopping pagination.`);
          break;
        }

        allJobs.push(...jobsOnPage);
        logger.info(`Found ${jobsOnPage.length} jobs on Seek page ${pageNum}`);
      }

      return allJobs;
    });
  }

  async extractJobDetails(url: string): Promise<JobListing> {
    return this.withPage(async (page) => {
      await this.navigate(page, url);
      await page.waitForTimeout(2000);

      const title = await page.locator('h1[data-automation="job-detail-title"]').textContent().catch(() => "Unknown Title");
      const company = await page.locator('[data-automation="advertiser-name"]').textContent().catch(() => "Unknown Company");
      const location = await page.locator('[data-automation="job-detail-location"]').textContent().catch(() => "Unknown Location");
      const description = await page.locator('[data-automation="jobAdDetails"]').textContent().catch(() => "");
      const salary = await page.locator('[data-automation="job-detail-salary"]').textContent().catch(() => undefined);

      const visaMentioned = this.visaKeywords.some(kw => 
        description?.toLowerCase().includes(kw) || title?.toLowerCase().includes(kw)
      );

      return {
        title: title?.trim() || "Unknown Title",
        company: company?.trim() || "Unknown Company",
        location: location?.trim() || "Unknown Location",
        url,
        description: description?.trim() || "",
        salary: salary?.trim(),
        portalSource: "Seek",
        visaSponsorshipMentioned: visaMentioned,
        scrapedAt: new Date(),
      };
    });
  }

  private async extractJobsFromPage(page: Page): Promise<JobListing[]> {
    const jobCards = await page.locator('article[data-automation="normalJob"]').all();
    const jobs: JobListing[] = [];

    for (const card of jobCards) {
      try {
        const titleEl = card.locator('a[data-automation="jobTitle"]');
        const title = await titleEl.textContent();
        const href = await titleEl.getAttribute("href");
        const company = await card.locator('a[data-automation="jobCompany"]').textContent().catch(() => "Unknown");
        const location = await card.locator('a[data-automation="jobLocation"]').first().textContent().catch(() => "Unknown");
        const teaser = await card.locator('span[data-automation="jobShortDescription"]').textContent().catch(() => "");
        const salary = await card.locator('span[data-automation="jobSalary"]').textContent().catch(() => undefined);

        if (title && href) {
          const url = this.toAbsoluteUrl("https://www.seek.com.au", href);
          
          // Only do a shallow sweep here, full details fetched later
          jobs.push({
            title: title.trim(),
            company: company?.trim() || "Unknown",
            location: location?.trim() || "Unknown",
            url,
            description: teaser?.trim() || "",
            salary: salary?.trim(),
            portalSource: "Seek",
            visaSponsorshipMentioned: this.visaKeywords.some(kw => teaser?.toLowerCase().includes(kw)),
            scrapedAt: new Date(),
          });
        }
      } catch (error) {
        logger.warn("Failed to extract job card on Seek", { error });
      }
    }

    return jobs;
  }
}
