import { type Cookie, type Page } from "playwright";

import { notifier } from "../notifications/notifier";
import { logger } from "../utils/logger";

const SEEK_HOME_URL = "https://www.seek.com.au";
const SEEK_COOKIE_URLS = ["https://www.seek.com.au", "https://login.seek.com", "https://www.seekpass.co"];
const SESSION_CHECK_TIMEOUT_MS = 15000;
const AUTH_COOKIE_HINTS = [
  "JobseekerSessionId",
  "JobseekerSessionToken",
  "registeredCandidateId",
  "appSession.0",
  "appSession.1",
  "auth0",
  "auth0_compat",
  "did",
  "did_compat",
];
const LOGGED_IN_INDICATORS = [
  '[data-automation="account-menu"]',
  '[data-testid="account-menu"]',
  'button[aria-label*="account" i]',
  'button[aria-label*="profile" i]',
  'a[href*="/my-activity"]',
  'a[href*="/profile"]',
  'text=/saved searches/i',
  'text=/recommended jobs/i',
];
const LOGIN_PAGE_INDICATORS = [
  'input[type="email"]',
  'button:has-text("Continue with Google")',
  'button:has-text("Email me a sign in code")',
  'text=/sign in/i',
];

const isLoginUrl = (url: string): boolean =>
  url.includes("login.seek.com") || url.includes("/oauth/login") || url.includes("/login?");

const hasUsefulAuthCookie = (cookie: Cookie): boolean =>
  AUTH_COOKIE_HINTS.some((name) => cookie.name === name || cookie.name.startsWith(name)) ||
  (cookie.name.toLowerCase().includes("seek") && cookie.value.length > 0);

const isSelectorVisible = async (page: Page, selector: string): Promise<boolean> => {
  try {
    return await page.locator(selector).first().isVisible();
  } catch {
    return false;
  }
};

async function hasAuthCookies(page: Page): Promise<boolean> {
  const cookies = await page.context().cookies(SEEK_COOKIE_URLS);
  return cookies.some(hasUsefulAuthCookie);
}

async function hasLoggedInIndicator(page: Page): Promise<boolean> {
  const deadline = Date.now() + SESSION_CHECK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    for (const selector of LOGGED_IN_INDICATORS) {
      if (await isSelectorVisible(page, selector)) {
        return true;
      }
    }

    await page.waitForTimeout(750);
  }

  return false;
}

async function hasLoginPageIndicator(page: Page): Promise<boolean> {
  for (const selector of LOGIN_PAGE_INDICATORS) {
    if (await isSelectorVisible(page, selector)) {
      return true;
    }
  }

  return false;
}

export async function ensureLoggedIn(page: Page): Promise<void> {
  logger.info("Checking SEEK session status...");

  try {
    await page.goto(SEEK_HOME_URL, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    const [loggedInIndicatorVisible, authCookiesPresent, loginPageVisible] = await Promise.all([
      hasLoggedInIndicator(page),
      hasAuthCookies(page),
      hasLoginPageIndicator(page),
    ]);

    if (loggedInIndicatorVisible) {
      logger.info("SEEK session valid - logged in successfully via page indicator.");
      return;
    }

    if (authCookiesPresent && !isLoginUrl(page.url()) && !loginPageVisible) {
      logger.warn(
        "SEEK session appears valid from cookies, but the account menu selector was not visible. Continuing.",
        {
          url: page.url(),
        },
      );
      return;
    }

    await handleSessionExpired(page.url(), authCookiesPresent, loginPageVisible);
  } catch (error) {
    logger.error("Error checking SEEK session:", error);
    await handleSessionExpired(page.url(), false, false);
  }
}

async function handleSessionExpired(
  currentUrl?: string,
  authCookiesPresent?: boolean,
  loginPageVisible?: boolean,
): Promise<never> {
  const message =
    "SEEK session expired or missing.\n" +
    "Run `npm run login-setup` on your machine to re-authenticate,\n" +
    "then restart the bot.";

  logger.error("SEEK session expired. Manual re-login required.", {
    currentUrl,
    authCookiesPresent,
    loginPageVisible,
  });
  logger.error("Run: npm run login-setup");

  try {
    await notifier.send(`WARNING: ${message}`);
  } catch {
    // Notifier may also fail if this is early startup - ignore
  }

  process.exit(1);
}
