import { BrowserContext, Page, chromium } from "playwright";
import logger from "../utils/logger";
import * as fs from "fs";
import * as path from "path";

/**
 * LinkedIn Job Application Automation
 * Launches Chrome with local profile, searches jobs, and applies with manual assist when needed.
 */
class LinkedInScraper {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private chromeExecutablePath: string | null = null;
  private readonly answerHints = {
    sponsorship: process.env.REQUIRES_SPONSORSHIP === "true",
    relocate: process.env.WILLING_TO_RELOCATE === "true",
    visa: process.env.VISA_STATUS || "No",
    yearsExperience: process.env.YEARS_EXPERIENCE || "3",
    linkedInUrl: process.env.LINKEDIN_URL || "",
    portfolioUrl: process.env.PORTFOLIO_URL || "",
    currentLocation: process.env.CURRENT_LOCATION || "",
    resumePath: process.env.RESUME_PATH || "./data/resume.pdf",
  };

  async initialize(): Promise<void> {
    this.chromeExecutablePath = this.findChromeExecutablePath();
    const automationUserDataDir = path.join(process.cwd(), "data", "chrome-session");

    if (!fs.existsSync(automationUserDataDir)) {
      fs.mkdirSync(automationUserDataDir, { recursive: true });
    }

    logger.info("Launching Chrome automation session...");
    logger.info(`Session Directory: ${automationUserDataDir}`);
    logger.info(
      "This session persists login for future runs. If first run is not signed in, sign in once when prompted."
    );

    await this.launchWithUserDataDir(automationUserDataDir, "Default");
    logger.info("Browser initialized");
  }

