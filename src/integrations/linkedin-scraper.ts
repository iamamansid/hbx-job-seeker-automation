import type { BrowserContext, Page } from "playwright";

import { config, type Config } from "../config/index";
import { type JobListing } from "../types/index";
import { logger } from "../utils/logger";
import { BrowserLifecycleManager } from "../browser/browser-lifecycle-manager";
import { BaseJobScraper } from "./job-scraper";

type LinkedInSearchCard = {
  title: string;
  company: string;
  location: string;
  url: string;
};

export class LinkedInScraper extends BaseJobScraper {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private lastSearchUrl: string | null = null;

  constructor(
    browserLifecycleManager: BrowserLifecycleManager,
    runtimeConfig: Config = config,
  ) {
    super(browserLifecycleManager, runtimeConfig);
  }

  async initialize(): Promise<void> {
    if (this.page && !this.page.isClosed()) {
      return;
    }

    const session = await this.browserLifecycleManager.createPage();
    this.context = session.context;
    this.page = session.page;
    logger.info("LinkedIn scraper attached to shared browser");
  }

  async searchLinkedInJobs(jobTitle: string, location: string): Promise<void> {
    await this.initialize();
    if (!this.page) {
      throw new Error("LinkedIn page is not initialized");
    }

    const searchUrl = this.buildSearchUrl(`${jobTitle} visa sponsorship`, location, 0);
    this.lastSearchUrl = searchUrl;
    await this.navigate(this.page, searchUrl);
    await this.page.waitForTimeout(2_000);
  }

  async applyEasyApplyJobs(
    candidateName: string,
    candidateEmail: string,
    candidatePhone: string,
    maxApplications: number,
  ): Promise<{ applied: number; failed: number; manualHelp: number }> {
    await this.initialize();
    if (!this.page) {
      throw new Error("LinkedIn page is not initialized");
    }

    let applied = 0;
    let failed = 0;
    let manualHelp = 0;

    const cards = this.page.locator("li.scaffold-layout__list-item, li[data-occludable-job-id]");
    const cardCount = await cards.count();

    for (let index = 0; index < cardCount && applied < maxApplications; index += 1) {
      const card = cards.nth(index);

      try {
        await card.scrollIntoViewIfNeeded();
        await card.click({ timeout: 5_000 });
        await this.page.waitForTimeout(1_500);

        const easyApplyButton = this.page
          .locator("button:has-text('Easy Apply'), button[aria-label*='Easy Apply']")
          .first();

        const easyApplyVisible = await easyApplyButton.isVisible({ timeout: 2_000 }).catch(() => false);
        if (!easyApplyVisible) {
          continue;
        }

        await easyApplyButton.click();
        await this.page.waitForTimeout(1_000);
        await this.fillEasyApplyInputs(candidateName, candidateEmail, candidatePhone);

        if (!this.runtimeConfig.agent.enableAutoSubmit) {
          manualHelp += 1;
          logger.info("Easy Apply detected but auto-submit is disabled; leaving for manual review");
          await this.dismissDialog(this.page);
          continue;
        }

        const submitted = await this.advanceEasyApplyFlow(this.page);
        if (submitted) {
          applied += 1;
        } else {
          failed += 1;
        }

        await this.dismissDialog(this.page);
      } catch (error) {
        failed += 1;
        logger.warn(`Failed LinkedIn Easy Apply flow for card ${index + 1}`, { error });
        await this.dismissDialog(this.page);
      }
    }

    return { applied, failed, manualHelp };
  }

  async keepOpen(): Promise<void> {
    logger.info("LinkedIn browser session left open. Press Ctrl+C to close it.");
    await new Promise(() => undefined);
  }

  async searchJobs(keywords: string[], location: string, maxPages: number): Promise<JobListing[]> {
    return this.withPage(async (page, context) => {
      const detailPage = await context.newPage();
      const jobs: JobListing[] = [];
      let pagesRemaining = maxPages;

      try {
        for (const keyword of keywords) {
          for (let pageIndex = 0; pageIndex < maxPages && pagesRemaining > 0; pageIndex += 1, pagesRemaining -= 1) {
            const searchUrl = this.buildSearchUrl(keyword, location, pageIndex);
            await this.navigate(page, searchUrl);
            await page.waitForTimeout(2_000);

            const cards = await this.collectSearchCards(page);
            for (const card of cards) {
              try {
                const detail = await this.extractJobDetailsWithPage(detailPage, card.url, card);
                jobs.push(detail);
              } catch (error) {
                logger.warn(`Failed to extract LinkedIn details for ${card.url}`, { error });
              }
            }
          }
        }
      } finally {
        await this.browserLifecycleManager.closePage(detailPage);
      }

      return this.sortByVisaRelevancy(this.dedupeJobs(jobs));
    });
  }

  async extractJobDetails(url: string): Promise<JobListing> {
    return this.withPage((page) => this.extractJobDetailsWithPage(page, url));
  }

  async close(): Promise<void> {
    await this.browserLifecycleManager.closePage(this.page);
    await this.browserLifecycleManager.closeContext(this.context);
    this.page = null;
    this.context = null;
  }

  private buildSearchUrl(keyword: string, location: string, pageIndex: number): string {
    const start = pageIndex * 25;
    return (
      "https://www.linkedin.com/jobs/search/?" +
      `keywords=${encodeURIComponent(keyword)}` +
      `&location=${encodeURIComponent(location)}` +
      "&f_WT=2" +
      `&start=${start}`
    );
  }

