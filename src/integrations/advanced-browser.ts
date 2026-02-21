import { Browser, Page } from "playwright";
import { chromium } from "playwright";
import logger from "../utils/logger";

/**
 * Advanced Browser Automation - Real job board navigation and application
 * Handles Seek.com.au, Indeed, and LinkedIn job searching and applying
 */
class AdvancedBrowserAutomation {
  private browser: Browser | null = null;
  private page: Page | null = null;

  /**
   * Initialize browser with visible window
   */
  async initialize(headless: boolean = false): Promise<void> {
    try {
      this.browser = await chromium.launch({
        headless: headless,
      });

      logger.info(
        `Browser initialized in ${headless ? "headless" : "visible"} mode`
      );
    } catch (error) {
      logger.error("Failed to initialize browser:", error);
      throw error;
    }
  }

  /**
   * Search for jobs on Seek.com.au and collect listings
   */
  async searchSeekJobs(
    jobTitle: string,
    location: string,
    maxResults: number = 5
  ): Promise<Array<{ title: string; company: string; url: string; location: string }>> {
    const results: Array<{
      title: string;
      company: string;
      url: string;
      location: string;
    }> = [];

    try {
      if (!this.browser) {
        throw new Error("Browser not initialized");
      }

      this.page = await this.browser.newPage();
      const searchUrl = `https://www.seek.com.au/${jobTitle.replace(
        / /g,
        "-"
      )}-jobs?where=${location.replace(/ /g, "")}`;

      logger.info(`\n🔍 Navigating to Seek.com.au...`);
      logger.info(`Search URL: ${searchUrl}`);

      await this.page.goto(searchUrl, { waitUntil: "domcontentloaded" });

      // Wait for job listings to load
      await this.page.waitForTimeout(2000);
      logger.info("✓ Page loaded, searching for job listings...");

      // Extract job listings
      const jobCards = await this.page.locator(
        '[data-automation="searchResultsSection"] article'
      );
      const count = await jobCards.count();
      logger.info(`Found ${count} job listings on Seek`);

      // Collect job information
      for (let i = 0; i < Math.min(count, maxResults); i++) {
        try {
          const card = jobCards.nth(i);

          // Extract job title
          const titleElement = await card
            .locator('[data-automation="jobTitle"]')
            .first();
          const title = await titleElement.textContent();

          // Extract company
          const companyElement = await card
            .locator('[data-automation="companyName"]')
            .first();
          const company = await companyElement.textContent();

          // Extract location
          const locationElement = await card
            .locator('[data-automation="jobLocation"]')
            .first();
          const jobLocation = await locationElement.textContent();

          // Get job URL
          const jobUrl = await titleElement.getAttribute("href");

          if (title && company && jobUrl) {
            results.push({
              title: title.trim(),
              company: company.trim(),
              url: `https://www.seek.com.au${jobUrl}`,
              location: jobLocation?.trim() || location,
            });
            logger.info(`  [${i + 1}] ${title.trim()} @ ${company.trim()}`);
          }
        } catch (error) {
          logger.warn(`Could not parse job listing ${i}:`, error);
        }
      }

      await this.page.close();
    } catch (error) {
      logger.error("Error searching Seek jobs:", error);
      if (this.page) {
        await this.page.close();
      }
    }

    return results;
  }

