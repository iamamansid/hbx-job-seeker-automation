import crypto from "crypto";

import { type Page } from "playwright";

import { type JobDetails, type JobSearchListing } from "./types";
import { assertNoCaptcha } from "../utils/captcha";
import { humanDelay } from "../utils/humanDelay";
import { logger } from "../utils/logger";
import { normalizeWhitespace } from "../utils/text";
import { withRetry } from "../utils/retry";

export const extractSeekJobId = (url: string): string => {
  const match = url.match(/\/job\/(\d+)/i);
  if (match?.[1]) {
    return match[1];
  }

  return crypto.createHash("sha1").update(url).digest("hex").slice(0, 12);
};

const extractKeyRequirements = (description: string, fallback: string): string => {
  const candidateLines = normalizeWhitespace(description)
    .split("\n")
    .map((line) => line.replace(/^[\u2022\-*]\s*/, "").trim())
    .filter((line) => line.length >= 20 && line.length <= 220);

  const preferredLines = candidateLines.filter((line) =>
    /java|spring|boot|azure|api|microservice|backend|docker|kubernetes|python|genai|llm|machine learning|react|typescript/i.test(
      line,
    ),
  );

  const lines = preferredLines.length > 0 ? preferredLines : candidateLines;
  return lines.slice(0, 6).join("; ") || fallback || "Job requirements not clearly listed";
};

export const parseSeekJobDetails = async (
  page: Page,
  listing: JobSearchListing,
): Promise<JobDetails> => {
  const detailPage = await page.context().newPage();

  try {
    await withRetry(
      async () => {
        await detailPage.goto(listing.url, { waitUntil: "networkidle" });
      },
      { label: `parseSeekJobDetails:${listing.id}` },
    );

    await humanDelay(2_000, 4_000);
    await assertNoCaptcha(detailPage, `opening job detail ${listing.id}`);

    const title =
      (await detailPage.locator('h1[data-automation="job-detail-title"], h1').first().textContent().catch(() => ""))?.trim() ||
      listing.title;
    const company =
      (await detailPage
        .locator('[data-automation="advertiser-name"], [data-automation="job-detail-company"]')
        .first()
        .textContent()
        .catch(() => ""))?.trim() || listing.company;
    const location =
      (await detailPage
        .locator('[data-automation="job-detail-location"], [data-automation="job-location"]')
        .first()
        .textContent()
        .catch(() => ""))?.trim() || listing.location;
    const salary =
      (await detailPage.locator('[data-automation="job-detail-salary"]').first().textContent().catch(() => undefined))?.trim() ??
      listing.salary;
    const postedDate =
      (await detailPage
        .locator('time[data-automation="job-detail-date"], time, [data-automation="job-detail-date"]')
        .first()
        .textContent()
        .catch(() => ""))?.trim() || listing.listedAt || new Date().toISOString();
    const description =
      normalizeWhitespace(
        (await detailPage
          .locator('[data-automation="jobAdDetails"], section[data-automation="jobAdDetails"]')
          .first()
          .textContent()
          .catch(() => "")) || listing.teaser,
      ) || listing.teaser;

    return {
      id: extractSeekJobId(listing.url),
      title,
      company,
      location,
      url: listing.url,
      teaser: listing.teaser,
      salary,
      listedAt: listing.listedAt,
      postedDate,
      description,
      scrapedAt: new Date().toISOString(),
      sponsorshipScore: "silent",
      sponsorshipSignals: [],
      excludeReasons: [],
      keyRequirements: extractKeyRequirements(description, listing.teaser),
    };
  } catch (error) {
    logger.error("Failed to parse SEEK job details", {
      error,
      jobId: listing.id,
      url: listing.url,
    });
    throw error;
  } finally {
    await detailPage.close().catch(() => undefined);
  }
};
