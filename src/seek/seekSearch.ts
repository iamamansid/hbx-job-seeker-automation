import crypto from "crypto";

import { type Locator, type Page } from "playwright";

import { SEARCH_QUERIES, SEEK_URL_PARAMS, seekConfig } from "../config/config";
import { type JobSearchListing, type SearchQuery } from "./types";
import { assertNoCaptcha } from "../utils/captcha";
import { humanDelay } from "../utils/humanDelay";
import { logger } from "../utils/logger";
import { withRetry } from "../utils/retry";

export { SEARCH_QUERIES, SEEK_URL_PARAMS } from "../config/config";

const toAbsoluteSeekUrl = (href: string): string =>
  href.startsWith("http") ? href : `https://www.seek.com.au${href.startsWith("/") ? href : `/${href}`}`;

const extractSeekJobId = (url: string): string => {
  const match = url.match(/\/job\/(\d+)/i);
  if (match?.[1]) {
    return match[1];
  }

  return crypto.createHash("sha1").update(url).digest("hex").slice(0, 12);
};

const extractListing = async (card: Locator): Promise<JobSearchListing | null> => {
  try {
    const payload = await card.evaluate((element) => {
      const queryText = (selector: string): string =>
        (element.querySelector(selector)?.textContent ?? "").trim();
      const titleAnchor = element.querySelector('a[data-automation="jobTitle"]') as HTMLAnchorElement | null;

      return {
        href: titleAnchor?.getAttribute("href") ?? "",
        title: (titleAnchor?.textContent ?? "").trim(),
        company: queryText('[data-automation="jobCompany"]'),
        location: queryText('[data-automation="jobLocation"]'),
        teaser: queryText('[data-automation="jobShortDescription"], [data-automation="job-snippet"]'),
        salary: queryText('[data-automation="jobSalary"]'),
        listedAt: queryText("time, [data-automation=\"jobListingDate\"]"),
      };
    });

    if (!payload.href || !payload.title) {
      return null;
    }

    const url = toAbsoluteSeekUrl(payload.href);

    return {
      id: extractSeekJobId(url),
      title: payload.title,
      company: payload.company || "Unknown Company",
      location: payload.location || "Unknown Location",
      url,
      teaser: payload.teaser || "",
      salary: payload.salary || undefined,
      listedAt: payload.listedAt || undefined,
    };
  } catch (error) {
    logger.warn("Failed to extract SEEK search listing", { error });
    return null;
  }
};

export const buildSeekSearchUrl = (query: SearchQuery, pageNumber = 1): string => {
  const url = new URL("https://www.seek.com.au/jobs");
  url.searchParams.set("keywords", query.keywords);
  url.searchParams.set("where", query.location);
  url.searchParams.set("dateRange", SEEK_URL_PARAMS.dateRange);
  url.searchParams.set("workType", SEEK_URL_PARAMS.workType);
  url.searchParams.set("sortMode", SEEK_URL_PARAMS.sortMode);
  url.searchParams.set("page", String(pageNumber));

  return url.toString();
};

export const seekSearch = async (page: Page, query: SearchQuery): Promise<JobSearchListing[]> => {
  try {
    const listings: JobSearchListing[] = [];
    const seenIds = new Set<string>();

    logger.info("Starting SEEK query", {
      keywords: query.keywords,
      location: query.location,
      maxPages: seekConfig.limits.maxPagesPerQuery,
    });

    for (let pageNumber = 1; pageNumber <= seekConfig.limits.maxPagesPerQuery; pageNumber += 1) {
      const searchUrl = buildSeekSearchUrl(query, pageNumber);

      await withRetry(
        async () => {
          await page.goto(searchUrl, { waitUntil: "networkidle" });
        },
        { label: `seekSearch:${query.keywords}:${pageNumber}` },
      );

      await humanDelay(...seekConfig.timing.betweenNavigations);
      await assertNoCaptcha(page, `searching SEEK for "${query.keywords}" page ${pageNumber}`);

      const cards = page.locator('article[data-automation="normalJob"], article[data-automation="premiumJob"]');
      const cardCount = await cards.count();

      logger.info("SEEK search page loaded", {
        keywords: query.keywords,
        location: query.location,
        pageNumber,
        cardCount,
        url: searchUrl,
      });

      if (cardCount === 0) {
        logger.info("No SEEK job cards found; stopping pagination for query.", {
          keywords: query.keywords,
          location: query.location,
          pageNumber,
        });
        break;
      }

      const pageExtractionStartedAt = Date.now();
      for (let index = 0; index < cardCount; index += 1) {
        const listing = await extractListing(cards.nth(index));
        if (!listing || seenIds.has(listing.id)) {
          if (index === 0 || (index + 1) % 5 === 0 || index === cardCount - 1) {
            logger.info("SEEK search extraction progress", {
              keywords: query.keywords,
              location: query.location,
              pageNumber,
              processedCards: index + 1,
              extractedListings: listings.length,
            });
          }
          continue;
        }

        seenIds.add(listing.id);
        listings.push(listing);

        if (index === 0 || (index + 1) % 5 === 0 || index === cardCount - 1) {
          logger.info("SEEK search extraction progress", {
            keywords: query.keywords,
            location: query.location,
            pageNumber,
            processedCards: index + 1,
            extractedListings: listings.length,
            latestJobId: listing.id,
            latestTitle: listing.title,
          });
        }
      }

      logger.info("SEEK search page extraction complete", {
        keywords: query.keywords,
        location: query.location,
        pageNumber,
        extractedCount: listings.length,
        durationMs: Date.now() - pageExtractionStartedAt,
      });
    }

    logger.info("SEEK query completed", {
      keywords: query.keywords,
      location: query.location,
      results: listings.length,
    });

    return listings;
  } catch (error) {
    logger.error("SEEK search failed", {
      error,
      keywords: query.keywords,
      location: query.location,
    });
    throw error;
  }
};
