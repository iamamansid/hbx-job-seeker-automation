import fs from "fs";

import { type Locator, type Page } from "playwright";

import { answerScreeningQuestion } from "../ai/screeningHandler";
import { generateCoverLetter } from "../ai/coverLetterGen";
import { APPLICANT, seekConfig } from "../config/config";
import { notifier } from "../notifications/notifier";
import { assertNoCaptcha } from "../utils/captcha";
import { humanDelay } from "../utils/humanDelay";
import { logger } from "../utils/logger";
import { normalizeForMatch } from "../utils/text";
import { type ApplicationResult, type JobDetails } from "./types";

const WORK_RIGHTS_PATTERNS = [/work rights/, /sponsorship/, /visa/, /right to work/];
const CONFIRMATION_PATTERNS = [/confirmation/, /success/, /applied/];

const isVisible = async (locator: Locator): Promise<boolean> =>
  (await locator.count()) > 0 && (await locator.isVisible().catch(() => false));

const textValue = async (locator: Locator): Promise<string> => (await locator.textContent().catch(() => ""))?.trim() || "";

const questionSelectors = [
  'fieldset[data-automation*="question"]',
  '[data-automation*="question"]',
  ".screening-question",
  'div[class*="question"]',
  "fieldset",
];

const findApplyControl = async (
  page: Page,
): Promise<{ locator: Locator; text: string; href?: string } | null> => {
  const selectors = [
    'a[data-automation="job-detail-apply"]',
    'button[data-automation="job-detail-apply"]',
    'a:has-text("Apply")',
    'button:has-text("Apply")',
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (!(await isVisible(locator))) {
      continue;
    }

    const text = await textValue(locator);
    const href = await locator.getAttribute("href").catch(() => undefined);
    return { locator, text, href: href ?? undefined };
  }

  return null;
};

const isSeekUrl = (url: string): boolean => /seek\.com\.au/i.test(url);

const looksExternal = (href?: string): boolean => Boolean(href && href.startsWith("http") && !isSeekUrl(href));

const findOptionTexts = async (container: Locator): Promise<string[]> => {
  const labelTexts = await container.locator("label").allTextContents().catch(() => []);
  const optionTexts = await container.locator("option").allTextContents().catch(() => []);
  return [...new Set([...labelTexts, ...optionTexts].map((value) => value.trim()).filter(Boolean))];
};

const getQuestionText = async (container: Locator): Promise<string> => {
  const selectors = ["legend", "label", "p", "h2", "h3", "span"];

  for (const selector of selectors) {
    const locator = container.locator(selector).first();
    if (await isVisible(locator)) {
      const text = await textValue(locator);
      if (text) {
        return text;
      }
    }
  }

  return "";
};

const findMatchingOptionLabel = async (container: Locator, answer: string): Promise<Locator | null> => {
  const labels = container.locator("label");
  const count = await labels.count();
  const normalizedAnswer = normalizeForMatch(answer);

  for (let index = 0; index < count; index += 1) {
    const label = labels.nth(index);
    const labelText = normalizeForMatch(await textValue(label));
    if (labelText === normalizedAnswer || labelText.includes(normalizedAnswer) || normalizedAnswer.includes(labelText)) {
      return label;
    }
  }

  return null;
};

const chooseSelectOption = async (select: Locator, answer: string): Promise<string | null> => {
  const options = await select.locator("option").evaluateAll((nodes) =>
    nodes.map((node) => ({
      label: (node.textContent ?? "").trim(),
      value: (node as HTMLOptionElement).value,
    })),
  );
  const normalizedAnswer = normalizeForMatch(answer);

  const exact = options.find(
    (option) =>
      normalizeForMatch(option.label) === normalizedAnswer ||
      normalizeForMatch(option.value) === normalizedAnswer,
  );
  if (exact) {
    return exact.value;
  }

  const partial = options.find(
    (option) =>
      normalizeForMatch(option.label).includes(normalizedAnswer) ||
      normalizedAnswer.includes(normalizeForMatch(option.label)),
  );

  return partial?.value ?? null;
};

const fillSalaryIfVisible = async (page: Page): Promise<void> => {
  const salaryField = page
    .locator('input[name*="salary"], input[placeholder*="salary"], input[inputmode="numeric"]')
    .first();

  if (await isVisible(salaryField)) {
    const existingValue = await salaryField.inputValue().catch(() => "");
    if (!existingValue) {
      await salaryField.fill("120000");
      await humanDelay(...seekConfig.timing.betweenFieldFills);
    }
  }
};

