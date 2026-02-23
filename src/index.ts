import JobApplicationOrchestrator from "./orchestrator/orchestrator";
import JobBoardManager from "./integrations/job-board-manager";
import LinkedInScraper from "./integrations/linkedin-scraper";
import logger from "./utils/logger";

/**
 * Main entry point - Job Search & Application Agent
 * Choose between: sample data, job board scraping, or real browser automation
 */
async function main() {
  const orchestrator = new JobApplicationOrchestrator();

  try {
    // Initialize orchestrator
    await orchestrator.initialize();

    const mode = process.env.APP_MODE || "browser"; // Options: "browser", "scrape", "sample"
    const useRealBrowser = process.argv.includes("--real");

    logger.info("==============================================");
    logger.info("AUTONOMOUS JOB APPLICATION AGENT");
    logger.info("==============================================");
    logger.info("");

    logger.info("Configuration:");
    logger.info(
      `  - Ollama Model: ${process.env.OLLAMA_MODEL || "gpt-oss:120b-cloud"}`
    );
    logger.info(
      `  - Max Jobs to Apply: ${process.env.MAX_JOBS_TO_APPLY || "5"}`
    );
    logger.info(
      `  - Auto Submit: ${
        process.env.ENABLE_AUTO_SUBMIT === "true"
          ? "ENABLED ✓"
          : "DISABLED (manual review required)"
      }`
    );
    logger.info(
      `  - Application Mode: ${mode === "browser" ? "Real Browser" : mode === "scrape" ? "Job Board Scraper" : "Sample Data"}`
    );
    logger.info("");

    logger.info("Candidate Profile:");
    logger.info(`  - Name: ${process.env.CANDIDATE_NAME}`);
    logger.info(`  - Email: ${process.env.CANDIDATE_EMAIL}`);
    logger.info(`  - Phone: ${process.env.CANDIDATE_PHONE}`);
    logger.info(`  - Skills: ${process.env.PRIMARY_SKILLS}`);
    logger.info(`  - Location: ${process.env.CURRENT_LOCATION}`);
    logger.info(`  - Years Experience: ${process.env.YEARS_EXPERIENCE}`);
    logger.info(
      `  - Willing to Relocate: ${process.env.WILLING_TO_RELOCATE === "true" ? "Yes ✓" : "No"}`
    );
    logger.info("");

    // Choose application mode
    if (useRealBrowser || mode === "browser") {
      // Use LinkedIn browser automation
      logger.info("Starting REAL BROWSER AUTOMATION MODE...");
      logger.info("Opening your browser to search and apply on LinkedIn...");
      logger.info("");

      const browser = new LinkedInScraper();
      await browser.initialize();

      const jobTitle = process.env.SEARCH_TERMS?.split("|")[0] || "Java Developer";
      const location = process.env.JOB_LOCATION || "Australia";

      await browser.searchLinkedInJobs(jobTitle, location);
      const results = await browser.applyEasyApplyJobs(
        process.env.CANDIDATE_NAME || "Candidate",
        process.env.CANDIDATE_EMAIL || "candidate@example.com",
        process.env.CANDIDATE_PHONE || "+61000000000",
        parseInt(process.env.MAX_JOBS_TO_APPLY || "3")
      );

      logger.info("");
      logger.info("========================================");
      logger.info("APPLICATION SESSION SUMMARY");
      logger.info("========================================");
      logger.info(`Total Applied: ${results.applied}`);
      logger.info(`Total Failed: ${results.failed}`);
      logger.info(`Manual Help Required: ${results.manualHelp}`);
      logger.info(
        `Success Rate: ${
          (results.applied / (results.applied + results.failed)) * 100 || 0
        }%`
      );

      await browser.close();
    } else if (mode === "scrape") {
      // Use job board scraper
      logger.info("Starting JOB BOARD SCRAPER MODE...");
      const jobBoardManager = new JobBoardManager(orchestrator);
      await jobBoardManager.initialize();

      await jobBoardManager.searchAndApply(
        "Java Developer",
        "Australia",
        "sample",
        5
      );

      await new Promise((resolve) => setTimeout(resolve, 1000));
    } else {
      // Use sample data (demo mode)
      logger.info("Starting SAMPLE DATA MODE (Demo)...");
      logger.info("Using demonstration data for testing...");
      logger.info("");

      const jobBoardManager = new JobBoardManager(orchestrator);
      await jobBoardManager.initialize();

      await jobBoardManager.searchAndApply(
        "Java Developer",
        "Australia",
        "sample",
        3
      );
    }

    logger.info("");
    logger.info("==============================================");
    logger.info("Application session completed!");
    logger.info("==============================================");
  } catch (error) {
    logger.error("Fatal error:", error);
    process.exit(1);
  } finally {
    await orchestrator.cleanup();
  }
}

main();
