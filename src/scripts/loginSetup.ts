import { spawn, spawnSync, type ChildProcess } from "child_process";
import * as readline from "readline";

import Database from "better-sqlite3";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { chromium } from "playwright";

import { db } from "../db/jobDatabase";

const SEEK_LOGIN_URL = "https://www.seek.com.au/oauth/login";

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function getChromePath(): string {
  const platform = process.platform;

  if (platform === "win32") {
    const candidates = [
      path.join(
        process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
        "Google\\Chrome\\Application\\chrome.exe",
      ),
      path.join(
        process.env["PROGRAMFILES"] ?? "C:\\Program Files",
        "Google\\Chrome\\Application\\chrome.exe",
      ),
      path.join(
        process.env["LOCALAPPDATA"] ?? "",
        "Google\\Chrome\\Application\\chrome.exe",
      ),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    throw new Error(
      "Chrome not found. Install Google Chrome from https://www.google.com/chrome/",
    );
  }

  if (platform === "darwin") {
    const candidate = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    throw new Error(
      "Chrome not found. Install Google Chrome from https://www.google.com/chrome/",
    );
  }

  if (platform === "linux") {
    const candidates = [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    throw new Error(
      "Chrome not found. Install via: sudo apt install google-chrome-stable",
    );
  }

  throw new Error(`Unsupported platform: ${process.platform}`);
}

function launchChromeStandalone(chromePath: string, userDataDir: string): ChildProcess {
  const args = [
    `--user-data-dir=${userDataDir}`,
    "--profile-directory=Default",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-service-autorun",
    "--start-maximized",
    SEEK_LOGIN_URL,
  ];

  return spawn(chromePath, args, {
    stdio: "ignore",
    detached: false,
    windowsHide: false,
  });
}

function waitForEnter(prompt: string): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

async function killChromeAndWait(chromeProcess: ChildProcess): Promise<void> {
  console.log("\nClosing Chrome and flushing cookies to disk...");

  let exited = false;
  const exitPromise = new Promise<void>((resolve) => {
    chromeProcess.once("exit", () => {
      exited = true;
      resolve();
    });
  });

  if (process.platform === "win32") {
    spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `$p = Get-Process -Id ${String(chromeProcess.pid)} -ErrorAction SilentlyContinue; ` +
          "if ($p) { $null = $p.CloseMainWindow() }",
      ],
      {
        encoding: "utf8",
      },
    );
  } else {
    chromeProcess.kill("SIGTERM");
  }

  const timeout = new Promise<void>((resolve) => {
    setTimeout(resolve, 10000);
  });

  await Promise.race([exitPromise, timeout]);

  if (!exited && process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(chromeProcess.pid), "/f", "/t"], {
      encoding: "utf8",
    });
    await sleep(2000);
  }

  await sleep(2000);
  console.log("Chrome closed.");
}

interface CookieRow {
  host_key: string;
  name: string;
  value: string;
  encrypted_value: Buffer;
  path: string;
  expires_utc: number;
  is_secure: number;
  is_httponly: number;
  samesite: number;
}

interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

type PlaywrightStorageState = {
  cookies: PlaywrightCookie[];
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
};

function isSeekDomain(domain: string): boolean {
  const normalized = domain.toLowerCase().replace(/^\./, "");
  return (
    normalized === "seek.com" ||
    normalized.endsWith(".seek.com") ||
    normalized === "seek.com.au" ||
    normalized.endsWith(".seek.com.au") ||
    normalized === "seekpass.co" ||
    normalized.endsWith(".seekpass.co")
  );
}

function runPowerShell(command: string): string {
  const result = spawnSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
    {
      encoding: "utf8",
    },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || "PowerShell DPAPI decryption failed.");
  }

  return result.stdout.trim();
}

function dpapiDecryptWindows(buffer: Buffer): Buffer {
  const base64 = buffer.toString("base64");
  const command = [
    "Add-Type -AssemblyName System.Security",
    `$bytes = [Convert]::FromBase64String('${base64}')`,
    "$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser",
    "$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope)",
    "[Console]::Write([Convert]::ToBase64String($plain))",
  ].join("; ");

  return Buffer.from(runPowerShell(command), "base64");
}