const uploadResumeIfVisible = async (page: Page): Promise<void> => {
  if (!fs.existsSync(seekConfig.paths.resumePath)) {
    logger.warn("Resume upload skipped because the configured resume file is missing.", {
      resumePath: seekConfig.paths.resumePath,
    });
    return;
  }

  const upload = page.locator('input[type="file"]').first();
  if (await isVisible(upload)) {
    await upload.setInputFiles(seekConfig.paths.resumePath);
    await humanDelay(1_500, 2_500);
  }
};

const fillCoverLetterIfVisible = async (
  page: Page,
  job: JobDetails,
  existingCoverLetter?: string,
): Promise<string | undefined> => {
  const coverLetterField = page
    .locator('textarea[name*="cover"], textarea[placeholder*="cover"], textarea')
    .first();

  if (!(await isVisible(coverLetterField))) {
    return existingCoverLetter;
  }

  const currentValue = await coverLetterField.inputValue().catch(() => "");
  if (currentValue.trim().length > 0) {
    return currentValue.trim();
  }

  const coverLetter = existingCoverLetter ?? (await generateCoverLetter(job));
  await coverLetterField.fill(coverLetter);
  await humanDelay(...seekConfig.timing.betweenFieldFills);
  logger.info("Cover letter filled into SEEK application form", {
    jobId: job.id,
    company: job.company,
    title: job.title,
    length: coverLetter.length,
  });
  return coverLetter;
};

const answerContainer = async (container: Locator): Promise<boolean> => {
  const questionText = await getQuestionText(container);
  if (questionText.trim().length < 5) {
    return false;
  }

  const textInput = container.locator('input[type="text"], input:not([type]), textarea').first();
  const numberInput = container.locator('input[type="number"]').first();
  const radioInputs = container.locator('input[type="radio"]');
  const selectInput = container.locator("select").first();
  const options = await findOptionTexts(container);
  const isWorkRightsQuestion = WORK_RIGHTS_PATTERNS.some((pattern) => pattern.test(normalizeForMatch(questionText)));

  if (await isVisible(textInput)) {
    const existingValue = await textInput.inputValue().catch(() => "");
    if (!existingValue) {
      const answer = await answerScreeningQuestion(questionText, "text");
      await textInput.fill(answer);
      await humanDelay(...seekConfig.timing.betweenFieldFills);
      logger.info("Filled screening text question", {
        question: questionText.slice(0, 200),
        answer,
      });
      return true;
    }
  }

  if (await isVisible(numberInput)) {
    const existingValue = await numberInput.inputValue().catch(() => "");
    if (!existingValue) {
      const answer = await answerScreeningQuestion(questionText, "number");
      await numberInput.fill(answer);
      await humanDelay(...seekConfig.timing.betweenFieldFills);
      logger.info("Filled screening number question", {
        question: questionText.slice(0, 200),
        answer,
      });
      return true;
    }
  }

  if ((await radioInputs.count()) > 0) {
    const checked = await radioInputs.evaluateAll((nodes) =>
      nodes.some((node) => (node as HTMLInputElement).checked),
    );
    if (!checked) {
      const answer = await answerScreeningQuestion(
        isWorkRightsQuestion ? `${questionText} (Answer honestly about sponsorship.)` : questionText,
        "radio",
        options,
      );
      const targetLabel = await findMatchingOptionLabel(container, answer);
      if (targetLabel && (await isVisible(targetLabel))) {
        await targetLabel.click();
        await humanDelay(...seekConfig.timing.betweenFieldFills);
        logger.info("Answered screening radio question", {
          question: questionText.slice(0, 200),
          answer,
          options,
        });
        return true;
      }
    }
  }

  if (await isVisible(selectInput)) {
    const value = await selectInput.inputValue().catch(() => "");
    if (!value) {
      const answer = await answerScreeningQuestion(
        isWorkRightsQuestion ? `${questionText} (Answer honestly about sponsorship.)` : questionText,
        "select",
        options,
      );
      const optionValue = await chooseSelectOption(selectInput, answer);
      if (optionValue) {
        await selectInput.selectOption(optionValue);
        await humanDelay(...seekConfig.timing.betweenFieldFills);
        logger.info("Answered screening select question", {
          question: questionText.slice(0, 200),
          answer,
          selectedValue: optionValue,
          options,
        });
        return true;
      }
    }
  }

  return false;
};