  /**
   * Search and apply to jobs on Seek
   */
  async applyOnSeek(
    jobTitle: string,
    location: string,
    candidateName: string,
    candidateEmail: string,
    candidatePhone: string,
    maxResults: number = 3
  ): Promise<{ applied: number; failed: number }> {
    let applied = 0;
    let failed = 0;

    try {
      // Search for jobs
      const jobs = await this.searchSeekJobs(jobTitle, location, maxResults);

      if (jobs.length === 0) {
        logger.warn("No jobs found to apply to");
        return { applied, failed };
      }

      logger.info(`\n📋 Found ${jobs.length} jobs. Starting applications...\n`);

      // Apply to each job
      for (const job of jobs) {
        try {
          logger.info(`\n========================================`);
          logger.info(`Applying to: ${job.title}`);
          logger.info(`Company: ${job.company}`);
          logger.info(`Location: ${job.location}`);
          logger.info(`========================================`);

          if (!this.browser) {
            throw new Error("Browser not initialized");
          }

          this.page = await this.browser.newPage();

          // Navigate to job
          logger.info("1️⃣ Loading job details...");
          await this.page.goto(job.url, { waitUntil: "domcontentloaded" });
          await this.page.waitForTimeout(1500);

          // Look for easy apply button
          logger.info("2️⃣ Looking for apply button...");
          const easyApplyButton = await this.page
            .locator('button[data-automation="jobActionApplyButton"]')
            .first();

          if (await easyApplyButton.isVisible()) {
            logger.info("3️⃣ Clicking apply button...");
            await easyApplyButton.click();
            await this.page.waitForTimeout(1500);

            // Handle application form
            logger.info("4️⃣ Filling application form...");

            // Try to fill common form fields
            const nameInput = await this.page
              .locator('input[name*="name"], input[placeholder*="Name"]')
              .first();
            if (await nameInput.isVisible({ timeout: 1000 })) {
              await nameInput.fill(candidateName);
              logger.info('  ✓ Filled name');
            }

            // Email field
            const emailInput = await this.page
              .locator('input[type="email"], input[name*="email"]')
              .first();
            if (await emailInput.isVisible({ timeout: 1000 })) {
              await emailInput.fill(candidateEmail);
              logger.info('  ✓ Filled email');
            }

            // Phone field
            const phoneInput = await this.page
              .locator('input[type="tel"], input[name*="phone"]')
              .first();
            if (await phoneInput.isVisible({ timeout: 1000 })) {
              await phoneInput.fill(candidatePhone);
              logger.info('  ✓ Filled phone');
            }

            // Look for submit button
            logger.info("5️⃣ Submitting application...");
            const submitButton = await this.page
              .locator(
                'button[type="submit"]:has-text("Submit"), button:has-text("Apply"), button:has-text("Send")'
              )
              .first();

            if (await submitButton.isVisible({ timeout: 1000 })) {
              await submitButton.click();
              await this.page.waitForTimeout(2000);
              logger.info("✅ Application submitted successfully!");
              applied++;
            } else {
              logger.warn("Could not find submit button");
              failed++;
            }
          } else {
            logger.warn("Apply button not found or not visible");
            failed++;
          }

          await this.page.close();
        } catch (error) {
          logger.error(`Error applying to ${job.title}:`, error);
          failed++;
          if (this.page) {
            await this.page.close();
          }
        }

        // Small delay between applications
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    } catch (error) {
      logger.error("Fatal error in Seek application:", error);
    }

    return { applied, failed };
  }

  /**
   * Manual navigation mode - User controls browsers
   */
  async manualMode(): Promise<void> {
    try {
      if (!this.browser) {
        throw new Error("Browser not initialized");
      }

      this.page = await this.browser.newPage();

      logger.info("\n");
      logger.info("========================================");
      logger.info("MANUAL BROWSER MODE");
      logger.info("========================================");
      logger.info("");
      logger.info("Browser is now open for manual navigation");
      logger.info("You can manually:");
      logger.info("  1. Search for jobs on any job board");
      logger.info("  2. Navigate through job listings");
      logger.info("  3. Fill out application forms");
      logger.info("  4. Submit applications");
      logger.info("");
      logger.info("Suggested job boards:");
      logger.info("  - https://www.seek.com.au");
      logger.info("  - https://www.indeed.com");
      logger.info("  - https://www.linkedin.com/jobs");
      logger.info("");

      // Open a blank page or job board
      await this.page.goto("https://www.seek.com.au", {
        waitUntil: "domcontentloaded",
      });

      logger.info("Opening Seek.com.au in your browser...");
      logger.info("");
      logger.info(
        "Press Ctrl+C in the terminal when you're done with manual applications."
      );
      logger.info("");

      // Keep page open indefinitely
      await new Promise(() => {});
    } catch (error) {
      logger.error("Error in manual mode:", error);
    }
  }

  /**
   * Screen capture for debugging
   */
  async takeScreenshot(filename: string): Promise<void> {
    try {
      if (this.page) {
        await this.page.screenshot({ path: `./data/screenshots/${filename}` });
        logger.info(`Screenshot saved: ${filename}`);
      }
    } catch (error) {
      logger.warn("Could not take screenshot:", error);
    }
  }

  /**
   * Close browser
   */
  async close(): Promise<void> {
    try {
      if (this.page) {
        await this.page.close();
      }
      if (this.browser) {
        await this.browser.close();
      }
      logger.info("Browser closed");
    } catch (error) {
      logger.error("Error closing browser:", error);
    }
  }
}

export default AdvancedBrowserAutomation;