function getChromeMasterKey(userDataDir: string): Buffer | null {
  const localStatePath = path.join(userDataDir, "Local State");
  if (!fs.existsSync(localStatePath)) {
    return null;
  }

  try {
    const localState = JSON.parse(fs.readFileSync(localStatePath, "utf8")) as {
      os_crypt?: { encrypted_key?: string };
    };

    const encryptedKey = localState.os_crypt?.encrypted_key;
    if (!encryptedKey) {
      return null;
    }

    const encryptedKeyBuffer = Buffer.from(encryptedKey, "base64");
    const dpapiPrefix = Buffer.from("DPAPI");
    const payload = encryptedKeyBuffer.subarray(dpapiPrefix.length);

    return process.platform === "win32" ? dpapiDecryptWindows(payload) : null;
  } catch {
    return null;
  }
}

function decryptChromeCookieValue(
  encryptedValue: Buffer,
  masterKey: Buffer | null,
): string {
  if (encryptedValue.length === 0) {
    return "";
  }

  if (process.platform === "win32") {
    const prefix = encryptedValue.subarray(0, 3).toString("utf8");

    if ((prefix === "v10" || prefix === "v11") && masterKey) {
      try {
        const iv = encryptedValue.subarray(3, 15);
        const ciphertext = encryptedValue.subarray(15, encryptedValue.length - 16);
        const authTag = encryptedValue.subarray(encryptedValue.length - 16);
        const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, iv);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
      } catch {
        return "";
      }
    }

    try {
      return dpapiDecryptWindows(encryptedValue).toString("utf8");
    } catch {
      return "";
    }
  }

  return "";
}

function isValidCookieValue(value: string): boolean {
  return !/[\u0000-\u001F\u007F]/.test(value);
}

function sanitizeCookies(cookies: PlaywrightCookie[]): PlaywrightCookie[] {
  return cookies.filter((cookie) => {
    if (!cookie.name || !cookie.domain || !cookie.path) {
      return false;
    }

    if (!isValidCookieValue(cookie.value)) {
      return false;
    }

    if (cookie.expires !== -1 && (!Number.isFinite(cookie.expires) || cookie.expires < 0)) {
      return false;
    }

    return true;
  });
}

function sanitizeStorageState(state: PlaywrightStorageState): PlaywrightStorageState {
  const cookies = sanitizeCookies(
    state.cookies.filter((cookie) => isSeekDomain(cookie.domain)),
  );

  const origins = state.origins.filter((origin) => {
    try {
      return isSeekDomain(new URL(origin.origin).hostname);
    } catch {
      return false;
    }
  });

  return {
    cookies,
    origins,
  };
}

function sameSiteFromInt(samesite: number): "Strict" | "Lax" | "None" {
  if (samesite === 1) {
    return "Lax";
  }

  if (samesite === 2) {
    return "Strict";
  }

  return "None";
}

function chromeTimeToUnix(chromeTime: number): number {
  if (chromeTime === 0) {
    return -1;
  }

  return Math.floor(chromeTime / 1_000_000) - 11644473600;
}

