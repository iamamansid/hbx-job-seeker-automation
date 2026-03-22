import { type Page } from "playwright";
import { config, type Config } from "../config/index";
import { type JobListing } from "../types/index";
import { logger } from "../utils/logger";
import { BrowserLifecycleManager } from "../browser/browser-lifecycle-manager";
import { BaseJobScraper } from "./job-scraper";

export class IndeedScraper extends BaseJobScraper {
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
      
      for (let pageNum = 0; pageNum < maxPages; pageNum++) {
        const start = pageNum * 10;
        const searchUrl = `https://au.indeed.com/jobs?q=${query}&l=${loc}&start=${start}`;
        await this.navigate(page, searchUrl);
        await page.waitForTimeout(3000); // Indeed can be slow

        const jobsOnPage = await this.extractJobsFromPage(page);
        if (jobsOnPage.length === 0) {
          logger.info(`No jobs found on Indeed page ${pageNum + 1}. Stopping pagination.`);
          break;
        }

        allJobs.push(...jobsOnPage);
        logger.info(`Found ${jobsOnPage.length} jobs on Indeed page ${pageNum + 1}`);
      }

      return allJobs;
    });
  }

  async extractJobDetails(url: string): Promise<JobListing> {
    return this.withPage(async (page) => {
      await this.navigate(page, url);
      await page.waitForTimeout(2000);

      const title = await page.locator('h1.jobsearch-JobInfoHeader-title').textContent().catch(() => "Unknown Title");
      const company = await page.locator('[data-testid="inlineHeader-companyName"]').textContent().catch(() => "Unknown Company");
      const location = await page.locator('[data-testid="job-location"]').textContent().catch(() => "Unknown Location");
      const description = await page.locator('#jobDescriptionText').textContent().catch(() => "");
      const salary = await page.locator('#salaryInfoAndJobType').textContent().catch(() => undefined);

      const visaMentioned = this.visaKeywords.some(kw => 
        description?.toLowerCase().includes(kw) || title?.toLowerCase().includes(kw)
      );

      return {
        title: title?.replace(/- job post/i, '')?.trim() || "Unknown Title",
        company: company?.trim() || "Unknown Company",
        location: location?.trim() || "Unknown Location",
        url,
        description: description?.trim() || "",
        salary: salary?.trim(),
        portalSource: "Indeed",
        visaSponsorshipMentioned: visaMentioned,
        scrapedAt: new Date(),
      };
    });
  }

  private async extractJobsFromPage(page: Page): Promise<JobListing[]> {
    const jobCards = await page.locator('td.resultContent').all();
    const jobs: JobListing[] = [];

    for (const card of jobCards) {
      try {
        const titleEl = card.locator('h2.jobTitle > a');
        const titleSpan = await titleEl.locator('span[title]').first();
        const title = await titleSpan.getAttribute("title").catch(() => null) || await titleEl.textContent();
        
        const href = await titleEl.getAttribute("href");
        const company = await card.locator('span[data-testid="company-name"]').textContent().catch(() => "Unknown");
        const location = await card.locator('div[data-testid="text-location"]').textContent().catch(() => "Unknown");
        const salary = await card.locator('div.metadata.salary-snippet-container').textContent().catch(() => undefined);

        if (title && href) {
          const url = this.toAbsoluteUrl("https://au.indeed.com", href);
          
          jobs.push({
            title: title.trim(),
            company: company?.trim() || "Unknown",
            location: location?.trim() || "Unknown",
            url,
            description: "", // Fetched properly in detail view
            salary: salary?.trim(),
            portalSource: "Indeed",
            visaSponsorshipMentioned: false, // Determined in full sweep
            scrapedAt: new Date(),
          });
        }
      } catch (error) {
        logger.warn("Failed to extract job card on Indeed", { error });
      }
    }

    return jobs;
  }
}
