import { BrowserContext, Page, chromium } from "playwright";
import logger from "../utils/logger";
import OllamaClient from "../llm/ollama-client";
import * as fs from "fs";
import * as path from "path";

/**
 * LinkedIn Job Application Automation
 * Launches Chrome with local profile, searches jobs, and applies with manual assist when needed.
 */
class LinkedInScraper {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private lastSearchUrl: string | null = null;
  private llm: OllamaClient | null = null;
  private llmAvailable = false;
  private readonly useLLMInBrowserFlow = process.env.BROWSER_LLM_THINKING !== "false";
  private chromeExecutablePath: string | null = null;
  private currentJobContext: {
    title: string;
    company: string;
    location: string;
    description: string;
  } = {
    title: "",
    company: "",
    location: "",
    description: "",
  };
  private inferredAnswerCache = new Map<string, string>();
  private processedJobKeys = new Set<string>();
  private readonly answerHints = {
    sponsorship: process.env.REQUIRES_SPONSORSHIP === "true",
    relocate: process.env.WILLING_TO_RELOCATE === "true",
    visa: process.env.VISA_STATUS || "No",
    yearsExperience: process.env.YEARS_EXPERIENCE || "3",
    linkedInUrl: process.env.LINKEDIN_URL || "",
    portfolioUrl: process.env.PORTFOLIO_URL || "",
    currentLocation: process.env.CURRENT_LOCATION || "",
    resumePath:
      process.env.RESUME_PATH || "C:\\Users\\amans\\Downloads\\AmanResume_Met.pdf",
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

    if (this.useLLMInBrowserFlow) {
      this.llm = new OllamaClient();
      logger.info("LLM-assisted browser reasoning is enabled.");
      this.llmAvailable = await this.llm.healthCheck().catch(() => false);
      if (!this.llmAvailable) {
        logger.warn("LLM is unavailable. External action selection will use heuristics only.");
      }
    }

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
    this.lastSearchUrl = searchUrl;

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
    this.processedJobKeys.clear();

    await this.page.waitForTimeout(2500);
    const jobItems = this.getJobItemsLocator();
    if (!jobItems) {
      throw new Error("Job list not available");
    }
    const cardCount = await jobItems.count();
    logger.info(`Found ${cardCount} job entries in current results list.`);

    const attempts = Math.min(
      cardCount,
      Math.max(maxApplications * 4, maxApplications)
    );

    for (let i = 0; i < attempts && applied < maxApplications; i++) {
      try {
        await this.ensureActiveLinkedInPage();
        if (!this.page) {
          throw new Error("LinkedIn page is not available");
        }

        const activeJobItems = this.getJobItemsLocator();
        const activeCount = activeJobItems ? await activeJobItems.count().catch(() => 0) : 0;
        if (!activeJobItems || i >= activeCount) {
          logger.info("Reached end of currently loaded job cards.");
          break;
        }

        const item = activeJobItems.nth(i);
        await item.scrollIntoViewIfNeeded();
        await item.click({ timeout: 7000 });
        await this.page.waitForTimeout(1800);
        const jobLabel = (await item.textContent().catch(() => ""))?.trim() || `Job ${i + 1}`;
        logger.info(`Opened job: ${jobLabel}`);
        this.inferredAnswerCache.clear();
        await this.captureCurrentJobContext(jobLabel);
        const jobKey = this.getJobKey();
        if (this.processedJobKeys.has(jobKey)) {
          logger.info("Duplicate job card detected. Skipping duplicate attempt.");
          continue;
        }
        this.processedJobKeys.add(jobKey);

        const easyApplyButton = await this.findApplyActionButton("easy");

        if (easyApplyButton) {
          logger.info(`Opening Easy Apply modal for job ${i + 1}...`);
          const modalOpened = await this.clickEasyApplyAndWaitForModal(easyApplyButton);
          if (!modalOpened) {
            logger.warn(
              "Easy Apply button click did not open modal. Trying external apply if available."
            );
            const externalFallbackButton = await this.findApplyActionButton("external");
            if (!externalFallbackButton) {
              continue;
            }
            logger.info("Opening external application portal as fallback...");
            const externalStatus = await this.handleExternalApplication(externalFallbackButton);
            if (externalStatus === "submitted") {
              applied++;
              logger.info("External application submitted.");
            } else if (externalStatus === "skipped") {
              logger.info("External application skipped.");
            } else {
              failed++;
              logger.warn("External application failed.");
            }
            continue;
          }

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

        const externalApplyButton = await this.findApplyActionButton("external");
        if (externalApplyButton) {
          logger.info("Opening external application portal for automated completion...");
          const externalStatus = await this.handleExternalApplication(externalApplyButton);
          if (externalStatus === "submitted") {
            applied++;
            logger.info("External application submitted.");
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
        const ariaLabel = await input.getAttribute("aria-label");
        const required =
          (await input.getAttribute("required")) !== null ||
          (await input.getAttribute("aria-required")) === "true";
        const value = await input.inputValue().catch(() => "");

        if (value && value.length > 0) {
          continue;
        }

        const inferredLabel = await this.getInputLabelContext(input);
        const fieldStr = `${name || ""} ${placeholder || ""} ${ariaLabel || ""} ${inferredLabel}`
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim();

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
        } else if (fieldStr.includes("location") || fieldStr.includes("city")) {
          if (this.answerHints.currentLocation) {
            await input.fill(this.answerHints.currentLocation).catch(() => {});
          }
        } else if (fieldStr.includes("linkedin")) {
          if (this.answerHints.linkedInUrl) {
            await input.fill(this.answerHints.linkedInUrl).catch(() => {});
          }
        } else if (fieldStr.includes("portfolio") || fieldStr.includes("website")) {
          if (this.answerHints.portfolioUrl) {
            await input.fill(this.answerHints.portfolioUrl).catch(() => {});
          }
        } else if (
          required &&
          (type === "text" ||
            type === "number" ||
            type === "search" ||
            type === "url" ||
            type === "tel" ||
            type === "email" ||
            type === null)
        ) {
          const inferred = await this.inferFieldAnswer(fieldStr, type || "text");
          if (inferred) {
            await input.fill(inferred).catch(() => {});
          }
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
        const name = (await select.getAttribute("name")) || "";
        const id = (await select.getAttribute("id")) || "";
        const aria = (await select.getAttribute("aria-label")) || "";
        const combined = `${name} ${id} ${aria}`.toLowerCase();
        const selected = await this.selectBestOptionForField(select, combined);
        if (!selected) {
          const options = await select.locator("option").all();
          for (const option of options) {
            const optionValue = (await option.getAttribute("value")) || "";
            if (optionValue.trim().length > 0) {
              await select.selectOption(optionValue);
              break;
            }
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
    const modalOpened = await this.waitForEasyApplyModal();
    if (!modalOpened) {
      return "failed";
    }

    for (let step = 0; step < 8; step++) {
      const submitButton = await this.findVisibleLocator(
        this.page.locator(
          "button[aria-label*='Submit application'], button:has-text('Submit application'), button:has-text('Submit')"
        )
      );
      if (submitButton) {
        await this.uncheckFollowCompanyIfPresent();
        const clickedSubmit = await this.clickPrimaryAction(submitButton, this.page);
        if (!clickedSubmit) {
          logger.warn("Submit button was visible but click failed. Trying next loop step.");
          await this.page.waitForTimeout(900);
          continue;
        }
        await this.page.waitForTimeout(2200);
        if (await this.isApplicationSubmitted()) {
          return manualHelpTriggered ? "manual-help" : "applied";
        }
        const modalStillOpen = await this.page
          .locator(".jobs-easy-apply-modal, div[role='dialog']")
          .first()
          .isVisible({ timeout: 800 })
          .catch(() => false);
        if (!modalStillOpen) {
          return manualHelpTriggered ? "manual-help" : "applied";
        }
      }

      await this.autoFillForm(candidateName, candidateEmail, candidatePhone);
      await this.uncheckFollowCompanyIfPresent();

      const nextOrReviewButton = await this.findVisibleLocator(
        this.page.locator(
          "button[aria-label*='Continue to next step'], button[aria-label*='Review your application'], button:has-text('Next'), button:has-text('Review'), button[aria-label*='Continue']"
        )
      );
      if (nextOrReviewButton) {
        await this.clickPrimaryAction(nextOrReviewButton, this.page);
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

    const modal = this.page
      .locator(".jobs-easy-apply-modal, div[role='dialog']")
      .first();
    const modalVisible = await modal.isVisible({ timeout: 1200 }).catch(() => false);
    if (!modalVisible) {
      return;
    }

    const dismiss = modal
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
    if ((root as any)?.isClosed?.()) {
      return;
    }
    if ((root as any)?.isDetached?.()) {
      return;
    }

    const groups = await root.locator("fieldset, [role='group']").all().catch(() => []);
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
  ): Promise<"submitted" | "failed" | "skipped"> {
    if (!this.context || !this.page) {
      return "failed";
    }

    const originalPage = this.page;
    const originalUrl = originalPage.url();
    const externalPage = await this.resolveExternalApplicationPage(
      applyButton,
      originalPage,
      originalUrl
    );

    if (!externalPage) {
      logger.info("[External] No external page detected after Apply click. Skipping.");
      return "skipped";
    }

    try {
      logger.info(`[External] Detected target page: ${externalPage.url()}`);
      await externalPage.bringToFront().catch(() => {});
      await externalPage.waitForTimeout(1500);
      const completionStatus = await this.completeExternalApplication(externalPage);
      logger.info(`[External] Completed with status: ${completionStatus}`);
      return completionStatus;
    } catch (error) {
      logger.warn("[External] Error while handling external application:", error);
      return "failed";
    } finally {
      await this.restoreFromExternalApplication(
        originalPage,
        originalUrl,
        externalPage
      );
    }
  }

  private async autoFillExternalForm(targetPage: Page): Promise<void> {
    const contexts = this.getExternalContexts(targetPage);
    for (const context of contexts) {
      try {
        await this.autoFillExternalFormInContext(context);
      } catch {
        // Best effort: frames/pages can detach or close during redirects/submission.
      }
    }
  }

  private async autoFillExternalFormInContext(root: Page | any): Promise<void> {
    if ((root as any)?.isClosed?.()) {
      return;
    }
    if ((root as any)?.isDetached?.()) {
      return;
    }

    const candidateName = process.env.CANDIDATE_NAME || "Candidate";
    const candidateEmail = process.env.CANDIDATE_EMAIL || "candidate@example.com";
    const candidatePhone = process.env.CANDIDATE_PHONE || "+61000000000";
    const linkedIn = this.answerHints.linkedInUrl;
    const portfolio = this.answerHints.portfolioUrl;
    const location = this.answerHints.currentLocation;

    const inputs = await root.locator("input, textarea, select").all();
    for (const input of inputs) {
      try {
        const tag = (await input.evaluate((el: any) => el.tagName.toLowerCase())) as string;
        const type = ((await input.getAttribute("type")) || "").toLowerCase();
        const name = ((await input.getAttribute("name")) || "").toLowerCase();
        const id = ((await input.getAttribute("id")) || "").toLowerCase();
        const placeholder = ((await input.getAttribute("placeholder")) || "").toLowerCase();
        const aria = ((await input.getAttribute("aria-label")) || "").toLowerCase();
        const inferredLabel = (await this.getInputLabelContext(input)).toLowerCase();
        const combined = `${name} ${id} ${placeholder} ${aria} ${inferredLabel}`.replace(/\s+/g, " ").trim();

        if (tag === "select") {
          const value = await input.inputValue().catch(() => "");
          if (!value) {
            const selected = await this.selectBestOptionForField(input, combined);
            if (!selected) {
              const options = await input.locator("option").all();
              for (const o of options) {
                const ov = (await o.getAttribute("value")) || "";
                if (ov) {
                  await input.selectOption(ov).catch(() => {});
                  break;
                }
              }
            }
          }
          continue;
        }

        if (type === "radio") {
          continue;
        }

        if (type === "checkbox") {
          const shouldCheck =
            combined.includes("terms") ||
            combined.includes("privacy") ||
            combined.includes("consent") ||
            combined.includes("agree") ||
            (await input.getAttribute("required")) !== null ||
            (await input.getAttribute("aria-required")) === "true";
          const alreadyChecked = await input.isChecked().catch(() => false);
          if (shouldCheck && !alreadyChecked) {
            await input.check().catch(() => {});
          }
          continue;
        }

        const currentVal = await input.inputValue().catch(() => "");
        if (currentVal) {
          continue;
        }
        const required =
          (await input.getAttribute("required")) !== null ||
          (await input.getAttribute("aria-required")) === "true";

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
        } else if (type === "number") {
          const inferred = await this.inferFieldAnswer(combined, "number");
          if (inferred) {
            await input.fill(inferred).catch(() => {});
          } else {
            await input.fill(this.answerHints.yearsExperience).catch(() => {});
          }
        } else if (required && (type === "text" || type === "search" || type === "" || tag === "textarea")) {
          const inferred = await this.inferFieldAnswer(combined, "text");
          if (inferred) {
            await input.fill(inferred).catch(() => {});
          }
        }
      } catch {
        // best effort
      }
    }

    await this.answerRequiredBooleanQuestions(root as any).catch(() => {});

    if (fs.existsSync(this.answerHints.resumePath)) {
      const fileInputs = await root.locator("input[type='file']").all();
      for (const fileInput of fileInputs) {
        const hasFile = await fileInput.inputValue().catch(() => "");
        if (hasFile) {
          continue;
        }
        const disabled = await fileInput.isDisabled().catch(() => false);
        if (disabled) {
          continue;
        }
        await fileInput.setInputFiles(this.answerHints.resumePath).catch(() => {});
      }
    }
  }

  private async resolveExternalApplicationPage(
    applyButton: any,
    originalPage: Page,
    originalUrl: string
  ): Promise<Page | null> {
    if (!this.context) {
      return null;
    }

    const pagesBefore = new Set(this.context.pages());
    const popupPromise = this.context
      .waitForEvent("page", { timeout: 9000 })
      .then(async (p) => {
        await p.waitForLoadState("domcontentloaded", { timeout: 12000 }).catch(() => {});
        return p;
      })
      .catch(() => null);

    const sameTabNavigationPromise = originalPage
      .waitForURL((url) => !url.toString().toLowerCase().includes("linkedin.com"), { timeout: 7000 })
      .then(() => originalPage)
      .catch(() => null);

    const clickedOpenTrigger = await this.clickExternalOpenTrigger(applyButton);
    if (!clickedOpenTrigger) {
      logger.info("[External] Could not click external apply trigger.");
      return null;
    }

    const firstDetected = await Promise.race([
      popupPromise,
      sameTabNavigationPromise,
      originalPage.waitForTimeout(2200).then(() => null),
    ]);

    if (firstDetected) {
      return firstDetected;
    }

    const popupPage = await popupPromise;
    if (popupPage) {
      return popupPage;
    }

    await originalPage.waitForTimeout(1800);
    const pagesAfter = this.context.pages();
    const newlyOpened = pagesAfter.find((p) => !pagesBefore.has(p)) || null;
    if (newlyOpened) {
      await newlyOpened.waitForLoadState("domcontentloaded", { timeout: 12000 }).catch(() => {});
      return newlyOpened;
    }

    const currentUrl = originalPage.url();
    if (
      currentUrl !== originalUrl &&
      !currentUrl.includes("linkedin.com")
    ) {
      return originalPage;
    }

    return null;
  }

  private async completeExternalApplication(
    externalPage: Page
  ): Promise<"submitted" | "failed" | "skipped"> {
    let activePage = externalPage;
    await activePage.waitForLoadState("domcontentloaded", { timeout: 12000 }).catch(() => {});
    let clickedAtLeastOneAction = false;
    let noProgressStreak = 0;
    const attemptedActionsByFingerprint = new Map<string, Set<string>>();

    for (let step = 0; step < 14; step++) {
      activePage = await this.adoptNewestExternalPage(activePage);
      if (activePage.isClosed()) {
        logger.info("[External] External page closed during flow; assuming completion.");
        return "submitted";
      }

      logger.info(`[External] Step ${step + 1}/14 - URL: ${activePage.url()}`);

      if (await this.isExternalLoginRequired(activePage)) {
        logger.info("External application requires login/authentication. Skipping this posting.");
        return "skipped";
      }

      if (await this.isExternalVerificationGate(activePage)) {
        logger.info("External application has anti-bot/verification gate. Skipping this posting.");
        return "skipped";
      }

      await this.autoFillExternalForm(activePage);

      if (await this.isExternalApplicationSubmitted(activePage)) {
        return "submitted";
      }

      const beforeFingerprint = await this.getPageFingerprint(activePage);
      const excludeSignatures = attemptedActionsByFingerprint.get(beforeFingerprint) || new Set<string>();
      const actionCandidate = await this.findExternalActionButton(activePage, excludeSignatures);
      if (!actionCandidate) {
        logger.info("[External] No actionable form button found on current step.");
        await activePage.waitForTimeout(900);
        if (await this.isExternalApplicationSubmitted(activePage)) {
          return "submitted";
        }
        break;
      }

      const buttonLabel = actionCandidate.label || (await this.getLocatorText(actionCandidate.locator));
      logger.info(`[External] Clicking action: ${buttonLabel || "<unlabeled>"}`);
      const clicked = await this.clickExternalAction(actionCandidate.locator, activePage);
      if (!clicked) {
        logger.info("[External] Could not click the selected action button.");
        break;
      }
      clickedAtLeastOneAction = true;

      await activePage.waitForTimeout(1300);
      activePage = await this.adoptNewestExternalPage(activePage);
      await activePage.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});

      const afterFingerprint = await this.getPageFingerprint(activePage);
      if (afterFingerprint === beforeFingerprint) {
        const attempted = attemptedActionsByFingerprint.get(beforeFingerprint) || new Set<string>();
        attempted.add(this.normalizeActionSignature(buttonLabel));
        attemptedActionsByFingerprint.set(beforeFingerprint, attempted);
        noProgressStreak++;
      } else {
        noProgressStreak = 0;
      }
      if (noProgressStreak >= 3) {
        logger.info("[External] No progress after repeated clicks. Skipping this posting.");
        return clickedAtLeastOneAction ? "failed" : "skipped";
      }
    }

    if (await this.isExternalApplicationSubmitted(activePage)) {
      return "submitted";
    }

    return clickedAtLeastOneAction ? "failed" : "skipped";
  }

  private async restoreFromExternalApplication(
    originalPage: Page,
    originalUrl: string,
    externalPage: Page | null
  ): Promise<void> {
    if (externalPage && externalPage !== originalPage && !externalPage.isClosed()) {
      await externalPage.close().catch(() => {});
    }
    await this.closeExtraExternalTabs(originalPage);

    if (originalPage.isClosed()) {
      if (this.context) {
        const fallback = this.context
          .pages()
          .find((p) => !p.isClosed() && p.url().includes("linkedin.com"));
        if (fallback) {
          await fallback.bringToFront().catch(() => {});
          this.page = fallback;
          return;
        }

        const recovered = await this.context.newPage().catch(() => null);
        if (recovered) {
          const destination = this.lastSearchUrl || "https://www.linkedin.com/jobs/";
          await recovered.goto(destination, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
          this.page = recovered;
          await recovered.bringToFront().catch(() => {});
          return;
        }
      }
      return;
    }

    if (!originalPage.url().includes("linkedin.com")) {
      const destination = originalUrl.includes("linkedin.com")
        ? originalUrl
        : "https://www.linkedin.com/jobs/";
      await originalPage
        .goto(destination, { waitUntil: "domcontentloaded", timeout: 25000 })
        .catch(() => {});
      await originalPage.waitForTimeout(1200);
    }

    await originalPage.bringToFront().catch(() => {});
    this.page = originalPage;
  }

  private async isExternalLoginRequired(targetPage: Page): Promise<boolean> {
    const url = targetPage.url().toLowerCase();
    if (
      url.includes("login") ||
      url.includes("sign-in") ||
      url.includes("signin") ||
      url.includes("auth")
    ) {
      return true;
    }

    const bodyText = await targetPage
      .locator("body")
      .innerText({ timeout: 2500 })
      .catch(() => "");
    const text = bodyText.toLowerCase();
    const hasLoginCue =
      text.includes("sign in") ||
      text.includes("log in") ||
      text.includes("create account") ||
      text.includes("forgot password");
    const hasCredentialCue =
      text.includes("password") ||
      text.includes("continue with google") ||
      text.includes("continue with linkedin");

    return hasLoginCue && hasCredentialCue;
  }

  private async isExternalApplicationSubmitted(targetPage: Page): Promise<boolean> {
    const contexts = this.getExternalContexts(targetPage);
    for (const context of contexts) {
      const submittedIndicator = await context
        .locator(
          [
            "text=Application submitted",
            "text=Thank you for applying",
            "text=Your application has been received",
            "text=Application received",
            "text=Submission complete",
            "text=Thanks for your interest",
            "text=We received your application",
          ].join(", ")
        )
        .first()
        .isVisible({ timeout: 900 })
        .catch(() => false);
      if (submittedIndicator) {
        return true;
      }
    }

    const url = targetPage.url().toLowerCase();
    if (
      url.includes("thank-you") ||
      url.includes("application-confirmation") ||
      url.includes("/submitted/") ||
      url.includes("application-submitted") ||
      url.includes("submission-complete")
    ) {
      return true;
    }

    return false;
  }

  private async findExternalActionButton(
    targetPage: Page,
    excludeSignatures: Set<string> = new Set<string>()
  ): Promise<{ locator: any; label: string; score: number } | null> {
    const contexts = this.getExternalContexts(targetPage);
    const rankedCandidates: Array<{
      locator: any;
      label: string;
      score: number;
    }> = [];

    for (const context of contexts) {
      const candidates = context.locator(
        [
          "form button[type='submit']",
          "form input[type='submit']",
          "button[type='submit']",
          "input[type='submit']",
          "form button",
          "form input[type='button']",
          "button",
          "input[type='button']",
          "a[role='button']",
          "a:has-text('Apply')",
          "a:has-text('Continue')",
          "a:has-text('Next')",
        ].join(", ")
      );
      const count = await candidates.count().catch(() => 0);

      for (let i = 0; i < count; i++) {
        const candidate = candidates.nth(i);
        const visible = await candidate.isVisible({ timeout: 400 }).catch(() => false);
        if (!visible) {
          continue;
        }

        const disabled = await candidate.isDisabled().catch(() => false);
        if (disabled) {
          continue;
        }

        const textContent = ((await candidate.textContent().catch(() => "")) || "").toLowerCase();
        const ariaLabel = ((await candidate.getAttribute("aria-label").catch(() => "")) || "").toLowerCase();
        const value = ((await candidate.getAttribute("value").catch(() => "")) || "").toLowerCase();
        const candidateType = ((await candidate.getAttribute("type").catch(() => "")) || "").toLowerCase();
        const href = ((await candidate.getAttribute("href").catch(() => "")) || "").toLowerCase();
        const tagName = await candidate
          .evaluate((el: any) => el.tagName?.toLowerCase?.() || "")
          .catch(() => "");
        const inForm = await candidate
          .evaluate((el: any) => Boolean(el.closest("form")))
          .catch(() => false);
        const combined = `${textContent} ${ariaLabel} ${value}`.replace(/\s+/g, " ").trim();
        if (!combined) {
          continue;
        }

        const isInformationalAction =
          combined.includes("how to apply") ||
          combined.includes("learn more") ||
          combined.includes("read more") ||
          combined.includes("view details") ||
          combined.includes("job details") ||
          combined.includes("about this role");
        if (isInformationalAction) {
          continue;
        }

        const isAuthAction =
          combined.includes("sign in") ||
          combined.includes("log in") ||
          combined.includes("create account") ||
          combined.includes("register") ||
          combined.includes("continue with google") ||
          combined.includes("continue with linkedin") ||
          combined.includes("with linkedin") ||
          combined.includes("with google") ||
          combined.includes("with apple") ||
          combined.includes("with indeed");
        if (isAuthAction) {
          continue;
        }

        const isNegativeAction =
          combined.includes("cancel") ||
          combined.includes("close") ||
          combined.includes("discard") ||
          combined.includes("back") ||
          combined.includes("previous");
        if (isNegativeAction) {
          continue;
        }

        const isUtilityAction =
          combined.includes("toggle flyout") ||
          combined.includes("remove file") ||
          combined.includes("dropbox") ||
          combined.includes("google drive") ||
          combined.includes("attach") ||
          combined.includes("upload from") ||
          combined.includes("enter manually") ||
          combined.includes("share") ||
          combined.includes("copy link");
        if (isUtilityAction) {
          continue;
        }

        const signature = this.normalizeActionSignature(combined);
        if (excludeSignatures.has(signature)) {
          continue;
        }

        const hasPrimaryActionIntent =
          combined.includes("submit") ||
          combined.includes("apply") ||
          combined.includes("continue") ||
          combined.includes("next") ||
          combined.includes("review") ||
          combined.includes("start") ||
          combined.includes("begin") ||
          combined.includes("proceed") ||
          combined.includes("finish") ||
          combined.includes("complete");
        const hasSecondaryActionIntent =
          combined.includes("i accept") ||
          combined.includes("accept") ||
          combined.includes("agree");
        const looksLikeSubmitControl =
          candidateType === "submit" ||
          (tagName === "button" && combined.length <= 24 && combined.includes("submit"));
        if (!hasPrimaryActionIntent && !looksLikeSubmitControl && !hasSecondaryActionIntent) {
          continue;
        }

        let score = 0;
        if (inForm) {
          score += 25;
        }
        if (tagName === "button" || tagName === "input") {
          score += 10;
        }

        if (combined.includes("submit application")) {
          score += 120;
        } else if (combined.includes("submit")) {
          score += 110;
        } else if (
          combined.includes("complete application") ||
          combined.includes("finish application")
        ) {
          score += 100;
        } else if (
          combined.includes("start application") ||
          combined.includes("begin application")
        ) {
          score += 95;
        } else if (combined.includes("apply now")) {
          score += 90;
        } else if (combined === "apply" || combined.startsWith("apply ")) {
          score += 80;
        } else if (combined.includes("send")) {
          score += 78;
        } else if (combined.includes("continue") || combined.includes("next")) {
          score += 70;
        } else if (combined.includes("review")) {
          score += 65;
        } else if (combined.includes("apply")) {
          score += 45;
        }
        if (candidateType === "submit") {
          score += 40;
        }

        if (href) {
          if (
            href.includes("how-to-apply") ||
            href.includes("candidate-how-to-apply") ||
            href.includes("/help") ||
            href.includes("/faq")
          ) {
            score -= 100;
          } else if (
            href.startsWith("http") &&
            !href.includes("apply") &&
            !href.includes("job") &&
            !inForm
          ) {
            score -= 40;
          }
        }

        if (score <= 0) {
          continue;
        }

        rankedCandidates.push({
          locator: candidate,
          label: combined,
          score,
        });
      }
    }

    if (rankedCandidates.length === 0) {
      return null;
    }

    rankedCandidates.sort((a, b) => b.score - a.score);
    const top = rankedCandidates[0];

    const llmChoice = await this.selectExternalActionWithLLM(
      targetPage,
      rankedCandidates.slice(0, 8)
    );
    if (llmChoice) {
      return llmChoice;
    }

    return top;
  }

  private async selectExternalActionWithLLM(
    targetPage: Page,
    candidates: Array<{ locator: any; label: string; score: number }>
  ): Promise<{ locator: any; label: string; score: number } | null> {
    if (!this.llm || !this.llmAvailable || candidates.length === 0) {
      return null;
    }

    try {
      const bodyText = await targetPage
        .locator("body")
        .innerText({ timeout: 1800 })
        .catch(() => "");
      const pageSnippet = bodyText.replace(/\s+/g, " ").substring(0, 1400);
      const options = candidates
        .map((c, idx) => `${idx}: ${c.label} (heuristicScore=${c.score})`)
        .join("\n");

      const systemPrompt = `You are selecting the single next button for an external job application flow.
Choose the option that most likely progresses or submits the application.
Avoid informational/navigation links like "how to apply", "learn more", "about", "faq", "back", "close", "share".
Return only JSON.`;

      const userPrompt = `URL: ${targetPage.url()}
Candidates:
${options}

Page text snippet:
${pageSnippet}

Return:
{
  "choice": number,
  "intent": "submit|progress|start|none",
  "reason": string
}`;

      const response = await this.llm.generateJSON<{
        choice: number;
        intent: string;
        reason: string;
      }>(systemPrompt, userPrompt);

      if (!response.success || !response.data) {
        return null;
      }

      const choice = Number(response.data.choice);
      if (!Number.isInteger(choice) || choice < 0 || choice >= candidates.length) {
        return null;
      }

      const selected = candidates[choice];
      logger.info(`[External][LLM] Selected action: ${selected.label}`);
      if (response.data.reason) {
        logger.info(`[External][LLM] Reason: ${response.data.reason}`);
      }
      return selected;
    } catch (error) {
      logger.warn("[External][LLM] Failed to select action with LLM:", error);
      return null;
    }
  }

  private async clickExternalOpenTrigger(locator: any): Promise<boolean> {
    try {
      await locator.click({ timeout: 7000 });
      return true;
    } catch (error) {
      logger.warn("[External] Initial click on apply trigger failed:", error);
      return false;
    }
  }

  private async clickExternalAction(locator: any, targetPage: Page): Promise<boolean> {
    const clicked = await this.clickPrimaryAction(locator, targetPage);
    if (!clicked) {
      return false;
    }
    await targetPage.waitForTimeout(500);
    return true;
  }

  private async adoptNewestExternalPage(currentPage: Page): Promise<Page> {
    if (!this.context) {
      return currentPage;
    }

    const externalPages = this.context
      .pages()
      .filter((p) => !p.isClosed() && !p.url().includes("linkedin.com"));
    if (externalPages.length === 0) {
      return currentPage;
    }

    const newest = externalPages[externalPages.length - 1];
    if (newest !== currentPage) {
      await newest.bringToFront().catch(() => {});
      await newest.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
      return newest;
    }

    return currentPage;
  }

  private async closeExtraExternalTabs(keepPage: Page): Promise<void> {
    if (!this.context) {
      return;
    }

    const toClose = this.context
      .pages()
      .filter(
        (p) =>
          !p.isClosed() &&
          p !== keepPage &&
          !p.url().includes("linkedin.com")
      );

    for (const page of toClose) {
      await page.close().catch(() => {});
    }
  }

  private async getPageFingerprint(targetPage: Page): Promise<string> {
    if (targetPage.isClosed()) {
      return "closed";
    }

    const url = targetPage.url().split("#")[0].split("?")[0];
    const title = await targetPage.title().catch(() => "");
    const body = await targetPage
      .locator("body")
      .innerText({ timeout: 1400 })
      .catch(() => "");
    const snippet = body.replace(/\s+/g, " ").toLowerCase().substring(0, 260);
    return `${url}|${title}|${snippet}`;
  }

  private async clickLocatorWithFallback(
    locator: any,
    targetPage: Page
  ): Promise<boolean> {
    await locator.click({ timeout: 6000 }).catch(() => {});
    await targetPage.waitForTimeout(250);
    if (!(await locator.isVisible({ timeout: 400 }).catch(() => false))) {
      return true;
    }

    await locator.click({ timeout: 6000, force: true }).catch(() => {});
    await targetPage.waitForTimeout(250);
    if (!(await locator.isVisible({ timeout: 400 }).catch(() => false))) {
      return true;
    }

    const jsClicked = await locator
      .evaluate((el: any) => {
        if (typeof el.click === "function") {
          el.click();
          return true;
        }
        return false;
      })
      .catch(() => false);

    return jsClicked;
  }

  private async clickPrimaryAction(locator: any, targetPage: Page): Promise<boolean> {
    const stableClick = await locator
      .scrollIntoViewIfNeeded()
      .then(async () => {
        await locator.click({ timeout: 6000 });
        return true;
      })
      .catch(() => false);

    if (stableClick) {
      return true;
    }

    const forcedClick = await locator
      .scrollIntoViewIfNeeded()
      .then(async () => {
        await locator.click({ timeout: 6000, force: true });
        return true;
      })
      .catch(() => false);
    if (!forcedClick) {
      return false;
    }

    await targetPage.waitForTimeout(250);
    return true;
  }

  private async waitForEasyApplyModal(): Promise<boolean> {
    if (!this.page) {
      return false;
    }

    const modalVisible = await this.page
      .locator(".jobs-easy-apply-modal, div[role='dialog']")
      .first()
      .waitFor({ state: "visible", timeout: 6000 })
      .then(() => true)
      .catch(() => false);

    return modalVisible;
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

  private async findApplyActionButton(kind: "easy" | "external"): Promise<any | null> {
    if (!this.page) {
      return null;
    }

    const candidates = this.page.locator(
      [
        "button.jobs-apply-button",
        "a.jobs-apply-button",
        "div.jobs-apply-button--top-card button",
        "button[aria-label*='Apply']",
        "a[aria-label*='Apply']",
        "button:has-text('Apply')",
        "a:has-text('Apply')",
      ].join(", ")
    );

    const count = await candidates.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const candidate = candidates.nth(i);
      const visible = await candidate.isVisible({ timeout: 500 }).catch(() => false);
      if (!visible) {
        continue;
      }

      const text = (((await candidate.textContent().catch(() => "")) || "").toLowerCase()).trim();
      const aria = (((await candidate.getAttribute("aria-label").catch(() => "")) || "").toLowerCase()).trim();
      const combined = `${text} ${aria}`.replace(/\s+/g, " ");

      const isEasyApply = combined.includes("easy apply");
      const isApply = combined.includes("apply");
      const isExternalApply =
        combined.includes("company website") ||
        combined.includes("external") ||
        (isApply && !isEasyApply);

      if (kind === "easy" && isEasyApply) {
        return candidate;
      }
      if (kind === "external" && isExternalApply) {
        return candidate;
      }
    }

    return null;
  }

  private async clickEasyApplyAndWaitForModal(easyApplyButton: any): Promise<boolean> {
    if (!this.page) {
      return false;
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt === 0) {
        await this.clickPrimaryAction(easyApplyButton, this.page).catch(() => {});
      } else if (attempt === 1) {
        await easyApplyButton.scrollIntoViewIfNeeded().catch(() => {});
        await easyApplyButton.click({ timeout: 6000, force: true }).catch(() => {});
      } else {
        await easyApplyButton.evaluate((el: any) => {
          if (typeof el.click === "function") {
            el.click();
          }
        }).catch(() => {});
      }

      await this.page.waitForTimeout(900);
      const modalOpened = await this.waitForEasyApplyModal();
      if (modalOpened) {
        return true;
      }
    }

    return false;
  }

  private getJobItemsLocator(): any | null {
    if (!this.page) {
      return null;
    }
    return this.page.locator(
      [
        "a.job-card-list__title",
        "a.job-card-container__link",
        "li.jobs-search-results__list-item",
        "li.scaffold-layout__list-item",
        "li[data-occludable-job-id]",
      ].join(", ")
    );
  }

  private async ensureActiveLinkedInPage(): Promise<void> {
    if (!this.context) {
      return;
    }

    if (this.page && !this.page.isClosed()) {
      if (!this.page.url().includes("linkedin.com")) {
        const destination = this.lastSearchUrl || "https://www.linkedin.com/jobs/";
        await this.page
          .goto(destination, { waitUntil: "domcontentloaded", timeout: 30000 })
          .catch(() => {});
      }
      return;
    }

    const openPages = this.context.pages().filter((p) => !p.isClosed());
    const linkedInPage =
      openPages.find((p) => p.url().includes("linkedin.com")) || openPages[0] || null;

    if (linkedInPage) {
      this.page = linkedInPage;
      await linkedInPage.bringToFront().catch(() => {});
      return;
    }

    const fallback = await this.context.newPage().catch(() => null);
    if (!fallback) {
      return;
    }

    const destination = this.lastSearchUrl || "https://www.linkedin.com/jobs/";
    await fallback.goto(destination, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await fallback.waitForTimeout(1200);
    await fallback.bringToFront().catch(() => {});
    this.page = fallback;
  }

  private async captureCurrentJobContext(jobLabelFallback: string): Promise<void> {
    if (!this.page) {
      return;
    }

    const title =
      ((await this.page
        .locator("h1, .job-details-jobs-unified-top-card__job-title, .t-24")
        .first()
        .textContent()
        .catch(() => "")) || "").trim() || jobLabelFallback;
    const company = ((await this.page
      .locator(
        ".job-details-jobs-unified-top-card__company-name a, .jobs-unified-top-card__company-name a, .t-14.t-black--light"
      )
      .first()
      .textContent()
      .catch(() => "")) || "").trim();
    const location = ((await this.page
      .locator(".job-details-jobs-unified-top-card__primary-description-container, .jobs-unified-top-card__bullet")
      .first()
      .textContent()
      .catch(() => "")) || "").trim();
    const description = ((await this.page
      .locator(".jobs-description__content, .jobs-box__html-content, .jobs-description-content__text")
      .first()
      .innerText()
      .catch(() => "")) || "")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 3000);

    this.currentJobContext = {
      title,
      company,
      location,
      description,
    };
  }

  private async inferFieldAnswer(fieldContext: string, fieldType: string): Promise<string | null> {
    const key = `${fieldType}:${fieldContext}`.substring(0, 300).toLowerCase();
    const cached = this.inferredAnswerCache.get(key);
    if (cached) {
      return cached;
    }

    const intent = this.detectFieldIntent(fieldContext, fieldType);
    const heuristic = this.getHeuristicFieldAnswer(fieldContext, fieldType);
    const shouldPreferHeuristic =
      intent === "location" ||
      intent === "notice-period" ||
      intent === "experience" ||
      intent === "linkedin" ||
      intent === "portfolio" ||
      intent === "sponsorship" ||
      intent === "relocate" ||
      intent === "visa";

    if (!this.llm || !this.llmAvailable) {
      if (heuristic) {
        this.inferredAnswerCache.set(key, heuristic);
      }
      return heuristic;
    }
    if (shouldPreferHeuristic && heuristic) {
      this.inferredAnswerCache.set(key, heuristic);
      return heuristic;
    }

    try {
      const systemPrompt = `You answer job application form fields for the candidate.
Return only the exact value for the field. No explanation, no markdown.`;
      const userPrompt = `Field hint: ${fieldContext}
Field type: ${fieldType}
Field intent: ${intent}

Candidate profile:
- Name: ${process.env.CANDIDATE_NAME || "Candidate"}
- Email: ${process.env.CANDIDATE_EMAIL || ""}
- Phone: ${process.env.CANDIDATE_PHONE || ""}
- Years experience: ${this.answerHints.yearsExperience}
- Current location: ${this.answerHints.currentLocation || "Not specified"}
- Needs sponsorship: ${this.answerHints.sponsorship ? "Yes" : "No"}
- Will relocate: ${this.answerHints.relocate ? "Yes" : "No"}
- LinkedIn: ${this.answerHints.linkedInUrl || "N/A"}
- Portfolio: ${this.answerHints.portfolioUrl || "N/A"}

Job context:
- Title: ${this.currentJobContext.title || "Unknown"}
- Company: ${this.currentJobContext.company || "Unknown"}
- Location: ${this.currentJobContext.location || "Unknown"}
- Description snippet: ${(this.currentJobContext.description || "").substring(0, 1200)}

If this is compensation/salary related, provide a realistic expected amount or range for this role/location.
If it asks yes/no, return just "Yes" or "No".
If numeric field, return digits only unless range is explicitly requested.`;

      const response = await this.llm.generate(userPrompt ? `${systemPrompt}\n\n${userPrompt}` : systemPrompt);
      const raw = (response.success && response.data ? response.data : "").trim().replace(/^["']|["']$/g, "");
      const normalized = this.normalizeInferredAnswer(raw, fieldType);
      const cleaned = this.isAnswerCompatibleWithIntent(normalized, intent, fieldType)
        ? normalized
        : heuristic;
      if (cleaned) {
        this.inferredAnswerCache.set(key, cleaned);
      }
      return cleaned;
    } catch {
      if (heuristic) {
        this.inferredAnswerCache.set(key, heuristic);
      }
      return heuristic;
    }
  }

  private detectFieldIntent(
    fieldContext: string,
    fieldType: string
  ): "salary" | "location" | "notice-period" | "linkedin" | "portfolio" | "experience" | "sponsorship" | "relocate" | "visa" | "generic" {
    const context = fieldContext.toLowerCase();
    if (context.includes("salary") || context.includes("compensation") || context.includes("ctc")) {
      return "salary";
    }
    if (context.includes("location") || context.includes("city")) {
      return "location";
    }
    if (context.includes("notice period") || context.includes("join") || context.includes("start date")) {
      return "notice-period";
    }
    if (context.includes("linkedin")) {
      return "linkedin";
    }
    if (context.includes("portfolio") || context.includes("website")) {
      return "portfolio";
    }
    if (context.includes("visa") || context.includes("work authorization") || context.includes("work permit")) {
      return "visa";
    }
    if (context.includes("sponsor") || context.includes("sponsorship")) {
      return "sponsorship";
    }
    if (context.includes("relocat")) {
      return "relocate";
    }
    if (context.includes("experience") || fieldType === "number") {
      return "experience";
    }
    return "generic";
  }

  private isAnswerCompatibleWithIntent(
    value: string | null,
    intent: "salary" | "location" | "notice-period" | "linkedin" | "portfolio" | "experience" | "sponsorship" | "relocate" | "visa" | "generic",
    fieldType: string
  ): boolean {
    if (!value) {
      return false;
    }
    const normalized = value.trim().toLowerCase();
    const hasSalarySignal = /\$|usd|aud|inr|eur|salary|compensation|ctc|k\b|per\s*(year|annum|hour)/i.test(
      normalized
    );
    const hasDigits = /\d/.test(normalized);

    if (intent === "location") {
      return !hasSalarySignal;
    }
    if (intent === "salary") {
      return hasSalarySignal || hasDigits;
    }
    if (intent === "experience" || fieldType === "number") {
      return /^-?\d+(\.\d+)?$/.test(normalized);
    }
    if (intent === "sponsorship" || intent === "relocate" || intent === "visa") {
      return normalized === "yes" || normalized === "no";
    }
    return true;
  }

  private normalizeInferredAnswer(value: string, fieldType: string): string | null {
    if (!value) {
      return null;
    }
    const compact = value.replace(/\s+/g, " ").trim();
    if (!compact) {
      return null;
    }
    if (fieldType === "number") {
      const numeric = compact.match(/-?\d+(\.\d+)?/);
      return numeric ? numeric[0] : null;
    }
    return compact.substring(0, 220);
  }

  private getHeuristicFieldAnswer(fieldContext: string, fieldType: string): string | null {
    const context = fieldContext.toLowerCase();
    if (context.includes("salary") || context.includes("compensation") || context.includes("ctc")) {
      return this.getExpectedSalaryFallback();
    }
    if (context.includes("notice period") || context.includes("join") || context.includes("start date")) {
      return "2 weeks";
    }
    if (context.includes("linkedin")) {
      return this.answerHints.linkedInUrl || null;
    }
    if (context.includes("portfolio") || context.includes("website")) {
      return this.answerHints.portfolioUrl || null;
    }
    if (context.includes("location") || context.includes("city")) {
      return this.answerHints.currentLocation || null;
    }
    if (context.includes("visa") || context.includes("work authorization") || context.includes("sponsor")) {
      return this.answerHints.sponsorship ? "Yes" : "No";
    }
    if (context.includes("relocat")) {
      return this.answerHints.relocate ? "Yes" : "No";
    }
    if (context.includes("experience") || fieldType === "number") {
      return this.answerHints.yearsExperience;
    }
    return null;
  }

  private getExpectedSalaryFallback(): string {
    const text = `${this.currentJobContext.location} ${this.currentJobContext.description}`.toLowerCase();
    const range = text.match(/(\$|usd|aud|inr|eur)\s?\d{2,3}[,\.]?\d{0,3}\s?(k|000)?\s?[-to]+\s?(\$|usd|aud|inr|eur)?\s?\d{2,3}[,\.]?\d{0,3}\s?(k|000)?/i);
    if (range) {
      return range[0].replace(/\s+/g, " ").trim();
    }
    if (text.includes("australia") || text.includes("sydney") || text.includes("melbourne")) {
      return "AUD 130000";
    }
    if (text.includes("india") || text.includes("bengaluru") || text.includes("bangalore")) {
      return "3500000";
    }
    return "140000";
  }

  private async selectBestOptionForField(selectLocator: any, combined: string): Promise<boolean> {
    const options = await selectLocator.locator("option").all().catch(() => []);
    if (!options || options.length === 0) {
      return false;
    }

    const preferredNo = this.answerHints.sponsorship ? "yes" : "no";
    const preferredRelocate = this.answerHints.relocate ? "yes" : "no";
    for (const option of options) {
      const value = ((await option.getAttribute("value").catch(() => "")) || "").toLowerCase();
      const text = ((await option.textContent().catch(() => "")) || "").toLowerCase();
      const optionText = `${value} ${text}`.trim();
      if (!optionText || optionText === "select" || optionText.includes("choose")) {
        continue;
      }

      if ((combined.includes("sponsor") || combined.includes("visa")) && optionText.includes(preferredNo)) {
        const optionValue = (await option.getAttribute("value").catch(() => "")) || "";
        await selectLocator.selectOption(optionValue).catch(() => {});
        return true;
      }
      if (combined.includes("relocat") && optionText.includes(preferredRelocate)) {
        const optionValue = (await option.getAttribute("value").catch(() => "")) || "";
        await selectLocator.selectOption(optionValue).catch(() => {});
        return true;
      }
      if (combined.includes("experience")) {
        const optionValue = (await option.getAttribute("value").catch(() => "")) || "";
        if (optionText.includes(this.answerHints.yearsExperience)) {
          await selectLocator.selectOption(optionValue).catch(() => {});
          return true;
        }
      }
    }

    return false;
  }

  private getExternalContexts(targetPage: Page): Array<Page | any> {
    const contexts: Array<Page | any> = [targetPage];
    for (const frame of targetPage.frames()) {
      if (frame === targetPage.mainFrame()) {
        continue;
      }
      if (frame.isDetached()) {
        continue;
      }
      contexts.push(frame);
    }
    return contexts;
  }

  private async isExternalVerificationGate(targetPage: Page): Promise<boolean> {
    const bodyText = await targetPage
      .locator("body")
      .innerText({ timeout: 2500 })
      .catch(() => "");
    const text = bodyText.toLowerCase();
    return (
      text.includes("captcha") ||
      text.includes("verify you are human") ||
      text.includes("security check") ||
      text.includes("cloudflare") ||
      text.includes("unusual traffic")
    );
  }

  private async getLocatorText(locator: any): Promise<string> {
    const text = ((await locator.textContent().catch(() => "")) || "").trim();
    if (text) {
      return text.replace(/\s+/g, " ").substring(0, 120);
    }

    const aria = ((await locator.getAttribute("aria-label").catch(() => "")) || "").trim();
    if (aria) {
      return aria.replace(/\s+/g, " ").substring(0, 120);
    }

    const value = ((await locator.getAttribute("value").catch(() => "")) || "").trim();
    return value.replace(/\s+/g, " ").substring(0, 120);
  }

  private async getInputLabelContext(input: any): Promise<string> {
    return input
      .evaluate((el: any) => {
        const ownLabel = (el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim();
        const id = (el.getAttribute("id") || "").trim();
        let forLabel = "";
        if (id) {
          const byFor = (globalThis as any).document?.querySelector?.(`label[for="${id}"]`);
          forLabel = ((byFor?.innerText || byFor?.textContent || "") as string).trim();
        }

        const wrappedLabel = (el.closest("label")?.innerText || "") as string;
        const parentText = (el.parentElement?.innerText || "").trim();
        const nearestLegend = (el.closest("fieldset")?.querySelector("legend")?.innerText || "") as string;

        return [ownLabel, forLabel, wrappedLabel, parentText, nearestLegend]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
          .substring(0, 260);
      })
      .catch(() => "");
  }

  private normalizeActionSignature(label: string): string {
    return (label || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 120);
  }

  private getJobKey(): string {
    const parts = [
      this.currentJobContext.title || "",
      this.currentJobContext.company || "",
      this.currentJobContext.location || "",
    ];
    return parts
      .join("|")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 240);
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
