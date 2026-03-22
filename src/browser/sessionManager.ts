import { type Browser, type BrowserContext } from "playwright";

import { seekConfig } from "../config/config";
import { db } from "../db/jobDatabase";
import { logger } from "../utils/logger";

type BrowserContextOptions = NonNullable<Parameters<Browser["newContext"]>[0]>;
type SessionCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
};
type SessionOrigin = {
  origin: string;
  localStorage: Array<{ name: string; value: string }>;
};
type StorageStatePayload = {
  cookies: SessionCookie[];
  origins: SessionOrigin[];
};

const isValidCookieValue = (value: string): boolean => !/[\u0000-\u001F\u007F]/.test(value);

const sanitizeStorageState = (storageStateJson: string): StorageStatePayload => {
  const parsed = JSON.parse(storageStateJson) as {
    cookies?: Array<{
      name?: unknown;
      value?: unknown;
      domain?: unknown;
      path?: unknown;
      expires?: unknown;
      httpOnly?: unknown;
      secure?: unknown;
      sameSite?: unknown;
    }>;
    origins?: Array<{
      origin?: unknown;
      localStorage?: Array<{ name?: unknown; value?: unknown }>;
    }>;
  };

  const cookies = Array.isArray(parsed.cookies)
    ? parsed.cookies.filter((cookie) => {
        if (
          typeof cookie.name !== "string" ||
          typeof cookie.value !== "string" ||
          typeof cookie.domain !== "string" ||
          typeof cookie.path !== "string"
        ) {
          return false;
        }

        if (!isValidCookieValue(cookie.value)) {
          return false;
        }

        const expires =
          typeof cookie.expires === "number"
            ? cookie.expires
            : typeof cookie.expires === "string"
              ? Number(cookie.expires)
              : -1;

        if (expires !== -1 && (!Number.isFinite(expires) || expires < 0)) {
          return false;
        }

        cookie.expires = expires;
        cookie.httpOnly = Boolean(cookie.httpOnly);
        cookie.secure = Boolean(cookie.secure);
        cookie.sameSite =
          cookie.sameSite === "Strict" || cookie.sameSite === "Lax" || cookie.sameSite === "None"
            ? cookie.sameSite
            : "Lax";

        return true;
      })
    : [];

  const origins = Array.isArray(parsed.origins)
    ? parsed.origins
        .filter(
          (origin): origin is { origin: string; localStorage?: Array<{ name?: unknown; value?: unknown }> } =>
            typeof origin.origin === "string",
        )
        .map((origin) => ({
          origin: origin.origin,
          localStorage: Array.isArray(origin.localStorage)
            ? origin.localStorage
                .filter(
                  (entry): entry is { name: string; value: string } =>
                    typeof entry.name === "string" && typeof entry.value === "string",
                )
                .map((entry) => ({
                  name: entry.name,
                  value: entry.value,
                }))
            : [],
        }))
    : [];

  return {
    cookies: cookies as SessionCookie[],
    origins,
  };
};

const applyStealthScript = async (context: BrowserContext): Promise<void> => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
    });

    Object.defineProperty(navigator, "languages", {
      get: () => ["en-AU", "en"],
    });

    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5],
    });

    (window as Window & { chrome?: Record<string, unknown> }).chrome = {
      runtime: {},
    };
  });
};

export async function sessionExists(): Promise<boolean> {
  return db.sessionExists();
}

export async function getSessionAge(): Promise<number | null> {
  return db.getSessionAgeDays();
}

export async function createSessionContext(browser: Browser): Promise<BrowserContext> {
  const storageStateJson = await db.loadSession();
  if (!storageStateJson) {
    throw new Error(
      "No saved session found in PostgreSQL. Run `npm run login-setup` first to authenticate with SEEK.",
    );
  }

  const ageDays = await getSessionAge();
  if (ageDays !== null && ageDays > 25) {
    logger.warn("SEEK session is getting old and may expire soon.", {
      ageDays,
    });
  }

  const context = await browser.newContext({
    userAgent: seekConfig.browser.userAgent,
    viewport: seekConfig.browser.viewport,
    locale: seekConfig.browser.locale,
    timezoneId: seekConfig.browser.timezoneId,
    geolocation: seekConfig.browser.geolocation,
    permissions: ["geolocation"],
    extraHTTPHeaders: { "Accept-Language": seekConfig.browser.acceptLanguage },
    storageState: sanitizeStorageState(storageStateJson) as BrowserContextOptions["storageState"],
  });

  await applyStealthScript(context);
  return context;
}

export async function saveSession(context: BrowserContext): Promise<void> {
  const state = await context.storageState();
  await db.saveSession(JSON.stringify(state));
}