const fillDynamicQuestions = async (page: Page): Promise<void> => {
  const containers = page.locator(questionSelectors.join(", "));
  const count = await containers.count();

  logger.info("Scanning dynamic screening questions", { containerCount: count });

  for (let index = 0; index < count; index += 1) {
    const container = containers.nth(index);
    if (!(await container.isVisible().catch(() => false))) {
      continue;
    }

    await answerContainer(container).catch((error) => {
      logger.warn("Failed to answer one screening question container", { error, index });
    });
  }
};

const tickDeclarations = async (page: Page): Promise<void> => {
  const checkboxes = page.locator('input[type="checkbox"]');
  const count = await checkboxes.count();

  for (let index = 0; index < count; index += 1) {
    const checkbox = checkboxes.nth(index);
    if (!(await isVisible(checkbox)) || (await checkbox.isChecked().catch(() => false))) {
      continue;
    }

    const labelText = normalizeForMatch(
      (await checkbox.locator("xpath=ancestor::label[1]").textContent().catch(() => "")) ||
        (await checkbox.getAttribute("aria-label").catch(() => "")) ||
        "",
    );

    if (/agree|confirm|consent|privacy|terms|declare|acknowledge/.test(labelText)) {
      await checkbox.check();
      await humanDelay(...seekConfig.timing.betweenFieldFills);
    }
  }
};

const detectCurrentStep = async (page: Page, fallbackIndex: number): Promise<string> => {
  const indicators = ['[aria-current="step"]', '[data-automation*="progress"]', 'nav[aria-label*="progress"]', "h1", "h2"];

  for (const selector of indicators) {
    const locator = page.locator(selector).first();
    if (await isVisible(locator)) {
      const text = await textValue(locator);
      if (text) {
        return text;
      }
    }
  }

  return `Step ${fallbackIndex}`;
};

const isConfirmationPage = async (page: Page): Promise<boolean> => {
  const currentUrl = page.url();
  if (CONFIRMATION_PATTERNS.some((pattern) => pattern.test(currentUrl))) {
    return true;
  }

  const bodyText = normalizeForMatch((await page.locator("body").textContent().catch(() => "")) || "");
  return /application submitted|thanks for applying|application complete|you've applied/.test(bodyText);
};

const extractApplicationId = async (page: Page): Promise<string | undefined> => {
  const bodyText = (await page.locator("body").textContent().catch(() => "")) || "";
  const match = bodyText.match(/application\s*(id|reference)\s*[:#]?\s*([a-z0-9-]+)/i);
  return match?.[2];
};

const findActionButton = async (page: Page, labels: string[]): Promise<Locator | null> => {
  for (const label of labels) {
    const selectors = [
      `button:has-text("${label}")`,
      `[role="button"]:has-text("${label}")`,
      `input[type="submit"][value*="${label}"]`,
    ];

    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await isVisible(locator)) {
        return locator;
      }
    }
  }

  return null;
};

const handleExternalApplication = async (
  job: JobDetails,
  externalUrl: string,
): Promise<ApplicationResult> => {
  logger.info("External application detected; manual follow-up required.", {
    company: job.company,
    title: job.title,
    externalUrl,
  });
  await notifier.sendExternalApplication(job.title, job.company, externalUrl);
  return {
    success: false,
    type: "external",
    submitted: false,
    externalUrl,
    stepHistory: ["external-application"],
    notes: "External application flow requires manual follow-up.",
  };
};

const beginNativeFlow = async (
  page: Page,
  applyControl: { locator: Locator; text: string; href?: string },
): Promise<Page> => {
  const popupPromise = page.context().waitForEvent("page", { timeout: 5_000 }).catch(() => null);
  await applyControl.locator.click();
  const popup = await popupPromise;
  const activePage = popup ?? page;
  await activePage.waitForLoadState("networkidle").catch(() => undefined);
  await humanDelay(2_000, 4_000);
  return activePage;
};

