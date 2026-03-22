import fs from "fs";
import fsPromises from "fs/promises";

import { PDFDocument } from "pdf-lib";
import { type Page } from "playwright";

import { seekConfig } from "../config/config";
import { humanDelay } from "../utils/humanDelay";
import { logger } from "../utils/logger";

const validateResumePdf = async (resumePath: string): Promise<void> => {
  const bytes = await fsPromises.readFile(resumePath);
  await PDFDocument.load(bytes);
};

export const syncSeekProfile = async (page: Page): Promise<void> => {
  try {
    if (!fs.existsSync(seekConfig.paths.resumePath)) {
      logger.warn("Resume file was not found; SEEK profile sync skipped.", {
        resumePath: seekConfig.paths.resumePath,
      });
      return;
    }

    await validateResumePdf(seekConfig.paths.resumePath);

    await page.goto("https://www.seek.com.au/profile", { waitUntil: "networkidle" });
    await humanDelay(...seekConfig.timing.betweenNavigations);

    const upload = page.locator('input[type="file"]').first();
    if ((await upload.count()) > 0 && (await upload.isVisible().catch(() => false))) {
      await upload.setInputFiles(seekConfig.paths.resumePath);
      await humanDelay(1_500, 2_500);
      logger.info("SEEK profile resume upload completed.");
    } else {
      logger.info("SEEK profile sync found no visible file input; existing stored resume will be used.");
    }
  } catch (error) {
    logger.warn("SEEK profile sync could not complete; continuing with application flow.", { error });
  }
};
