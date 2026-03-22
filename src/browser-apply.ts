import { BrowserLifecycleManager } from "./browser/browser-lifecycle-manager";
import { config } from "./config/index";
import { LinkedInScraper } from "./integrations/linkedin-scraper";
import { logger } from "./utils/logger";

async function main(): Promise<void> {
  const browserLifecycleManager = BrowserLifecycleManager.getInstance(config);
  const linkedInScraper = new LinkedInScraper(browserLifecycleManager, config);
  const manualMode = process.argv.includes("--manual");

  try {
    await linkedInScraper.initialize();
    await linkedInScraper.searchLinkedInJobs("Java Developer", config.search.targetCountry);

    if (manualMode) {
      logger.info("Manual LinkedIn mode is active");
      await linkedInScraper.keepOpen();
      return;
    }

    const results = await linkedInScraper.applyEasyApplyJobs(
      config.candidate.name,
      config.candidate.email,
      config.candidate.phone,
      config.search.maxApplicationsPerRun,
    );

    logger.info("Browser automation summary", results);
  } catch (error) {
    logger.error("Browser automation failed", { error });
    process.exitCode = 1;
  } finally {
    await linkedInScraper.close().catch(() => undefined);
    await browserLifecycleManager.closeAll().catch(() => undefined);
  }
}

void main();