const handleSeekNativeApplication = async (page: Page, job: JobDetails): Promise<ApplicationResult> => {
  let coverLetter: string | undefined;
  const stepHistory: string[] = [];

  logger.info("Entering SEEK native application flow", {
    jobId: job.id,
    company: job.company,
    title: job.title,
    dryRun: seekConfig.dryRun,
  });

  for (let step = 1; step <= 8; step += 1) {
    await assertNoCaptcha(page, `processing apply wizard step ${step}`);

    if (await isConfirmationPage(page)) {
      return {
        success: true,
        type: "seek-native",
        submitted: true,
        confirmationUrl: page.url(),
        applicationId: await extractApplicationId(page),
        coverLetter,
        stepHistory,
      };
    }

    stepHistory.push(await detectCurrentStep(page, step));
    logger.info("Processing SEEK apply wizard step", {
      jobId: job.id,
      company: job.company,
      title: job.title,
      step,
      detectedStep: stepHistory[stepHistory.length - 1],
      url: page.url(),
    });

    await uploadResumeIfVisible(page);
    coverLetter = await fillCoverLetterIfVisible(page, job, coverLetter);
    await fillSalaryIfVisible(page);
    await fillDynamicQuestions(page);
    await tickDeclarations(page);

    const submitButton = await findActionButton(page, [
      "Submit application",
      "Submit",
      "Apply now",
      "Send application",
      "Complete application",
    ]);
    const nextButton = await findActionButton(page, ["Next", "Continue", "Review"]);

    if (submitButton) {
      const buttonText = normalizeForMatch(await textValue(submitButton));

      if (seekConfig.dryRun) {
        logger.info("DRY_RUN enabled; submit click skipped.", {
          jobId: job.id,
          company: job.company,
          title: job.title,
          stepHistory,
        });
        return {
          success: true,
          type: "dry-run",
          submitted: false,
          coverLetter,
          stepHistory,
          notes: "Dry run completed through submit-ready state.",
        };
      }

      if (/submit|apply|send|complete/.test(buttonText)) {
        await submitButton.click();
        await page.waitForLoadState("networkidle").catch(() => undefined);
        await humanDelay(2_000, 4_000);
        logger.info("Clicked SEEK submit button", {
          jobId: job.id,
          company: job.company,
          title: job.title,
          url: page.url(),
        });

        if (await isConfirmationPage(page)) {
          return {
            success: true,
            type: "seek-native",
            submitted: true,
            confirmationUrl: page.url(),
            applicationId: await extractApplicationId(page),
            coverLetter,
            stepHistory,
          };
        }
      }
    }

    if (nextButton) {
      logger.info("Advancing SEEK apply wizard", {
        jobId: job.id,
        company: job.company,
        title: job.title,
        step,
      });
      await nextButton.click();
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await humanDelay(1_500, 3_000);
      continue;
    }

    if (await isConfirmationPage(page)) {
      return {
        success: true,
        type: "seek-native",
        submitted: true,
        confirmationUrl: page.url(),
        applicationId: await extractApplicationId(page),
        coverLetter,
        stepHistory,
      };
    }

    break;
  }

  throw new Error("Quick Apply wizard did not reach a confirmation state within the step limit.");
};

export const applyToJob = async (page: Page, job: JobDetails): Promise<ApplicationResult> => {
  try {
    logger.info("Opening SEEK job detail for apply", {
      jobId: job.id,
      company: job.company,
      title: job.title,
      url: job.url,
    });
    await page.goto(job.url, { waitUntil: "networkidle" });
    await humanDelay(...seekConfig.timing.betweenNavigations);
    await assertNoCaptcha(page, `opening apply flow for ${job.id}`);

    const applyControl = await findApplyControl(page);
    if (!applyControl) {
      throw new Error("Apply button could not be found on the job detail page.");
    }

    logger.info("Found SEEK apply control", {
      jobId: job.id,
      company: job.company,
      title: job.title,
      applyText: applyControl.text,
      href: applyControl.href,
    });

    const normalizedText = normalizeForMatch(applyControl.text);
    if (looksExternal(applyControl.href) && !/quick apply|on seek/.test(normalizedText)) {
      return await handleExternalApplication(job, applyControl.href as string);
    }

    const activePage = await beginNativeFlow(page, applyControl);
    if (!isSeekUrl(activePage.url())) {
      return await handleExternalApplication(job, activePage.url());
    }

    const buttonSuggestsNative = /on seek|quick apply|apply now|apply/.test(normalizedText);
    if (!buttonSuggestsNative && !activePage.url().includes("seek.com.au")) {
      return await handleExternalApplication(job, activePage.url());
    }

    logger.info("SEEK apply flow classified as native", {
      jobId: job.id,
      company: job.company,
      title: job.title,
      landingUrl: activePage.url(),
      buttonText: applyControl.text,
    });

    return await handleSeekNativeApplication(activePage, job);
  } catch (error) {
    logger.error("Failed during SEEK job application flow", {
      error,
      jobId: job.id,
      company: job.company,
      title: job.title,
      applicant: `${APPLICANT.firstName} ${APPLICANT.lastName}`,
    });
    throw error;
  }
};