function getCookiesDbPath(userDataDir: string): string | null {
  const candidates = [
    path.join(userDataDir, "Default", "Network", "Cookies"),
    path.join(userDataDir, "Default", "Cookies"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function extractCookiesFromProfile(userDataDir: string): Promise<PlaywrightCookie[]> {
  const cookiesDbPath = getCookiesDbPath(userDataDir);

  if (!cookiesDbPath) {
    console.warn("WARNING: Cookies database not found in the Chrome profile.");
    return [];
  }

  const tempCookiesPath = `${cookiesDbPath}.tmp`;
  let copied = false;

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      fs.copyFileSync(cookiesDbPath, tempCookiesPath);
      copied = true;
      break;
    } catch (err) {
      if (attempt === 10) {
        console.error("Could not copy Cookies database:", err);
        return [];
      }

      await sleep(500);
    }
  }

  if (!copied) {
    return [];
  }

  let db: Database.Database | null = null;
  const cookies: PlaywrightCookie[] = [];
  const masterKey = getChromeMasterKey(userDataDir);

  try {
    db = new Database(tempCookiesPath, { readonly: true, fileMustExist: true });

    const rows = db
      .prepare(
        `
          SELECT
            host_key, name, value, encrypted_value,
            path, expires_utc, is_secure, is_httponly, samesite
          FROM cookies
          WHERE host_key LIKE 'seek.%'
             OR host_key LIKE '%.seek.%'
             OR host_key LIKE 'seekpass.%'
             OR host_key LIKE '%.seekpass.%'
        `,
      )
      .all() as CookieRow[];

    console.log(`Found ${rows.length} SEEK cookies in Chrome profile.`);

    for (const row of rows) {
      let value = row.value;

      if (!value && row.encrypted_value && row.encrypted_value.length > 0) {
        value = decryptChromeCookieValue(row.encrypted_value, masterKey);
      }

      if (!value) {
        continue;
      }

      cookies.push({
        name: row.name,
        value,
        domain: row.host_key,
        path: row.path,
        expires: chromeTimeToUnix(row.expires_utc),
        httpOnly: row.is_httponly === 1,
        secure: row.is_secure === 1,
        sameSite: sameSiteFromInt(row.samesite),
      });
    }
  } catch (err) {
    console.error("Error reading cookies database:", err);
  } finally {
    db?.close();
    try {
      fs.unlinkSync(tempCookiesPath);
    } catch {
      // Ignore cleanup failures.
    }
  }

  const sanitizedCookies = sanitizeCookies(cookies);

  if (sanitizedCookies.length !== cookies.length) {
    console.log(
      `Dropped ${cookies.length - sanitizedCookies.length} invalid cookies before saving storage state.`,
    );
  }

  return sanitizedCookies;
}

async function exportStorageStateFromProfile(
  chromePath: string,
  userDataDir: string,
): Promise<PlaywrightStorageState | null> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let context:
      | Awaited<ReturnType<typeof chromium.launchPersistentContext>>
      | undefined;

    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        executablePath: chromePath,
        headless: true,
        args: ["--profile-directory=Default", "--no-first-run", "--no-default-browser-check"],
        ignoreDefaultArgs: ["--enable-automation", "--password-store=basic", "--use-mock-keychain"],
      });

      const page = context.pages()[0] ?? (await context.newPage());
      await page
        .goto("https://www.seek.com.au", {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        })
        .catch(() => undefined);
      await sleep(2000);

      const state = (await context.storageState()) as PlaywrightStorageState;
      const sanitizedState = sanitizeStorageState(state);

      if (sanitizedState.cookies.length > 0) {
        return sanitizedState;
      }
    } catch (error) {
      if (attempt === 3) {
        console.warn("Playwright storage export failed for the dedicated Chrome profile.", error);
      }
    } finally {
      await context?.close().catch(() => undefined);
    }

    await sleep(1500);
  }

  return null;
}

function buildStorageState(cookies: PlaywrightCookie[]): PlaywrightStorageState {
  return {
    cookies,
    origins: [],
  };
}

function verifySeekSession(cookies: PlaywrightCookie[]): boolean {
  const requiredPatterns = [
    "_seek_au",
    "JobseekerSessionId",
    "JobseekerSessionToken",
    "registeredCandidateId",
    "seek_sessionid",
  ];
  const cookieNames = new Set(cookies.map((cookie) => cookie.name));

  const found = requiredPatterns.filter((name) =>
    [...cookieNames].some((cookieName) => cookieName.includes(name) || cookieName.includes("seek")),
  );

  if (found.length === 0) {
    const anySeekCookies = cookies.filter((cookie) => cookie.domain.includes("seek"));
    return anySeekCookies.length > 5;
  }

  return true;
}