  async searchLinkedInJobs(jobTitle: string, location: string): Promise<void> {
    if (!this.context) {
      throw new Error("Browser page not initialized");
    }
    this.page = await this.context.newPage();

    const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(
      jobTitle
    )}&location=${encodeURIComponent(location)}&f_AL=true`;

    logger.info("Navigating to LinkedIn Jobs...");
    await this.page.goto(searchUrl, { waitUntil: "domcontentloaded" });
    await this.page.waitForTimeout(2500);

    const isLoginUrl = this.page.url().includes("/login");
    const hasSignInButton = await this.page
      .locator('a:has-text("Sign in"), button:has-text("Sign in")')
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    if (isLoginUrl || hasSignInButton) {
      logger.warn("LinkedIn is not signed in.");
      logger.info("Please sign in in the opened browser window.");
      logger.info("Waiting for sign-in to complete...");
      const loggedIn = await this.waitForLinkedInLogin(10 * 60 * 1000);
      if (!loggedIn) {
        throw new Error(
          "LinkedIn sign-in was not detected within 10 minutes. Please rerun after signing in."
        );
      }
      logger.info("LinkedIn sign-in detected. Continuing...");
    } else {
      logger.info("LinkedIn session detected.");
    }

    logger.info(`Searching for "${jobTitle}" in "${location}"...`);
    await this.page.waitForTimeout(2500);
    logger.info("Search results loaded.");
  }

  async applyEasyApplyJobs(
    candidateName: string,
    candidateEmail: string,
    candidatePhone: string,
    maxApplications: number
  ): Promise<{ applied: number; failed: number; manualHelp: number }> {
    if (!this.page) {
      throw new Error("Browser page not initialized");
    }

    let applied = 0;
    let failed = 0;
    let manualHelp = 0;

    await this.page.waitForTimeout(2500);
    const jobItems = this.page.locator(
      [
        "a.job-card-list__title",
        "a.job-card-container__link",
        "li.jobs-search-results__list-item",
        "li.scaffold-layout__list-item",
        "li[data-occludable-job-id]",
      ].join(", ")
    );
    const cardCount = await jobItems.count();
    logger.info(`Found ${cardCount} job entries in current results list.`);

    const attempts = Math.min(
      cardCount,
      Math.max(maxApplications * 4, maxApplications)
    );

    for (let i = 0; i < attempts && applied < maxApplications; i++) {
      try {
        const item = jobItems.nth(i);
        await item.scrollIntoViewIfNeeded();
        await item.click({ timeout: 7000 });
        await this.page.waitForTimeout(1800);
        const jobLabel = (await item.textContent().catch(() => ""))?.trim() || `Job ${i + 1}`;
        logger.info(`Opened job: ${jobLabel}`);

        const easyApplyButton = await this.findVisibleLocator(
          this.page.locator(
            [
              "button.jobs-apply-button",
              "button[aria-label*='Easy Apply']",
              "button:has-text('Easy Apply')",
              "div.jobs-apply-button--top-card button",
            ].join(", ")
          )
        );

        if (easyApplyButton) {
          logger.info(`Opening Easy Apply modal for job ${i + 1}...`);
          await easyApplyButton.click();
          await this.page.waitForTimeout(1200);

          const result = await this.completeEasyApplyFlow(
            candidateName,
            candidateEmail,
            candidatePhone
          );

          if (result === "applied") {
            applied++;
            logger.info("Application submitted.");
            await this.dismissEasyApplyModal();
          } else if (result === "manual-help") {
            manualHelp++;
            logger.info("Manual help was required. Resumed automation.");
            await this.dismissEasyApplyModal();
          } else {
            failed++;
            logger.warn("Could not finish this application.");
            await this.dismissEasyApplyModal();
          }
          continue;
        }

        const externalApplyButton = await this.findVisibleLocator(
          this.page.locator(
            [
              "a.jobs-apply-button",
              "a[href*='http']:has-text('Apply')",
              "button:has-text('Apply on company website')",
              "button:has-text('Apply')",
            ].join(", ")
          )
        );
        if (externalApplyButton) {
          logger.info("Opening external application portal for manual completion...");
          const externalStatus = await this.handleExternalApplication(externalApplyButton);
          if (externalStatus === "submitted") {
            applied++;
            logger.info("External application submitted.");
          } else if (externalStatus === "manual-help") {
            manualHelp++;
            logger.info("External application needed manual help.");
          } else if (externalStatus === "skipped") {
            logger.info("External application skipped.");
          } else {
            failed++;
            logger.warn("External application failed.");
          }
          continue;
        }

        logger.info("No Easy Apply / Apply button found on this job. Skipping without failure.");
      } catch (error) {
        failed++;
        logger.warn(`Failed processing job card ${i + 1}:`, error);
        await this.dismissEasyApplyModal();
      }
    }

    return { applied, failed, manualHelp };
  }

  async autoFillForm(
    candidateName: string,
    candidateEmail: string,
    candidatePhone: string
  ): Promise<void> {
    if (!this.page) {
      throw new Error("Page not loaded");
    }

    logger.info("Attempting to auto-fill form...");

    const modal = this.page
      .locator(".jobs-easy-apply-modal, div[role='dialog']")
      .first();
    const formRoot =
      (await modal.isVisible({ timeout: 1000 }).catch(() => false)) ? modal : this.page;

    const inputs = await formRoot.locator("input, textarea").all();

    for (const input of inputs) {
      try {
        const type = await input.getAttribute("type");
        const name = await input.getAttribute("name");
        const placeholder = await input.getAttribute("placeholder");
        const value = await input.inputValue().catch(() => "");

        if (value && value.length > 0) {
          continue;
        }

        const fieldStr = `${name || ""} ${placeholder || ""}`.toLowerCase();

        if (fieldStr.includes("name") && !fieldStr.includes("company")) {
          await input.fill(candidateName);
          logger.info(`Filled name: ${candidateName}`);
        } else if (fieldStr.includes("email")) {
          await input.fill(candidateEmail);
          logger.info(`Filled email: ${candidateEmail}`);
        } else if (
          fieldStr.includes("phone") ||
          fieldStr.includes("cell") ||
          type === "tel"
        ) {
          await input.fill(candidatePhone);
          logger.info(`Filled phone: ${candidatePhone}`);
        }
      } catch {
        // Ignore fields that cannot be edited by automation.
      }
    }

    // Attempt select fields with first valid option when required and empty.
    const selects = await formRoot.locator("select").all();
    for (const select of selects) {
      try {
        const value = await select.inputValue().catch(() => "");
        if (value) {
          continue;
        }
        const options = await select.locator("option").all();
        for (const option of options) {
          const optionValue = (await option.getAttribute("value")) || "";
          if (optionValue.trim().length > 0) {
            await select.selectOption(optionValue);
            break;
          }
        }
      } catch {
        // Ignore select failures.
      }
    }

    await this.answerRequiredBooleanQuestions(formRoot as any);
  }

  async keepOpen(): Promise<void> {
    logger.info("Browser window is open for manual action.");
    logger.info("Press Ctrl+C in terminal to close.");
    await new Promise(() => {});
  }

  async close(): Promise<void> {
    try {
      if (this.context) {
        await this.context.close();
      }
      logger.info("Browser closed");
    } catch (error) {
      logger.error("Error closing browser:", error);
    }
  }

  private async completeEasyApplyFlow(
    candidateName: string,
    candidateEmail: string,
    candidatePhone: string
  ): Promise<"applied" | "failed" | "manual-help"> {
    if (!this.page) {
      return "failed";
    }

    let manualHelpTriggered = false;
    await this.waitForEasyApplyModal();

    for (let step = 0; step < 8; step++) {
      await this.autoFillForm(candidateName, candidateEmail, candidatePhone);
      await this.uncheckFollowCompanyIfPresent();

      const submitButton = await this.findVisibleLocator(
        this.page.locator(
          "button[aria-label*='Submit application'], button:has-text('Submit application'), button:has-text('Submit')"
        )
      );
      if (submitButton) {
        await submitButton.click();
        await this.page.waitForTimeout(2200);
        if (await this.isApplicationSubmitted()) {
          return manualHelpTriggered ? "manual-help" : "applied";
        }
        return manualHelpTriggered ? "manual-help" : "applied";
      }

      const nextOrReviewButton = await this.findVisibleLocator(
        this.page.locator(
          "button[aria-label*='Continue to next step'], button[aria-label*='Review your application'], button:has-text('Next'), button:has-text('Review'), button[aria-label*='Continue']"
        )
      );
      if (nextOrReviewButton) {
        await nextOrReviewButton.click();
        await this.page.waitForTimeout(1200);
        continue;
      }

      if (await this.hasUnresolvedRequiredFields()) {
        manualHelpTriggered = true;
        await this.waitForUserAction(
          "Manual help needed. Complete required fields in Chrome, then press Enter"
        );
        continue;
      }

      const hasValidationError = await this.page
        .locator(
          ".artdeco-inline-feedback--error, .jobs-easy-apply-form-section__grouping .t-14.t-black--light"
        )
        .first()
        .isVisible({ timeout: 800 })
        .catch(() => false);
      if (hasValidationError) {
        manualHelpTriggered = true;
        await this.waitForUserAction(
          "Validation requires manual response in Easy Apply. Complete in browser, then press Enter"
        );
        continue;
      }

      break;
    }

    return manualHelpTriggered ? "manual-help" : "failed";
  }

  private async hasUnresolvedRequiredFields(): Promise<boolean> {
    if (!this.page) {
      return false;
    }

    return this.page.evaluate(() => {
      const modal = (globalThis as any).document?.querySelector(
        ".jobs-easy-apply-modal"
      );
      if (!modal) {
        return false;
      }

      const fields = Array.from(
        modal.querySelectorAll("input, textarea, select")
      ) as any[];

      for (const field of fields) {
        const required =
          field.hasAttribute("required") ||
          field.getAttribute("aria-required") === "true";
        if (!required) {
          continue;
        }

        if (field.tagName?.toLowerCase() === "input") {
          const type = (field.type || "").toLowerCase();
          if ((type === "checkbox" || type === "radio") && !field.checked) {
            return true;
          }
        }

        if (!field.value || field.value.trim().length === 0) {
          return true;
        }
      }

      return false;
    });
  }

  private async dismissEasyApplyModal(): Promise<void> {
    if (!this.page) {
      return;
    }

    const dismiss = this.page
      .locator(
        "button[aria-label='Dismiss'], button[aria-label*='Discard'], button:has-text('Dismiss'), button[aria-label*='Close'], button:has-text('Done')"
      )
      .first();
    if (await dismiss.isVisible({ timeout: 1000 }).catch(() => false)) {
      await dismiss.click();
      await this.page.waitForTimeout(500);
    }

    const discard = this.page
      .locator(
        "button:has-text('Discard'), button[data-control-name='discard_application_confirm_btn']"
      )
      .first();
    if (await discard.isVisible({ timeout: 1000 }).catch(() => false)) {
      await discard.click();
      await this.page.waitForTimeout(700);
    }
  }

  private async waitForUserAction(promptText: string): Promise<void> {
    return new Promise((resolve) => {
      const readline = require("readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.question(`${promptText}\n> `, () => {
        rl.close();
        resolve();
      });
    });
  }

  private async waitForLinkedInLogin(timeoutMs: number): Promise<boolean> {
    if (!this.page) {
      return false;
    }

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const currentUrl = this.page.url();
      const stillLoginUrl = currentUrl.includes("/login");
      const signInVisible = await this.page
        .locator('a:has-text("Sign in"), button:has-text("Sign in")')
        .first()
        .isVisible({ timeout: 1000 })
        .catch(() => false);

      if (!stillLoginUrl && !signInVisible) {
        return true;
      }

      await this.page.waitForTimeout(3000);
    }

    return false;
  }

  private async answerRequiredBooleanQuestions(root: Page | any): Promise<void> {
    const groups = await root.locator("fieldset, [role='group']").all();
    for (const group of groups) {
      try {
        const text = ((await group.textContent()) || "").toLowerCase();
        const radios = group.locator("input[type='radio']");
        const count = await radios.count();
        if (count === 0) {
          continue;
        }

        const preferred = this.getPreferredAnswer(text); // "yes" | "no"
        let clicked = false;
        for (let i = 0; i < count; i++) {
          const radio = radios.nth(i);
          const id = await radio.getAttribute("id");
          let labelText = "";
          if (id) {
            labelText =
              ((await root
                .locator(`label[for="${id}"]`)
                .first()
                .textContent()
                .catch(() => "")) || "").toLowerCase();
          }
          if (!labelText) {
            labelText = ((await radio.evaluate((el: any) => {
              const l = el.closest("label");
              return l ? l.innerText : "";
            }).catch(() => "")) || "").toLowerCase();
          }
          if (labelText.includes(preferred)) {
            await radio.check().catch(async () => {
              await radio.click({ force: true }).catch(() => {});
            });
            clicked = true;
            break;
          }
        }

        if (!clicked) {
          // fallback: select first available option
          const first = radios.first();
          await first.check().catch(async () => {
            await first.click({ force: true }).catch(() => {});
          });
        }
      } catch {
        // best effort
      }
    }
  }

  private getPreferredAnswer(questionText: string): "yes" | "no" {
    const q = questionText.toLowerCase();
    if (q.includes("sponsor") || q.includes("sponsorship")) {
      return this.answerHints.sponsorship ? "yes" : "no";
    }
    if (q.includes("relocat")) {
      return this.answerHints.relocate ? "yes" : "no";
    }
    if (q.includes("visa") || q.includes("work authorization") || q.includes("work permit")) {
      return this.answerHints.visa.toLowerCase() === "yes" ? "yes" : "no";
    }
    return "yes";
  }

  private async handleExternalApplication(
    applyButton: any
  ): Promise<"submitted" | "manual-help" | "failed" | "skipped"> {
    if (!this.context || !this.page) {
      return "failed";
    }

    const originalPage = this.page;
    const pagesBefore = this.context.pages().length;

    await applyButton.click({ timeout: 7000 }).catch(() => {});
    await this.page.waitForTimeout(2000);

    let externalPage: Page | null = null;
    const pagesAfter = this.context.pages();
    if (pagesAfter.length > pagesBefore) {
      externalPage = pagesAfter[pagesAfter.length - 1];
    } else if (!this.page.url().includes("linkedin.com")) {
      externalPage = this.page;
    }

    if (!externalPage) {
      return "skipped";
    }

    try {
      await externalPage.bringToFront().catch(() => {});
      await externalPage.waitForTimeout(1500);
      await this.autoFillExternalForm(externalPage);

      for (let i = 0; i < 6; i++) {
        const submitLike = await this.findVisibleLocator(
          externalPage.locator(
            [
              "button[type='submit']",
              "input[type='submit']",
              "button:has-text('Submit')",
              "button:has-text('Apply')",
              "button:has-text('Send')",
              "button:has-text('Continue')",
              "button:has-text('Next')",
            ].join(", ")
          )
        );
        if (!submitLike) {
          break;
        }
        await submitLike.click().catch(() => {});
        await externalPage.waitForTimeout(1500);
        await this.autoFillExternalForm(externalPage);
        const done = await externalPage
          .locator("text=Application submitted, text=Thank you for applying, text=Your application has been received")
          .first()
          .isVisible({ timeout: 1000 })
          .catch(() => false);
        if (done) {
          if (externalPage !== originalPage) {
            await externalPage.close().catch(() => {});
          }
          await originalPage.bringToFront().catch(() => {});
          this.page = originalPage;
          return "submitted";
        }
      }

      await this.waitForUserAction(
        "External form needs manual completion. Submit in browser tab, then press Enter"
      );
      if (externalPage !== originalPage) {
        await externalPage.close().catch(() => {});
      }
      await originalPage.bringToFront().catch(() => {});
      this.page = originalPage;
      return "manual-help";
    } catch {
      if (externalPage !== originalPage) {
        await externalPage.close().catch(() => {});
      }
      await originalPage.bringToFront().catch(() => {});
      this.page = originalPage;
      return "failed";
    }
  }

  private async autoFillExternalForm(targetPage: Page): Promise<void> {
    const candidateName = process.env.CANDIDATE_NAME || "Candidate";
    const candidateEmail = process.env.CANDIDATE_EMAIL || "candidate@example.com";
    const candidatePhone = process.env.CANDIDATE_PHONE || "+61000000000";
    const linkedIn = this.answerHints.linkedInUrl;
    const portfolio = this.answerHints.portfolioUrl;
    const location = this.answerHints.currentLocation;

    const inputs = await targetPage.locator("input, textarea, select").all();
    for (const input of inputs) {
      try {
        const tag = (await input.evaluate((el: any) => el.tagName.toLowerCase())) as string;
        const type = ((await input.getAttribute("type")) || "").toLowerCase();
        const name = ((await input.getAttribute("name")) || "").toLowerCase();
        const id = ((await input.getAttribute("id")) || "").toLowerCase();
        const placeholder = ((await input.getAttribute("placeholder")) || "").toLowerCase();
        const combined = `${name} ${id} ${placeholder}`;

        if (tag === "select") {
          const value = await input.inputValue().catch(() => "");
          if (!value) {
            const options = await input.locator("option").all();
            for (const o of options) {
              const ov = (await o.getAttribute("value")) || "";
              if (ov) {
                await input.selectOption(ov).catch(() => {});
                break;
              }
            }
          }
          continue;
        }

        if (type === "radio" || type === "checkbox") {
          continue;
        }

        const currentVal = await input.inputValue().catch(() => "");
        if (currentVal) {
          continue;
        }

        if (combined.includes("name")) {
          await input.fill(candidateName).catch(() => {});
        } else if (combined.includes("email")) {
          await input.fill(candidateEmail).catch(() => {});
        } else if (combined.includes("phone") || type === "tel") {
          await input.fill(candidatePhone).catch(() => {});
        } else if (combined.includes("linkedin")) {
          await input.fill(linkedIn).catch(() => {});
        } else if (combined.includes("portfolio") || combined.includes("website")) {
          await input.fill(portfolio).catch(() => {});
        } else if (combined.includes("location") || combined.includes("city")) {
          await input.fill(location).catch(() => {});
        } else if (combined.includes("experience")) {
          await input.fill(this.answerHints.yearsExperience).catch(() => {});
        }
      } catch {
        // best effort
      }
    }

    const fileInput = await this.findVisibleLocator(
      targetPage.locator("input[type='file']")
    );
    if (fileInput && fs.existsSync(this.answerHints.resumePath)) {
      await fileInput.setInputFiles(this.answerHints.resumePath).catch(() => {});
    }
  }

  private async waitForEasyApplyModal(): Promise<void> {
    if (!this.page) {
      return;
    }

    await this.page
      .locator(".jobs-easy-apply-modal, div[role='dialog']")
      .first()
      .waitFor({ state: "visible", timeout: 6000 })
      .catch(() => {});
  }

  private async uncheckFollowCompanyIfPresent(): Promise<void> {
    if (!this.page) {
      return;
    }

    const followCheckbox = this.page
      .locator("label:has-text('Follow') input[type='checkbox'], input#follow-company-checkbox")
      .first();
    const visible = await followCheckbox
      .isVisible({ timeout: 800 })
      .catch(() => false);
    if (!visible) {
      return;
    }

    const checked = await followCheckbox.isChecked().catch(() => false);
    if (checked) {
      await followCheckbox.uncheck().catch(() => {});
    }
  }

  private async isApplicationSubmitted(): Promise<boolean> {
    if (!this.page) {
      return false;
    }

    const confirmation = await this.page
      .locator(
        "text=Application submitted, text=Your application was sent, button:has-text('Done')"
      )
      .first()
      .isVisible({ timeout: 1800 })
      .catch(() => false);
    return confirmation;
  }

  private async findVisibleLocator(base: any): Promise<any | null> {
    const count = await base.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const candidate = base.nth(i);
      const visible = await candidate.isVisible({ timeout: 500 }).catch(() => false);
      if (visible) {
        return candidate;
      }
    }
    return null;
  }

  private findChromeExecutablePath(): string | null {
    const chromeExecutables = [
      process.env.CHROME_EXECUTABLE_PATH || "",
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ].filter(Boolean);

    for (const chromePath of chromeExecutables) {
      if (fs.existsSync(chromePath)) {
        return chromePath;
      }
    }

    return null;
  }

  private async launchWithUserDataDir(
    userDataDir: string,
    profileDir: string
  ): Promise<void> {
    this.context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: this.chromeExecutablePath || undefined,
      headless: false,
      timeout: 45000,
      args: [
        `--profile-directory=${profileDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--start-maximized",
      ],
    });

    this.page = this.context.pages()[0] || (await this.context.newPage());
  }
}

export default LinkedInScraper;
