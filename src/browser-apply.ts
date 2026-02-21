import LinkedInScraper from "./integrations/linkedin-scraper";
import logger from "./utils/logger";

/**
 * Real Browser Automation - Search and Apply to Jobs
 * Opens a visible browser window and autonomously applies to jobs
 */
async function main() {
  const browser = new LinkedInScraper();

  try {
    logger.info("==============================================");
    logger.info("REAL BROWSER JOB APPLICATION AUTOMATION");
    logger.info("==============================================");
    logger.info("");

    // Get configuration from environment
    const headless = process.env.BROWSER_HEADLESS === "true";
    const useManualMode = process.argv.includes("--manual");
    const jobTitle =
      process.env.SEARCH_TERMS?.split("|")[0] || "Java Developer";
    const location = process.env.JOB_LOCATION || "Australia";
    const maxJobs = parseInt(process.env.MAX_JOBS_TO_APPLY || "3");

    logger.info("Configuration:");
    logger.info(`  - Job Title: ${jobTitle}`);
    logger.info(`  - Location: ${location}`);
    logger.info(`  - Max Applications: ${maxJobs}`);
    logger.info(`  - Browser Mode: ${headless ? "Headless" : "Visible ✓"}`);
    logger.info(`  - Application Mode: ${useManualMode ? "Manual Control" : "Autonomous"}`);
    logger.info("");

    logger.info("Candidate Profile:");
    logger.info(`  - Name: ${process.env.CANDIDATE_NAME || "Not configured"}`);
    logger.info(`  - Email: ${process.env.CANDIDATE_EMAIL || "Not configured"}`);
    logger.info(`  - Phone: ${process.env.CANDIDATE_PHONE || "Not configured"}`);
    logger.info(`  - Skills: ${process.env.PRIMARY_SKILLS || "Not configured"}`);
    logger.info("");

    if (headless) {
      logger.warn(
        "Headless mode is not supported for LinkedIn interactive apply. Continuing in visible mode."
      );
    }

    // Initialize browser
    await browser.initialize();

    if (useManualMode) {
      // Manual mode - user controls browser
      logger.info("Starting in MANUAL MODE...");
      logger.info("You have full control of the browser.");
      logger.info("");
      logger.info("Use this mode to:");
      logger.info("  1. Search LinkedIn jobs");
      logger.info("  2. Review relevant job listings");
      logger.info("  3. Fill out applications");
      logger.info("  4. Handle verification questions");
      logger.info("");
      await browser.searchLinkedInJobs(jobTitle, location);
      await browser.keepOpen();
    } else {
      // Autonomous mode - auto search and apply
      logger.info("Starting AUTONOMOUS MODE...");
      logger.info("Searching LinkedIn jobs and applying...");
      logger.info("");
      logger.info("This will:");
      logger.info("  - Open LinkedIn Jobs in your Chrome profile");
      logger.info("  - Search relevant jobs");
      logger.info("  - Attempt Easy Apply forms");
      logger.info("  - Ask for manual help when needed, then continue");
      logger.info("");
      logger.info("For best results, use MANUAL MODE:");
      logger.info("  npm run browser:manual");
      logger.info("");

      await browser.searchLinkedInJobs(jobTitle, location);
      const results = await browser.applyEasyApplyJobs(
        process.env.CANDIDATE_NAME || "Candidate",
        process.env.CANDIDATE_EMAIL || "candidate@example.com",
        process.env.CANDIDATE_PHONE || "+61000000000",
        maxJobs
      );

      logger.info("");
      logger.info("========================================");
      logger.info("AUTOMATION SUMMARY");
      logger.info("========================================");
      logger.info(`Successfully Applied: ${results.applied}`);
      logger.info(`Failed Applications: ${results.failed}`);
      logger.info(`Manual Help Required: ${results.manualHelp}`);
      logger.info(`Total Processed: ${results.applied + results.failed}`);
      logger.info("");

      if (results.applied === 0 && results.failed === 0) {
        logger.info("⚠️  No applications processed.");
        logger.info("");
        logger.info("Alternatives:");
        logger.info("1. Use Manual Mode for full browser control");
        logger.info("   → npm run browser:manual");
        logger.info("");
        logger.info("2. Use Sample Data mode for testing");
        logger.info("   → npm start");
        logger.info("");
        logger.info("3. Confirm LinkedIn session in Chrome and rerun");
      } else if (results.manualHelp > 0) {
        logger.info("Some applications needed manual responses.");
        logger.info("The script paused for your input and then proceeded.");
      }
    }
  } catch (error) {
    logger.error("Fatal error:", error);
  } finally {
    // Keep browser open briefly for user to see results
    if (!process.argv.includes("--manual")) {
      logger.info("\nClosing browser in 5 seconds...");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    await browser.close();
  }
}

main();