async function manualLoginSetup(): Promise<void> {
  console.log("=".repeat(60));
  console.log("SEEK Manual Login Setup");
  console.log("=".repeat(60));
  console.log("");

  const dataDir = path.resolve("./data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const tempProfilePath = path.resolve("./data/chrome-profile-temp");
  try {
    fs.rmSync(tempProfilePath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup failures from prior runs.
  }
  fs.mkdirSync(tempProfilePath, { recursive: true });

  let chromePath: string;
  try {
    chromePath = getChromePath();
    console.log(`Chrome found: ${chromePath}`);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  console.log("");
  console.log("=".repeat(60));
  console.log("IMPORTANT INSTRUCTIONS:");
  console.log("=".repeat(60));
  console.log("");
  console.log("1. A dedicated Chrome profile will open at the SEEK login page");
  console.log("2. Log in using 'Continue with Google' or email OTP");
  console.log("3. If Google asks you to sign in again in this window, that is expected");
  console.log("4. Wait until your SEEK jobs dashboard is fully loaded");
  console.log("5. Come back to THIS TERMINAL");
  console.log("6. Press ENTER when you can see your SEEK dashboard");
  console.log("");
  console.log("Do NOT close the Chrome window yourself.");
  console.log("The script will close it automatically after you press ENTER.");
  console.log("This dedicated profile avoids Windows main-profile cookie encryption issues.");
  console.log("=".repeat(60));
  console.log("");

  const chromeProcess = launchChromeStandalone(chromePath, tempProfilePath);

  console.log("Chrome launched. Complete your login now.");
  console.log("");

  let chromeCrashed = false;
  chromeProcess.once("exit", (code) => {
    if (code !== 0 && code !== null) {
      chromeCrashed = true;
    }
  });

  await waitForEnter(">>> Press ENTER here when your SEEK dashboard is loaded... ");

  if (chromeCrashed) {
    console.error(
      "\nERROR: Chrome exited unexpectedly. Check that Google Chrome is properly installed and try again.",
    );
    process.exit(1);
  }

  await killChromeAndWait(chromeProcess);

  console.log("\nExporting session from the dedicated Chrome profile...");
  const exportedState = await exportStorageStateFromProfile(chromePath, tempProfilePath);
  let cookies = exportedState?.cookies ?? [];

  if (cookies.length > 0) {
    const sessionIsValid = verifySeekSession(cookies);

    if (!sessionIsValid) {
      console.warn(
        "\nWARNING: Session cookies were exported but SEEK authentication cookies appear missing. " +
          "You may not have been fully logged in when you pressed ENTER. The session has been " +
          "saved anyway.\nRun npm run dry-run to verify the session works.",
      );
    }

    await db.saveSession(JSON.stringify(exportedState));

    try {
      fs.rmSync(tempProfilePath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures.
    }

    console.log(`\nSession saved: ${cookies.length} cookies written to PostgreSQL.`);
    console.log("");
    console.log("=".repeat(60));
    console.log("Setup complete! Next steps:");
    console.log("  npm run dry-run   - verify session without applying");
    console.log("  npm start         - run the bot once");
    console.log("  npm run schedule  - run on automated schedule");
    console.log("=".repeat(60));
    await db.closePool();
    return;
  }

  console.log("Playwright session export returned no usable SEEK cookies. Falling back to SQLite extraction...");
  console.log("\nExtracting cookies from Chrome profile...");
  cookies = await extractCookiesFromProfile(tempProfilePath);

  if (cookies.length === 0) {
    try {
      fs.rmSync(tempProfilePath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures.
    }
    console.error(
      "\nERROR: No SEEK cookies found in the Chrome profile." +
        "\nPossible causes:" +
        "\n  - Login was not completed before pressing ENTER" +
        "\n  - Chrome did not flush cookies to disk in time" +
        "\n  - Cookie encryption is preventing extraction" +
        "\n\nPlease run `npm run login-setup` again and ensure you are fully" +
        "\nlogged into SEEK before pressing ENTER.",
    );
    process.exit(1);
  }

  const sessionIsValid = verifySeekSession(cookies);

  if (!sessionIsValid) {
    console.warn(
      "\nWARNING: Session cookies were found but SEEK authentication cookies appear missing. " +
        "You may not have been fully logged in when you pressed ENTER. The session has been " +
        "saved anyway.\nRun npm run dry-run to verify the session works.",
    );
  }

  const storageState = buildStorageState(cookies);
  await db.saveSession(JSON.stringify(storageState));

  try {
    fs.rmSync(tempProfilePath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup failures.
  }

  console.log(`\nSession saved: ${cookies.length} cookies written to PostgreSQL.`);
  console.log("");
  console.log("=".repeat(60));
  console.log("Setup complete! Next steps:");
  console.log("  npm run dry-run   - verify session without applying");
  console.log("  npm start         - run the bot once");
  console.log("  npm run schedule  - run on automated cron schedule");
  console.log("=".repeat(60));

  await db.closePool();
}

void manualLoginSetup().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