  private async collectSearchCards(page: Page): Promise<LinkedInSearchCard[]> {
    await page.waitForSelector("li.scaffold-layout__list-item, li[data-occludable-job-id]", {
      timeout: this.runtimeConfig.browser.timeout,
    });

    const cards: LinkedInSearchCard[] = [];
    const locator = page.locator("li.scaffold-layout__list-item, li[data-occludable-job-id]");
    const count = await locator.count();

    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      const title =
        this.normalizeText(
          await item.locator("a.job-card-list__title, a.job-card-container__link").first().textContent(),
        ) || "Unknown title";
      const company =
        this.normalizeText(
          await item.locator(".job-card-container__company-name, .artdeco-entity-lockup__subtitle").first().textContent(),
        ) || "Unknown company";
      const cardLocation =
        this.normalizeText(
          await item.locator(".job-card-container__metadata-item, .job-search-card__location").first().textContent(),
        ) || "";
      const href = await item
        .locator("a.job-card-list__title, a.job-card-container__link")
        .first()
        .getAttribute("href");
      const url = this.toAbsoluteUrl("https://www.linkedin.com", href);

      if (!url) {
        continue;
      }

      cards.push({ title, company, location: cardLocation, url });
    }

    return cards;
  }

  private async extractJobDetailsWithPage(
    page: Page,
    url: string,
    summary?: LinkedInSearchCard,
  ): Promise<JobListing> {
    await this.navigate(page, url);
    await page.waitForTimeout(1_500);

    const title =
      this.normalizeText(
        await page.locator("h1.top-card-layout__title, h1.topcard__title, h1").first().textContent(),
      ) || summary?.title || "Unknown title";
    const company =
      this.normalizeText(
        await page
          .locator(".topcard__org-name-link, .topcard__flavor a, .topcard__flavor")
          .first()
          .textContent(),
      ) || summary?.company || "Unknown company";
    const location =
      this.normalizeText(
        await page
          .locator(".topcard__flavor--bullet, .job-details-jobs-unified-top-card__primary-description-container")
          .first()
          .textContent(),
      ) || summary?.location || this.runtimeConfig.search.targetCountry;
    const description =
      this.normalizeText(
        await page
          .locator(
            ".show-more-less-html__markup, .description__text, .jobs-description__content, .jobs-box__html-content",
          )
          .first()
          .textContent(),
      ) || "";

    return this.buildListing({
      title,
      company,
      location,
      url,
      description,
      salary: this.extractSalary(description),
      portalSource: "LinkedIn",
      visaSponsorshipMentioned: this.hasVisaSponsorshipMention(description),
    });
  }

  private async fillEasyApplyInputs(
    candidateName: string,
    candidateEmail: string,
    candidatePhone: string,
  ): Promise<void> {
    if (!this.page) {
      return;
    }

    const modalRoot = this.page.locator(".jobs-easy-apply-modal, div[role='dialog']").first();
    const rootVisible = await modalRoot.isVisible({ timeout: 2_000 }).catch(() => false);
    const root = rootVisible ? modalRoot : this.page.locator("body");

    const allInputs = root.locator("input, textarea");
    const count = await allInputs.count();

    for (let index = 0; index < count; index += 1) {
      const input = allInputs.nth(index);
      const type = (await input.getAttribute("type"))?.toLowerCase() ?? "text";
      const name = `${(await input.getAttribute("name")) ?? ""} ${(await input.getAttribute("placeholder")) ?? ""}`.toLowerCase();

      if (type === "hidden" || type === "submit") {
        continue;
      }

      const currentValue = await input.inputValue().catch(() => "");
      if (currentValue) {
        continue;
      }

      if (name.includes("name")) {
        await input.fill(candidateName).catch(() => undefined);
      } else if (name.includes("email") || type === "email") {
        await input.fill(candidateEmail).catch(() => undefined);
      } else if (name.includes("phone") || type === "tel") {
        await input.fill(candidatePhone).catch(() => undefined);
      }
    }
  }

  private async advanceEasyApplyFlow(page: Page): Promise<boolean> {
    for (let step = 0; step < 5; step += 1) {
      const submitButton = page
        .locator("button:has-text('Submit application'), button[aria-label*='Submit application']")
        .first();
      if (await submitButton.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await submitButton.click().catch(() => undefined);
        await page.waitForTimeout(1_500);
        return true;
      }

      const nextButton = page
        .locator("button:has-text('Next'), button:has-text('Review'), button[aria-label*='Continue']")
        .first();
      if (await nextButton.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await nextButton.click().catch(() => undefined);
        await page.waitForTimeout(1_200);
        continue;
      }

      break;
    }

    return false;
  }

  private async dismissDialog(page: Page): Promise<void> {
    const dismissButton = page
      .locator(
        "button[aria-label='Dismiss'], button[aria-label*='Close'], button:has-text('Discard'), button:has-text('Done')",
      )
      .first();
    if (await dismissButton.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await dismissButton.click().catch(() => undefined);
      await page.waitForTimeout(500);
    }

    const discardButton = page.locator("button:has-text('Discard')").first();
    if (await discardButton.isVisible({ timeout: 500 }).catch(() => false)) {
      await discardButton.click().catch(() => undefined);
      await page.waitForTimeout(500);
    }
  }
}
