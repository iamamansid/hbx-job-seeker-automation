import { type Page } from "playwright";

import { CaptchaDetectedError } from "../seek/types";
import { normalizeForMatch } from "./text";

const CAPTCHA_PATTERNS = ["captcha", "are you human", "verify", "robot check"];

export const isCaptchaText = (text: string): boolean => {
  const normalized = normalizeForMatch(text);
  return CAPTCHA_PATTERNS.some((pattern) => normalized.includes(pattern));
};

export const assertNoCaptcha = async (page: Page, contextLabel: string): Promise<void> => {
  try {
    const bodyText = (await page.locator("body").textContent().catch(() => "")) ?? "";
    const titleText = await page.title().catch(() => "");
    const combined = `${titleText}\n${bodyText}`;

    if (isCaptchaText(combined)) {
      throw new CaptchaDetectedError(`CAPTCHA detected while ${contextLabel}`);
    }
  } catch (error) {
    if (error instanceof CaptchaDetectedError) {
      throw error;
    }

    throw error;
  }
};
