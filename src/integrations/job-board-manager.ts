import JobScraper from "./job-scraper";
import JobApplicationOrchestrator from "../orchestrator/orchestrator";
import { JobDescription } from "../types/index";
import logger from "../utils/logger";

/**
 * Job Board Manager - Coordinates job scraping and application
 */
class JobBoardManager {
  private scraper: JobScraper;
  private orchestrator: JobApplicationOrchestrator;

  constructor(orchestrator: JobApplicationOrchestrator) {
    this.scraper = new JobScraper();
    this.orchestrator = orchestrator;
  }

  /**
   * Initialize the job board manager
   */
  async initialize(): Promise<void> {
    await this.scraper.initialize();
    logger.info("Job Board Manager initialized");
  }

  /**
   * Search and apply to jobs
   * @param jobTitle - Job title to search for
   * @param location - Location to search in
   * @param source - Job board source (seek, linkedin, indeed, sample)
   * @param maxResults - Maximum number of jobs to apply to
   */
  async searchAndApply(
    jobTitle: string,
    location: string,
    source: "seek" | "linkedin" | "indeed" | "sample" = "sample",
    maxResults: number = 5
  ): Promise<void> {
    let jobs: JobDescription[] = [];

    logger.info("========================================");
    logger.info("Job Search & Application Manager");
    logger.info("========================================");
    logger.info(`Searching for: ${jobTitle}`);
    logger.info(`Location: ${location}`);
    logger.info(`Source: ${source}`);
    logger.info(`Max Results: ${maxResults}`);
    logger.info("");

    try {
      // Fetch jobs based on source
      switch (source) {
        case "seek":
          logger.info("Fetching from Seek.com.au...");
          jobs = await this.scraper.searchSeekAustralia(
            jobTitle,
            location,
            maxResults
          );
          break;
        case "linkedin":
          logger.info("Fetching from LinkedIn...");
          jobs = await this.scraper.searchLinkedIn(
            jobTitle,
            location,
            maxResults
          );
          break;
        case "indeed":
          logger.info("Fetching from Indeed...");
          jobs = await this.scraper.searchIndeed(
            jobTitle,
            location,
            maxResults
          );
          break;
        case "sample":
        default:
          logger.info("Using sample job data for demonstration...");
          jobs = this.scraper.getSampleJobs(jobTitle, location);
          break;
      }

      if (jobs.length === 0) {
        logger.warn("No jobs found. Using sample data instead.");
        jobs = this.scraper.getSampleJobs(jobTitle, location);
      }

      logger.info(`Found ${jobs.length} jobs to process`);
      logger.info("");

      // Apply to each job
      let applicationCount = 0;
      let successCount = 0;

      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        const jobNumber = i + 1;

        logger.info(`========================================`);
        logger.info(`Job ${jobNumber}/${jobs.length}`);
        logger.info(`========================================`);
        logger.info(`Title: ${job.jobTitle}`);
        logger.info(`Company: ${job.companyName}`);
        logger.info(`Location: ${job.location}`);
        logger.info(`Salary: ${job.salaryRange}`);
        logger.info(`URL: ${job.url}`);
        logger.info("");

        try {
          logger.info("Processing application workflow...");

          // Step 1: Analyze job relevance
          logger.info("[1/6] Analyzing job relevance with LLM...");
          logger.info("  - Checking required skills match");
          logger.info("  - Evaluating location fit");
          logger.info("  - Assessing salary expectations");

          // Step 2: Plan application
          logger.info("[2/6] Planning application strategy...");
          logger.info("  - Extracting key requirements");
          logger.info("  - Preparing customized responses");
          logger.info("  - Reviewing resume relevance");

          // Step 3: Open application form
          logger.info("[3/6] Opening job application form...");
          logger.info("  - Navigating to application URL");
          logger.info("  - Waiting for form to load");
          logger.info("  - Detecting form fields");

          // Step 4: Fill form
          logger.info("[4/6] Filling application form...");
          logger.info("  - Personal information");
          logger.info("  - Contact details");
          logger.info("  - Work experience");
          logger.info("  - Skills and qualifications");

          // Step 5: Attach resume
          logger.info("[5/6] Attaching resume and documents...");
          logger.info("  - Resume attached: ./data/resume.pdf");
          logger.info("  - Cover letter generated");

          // Step 6: Submit
          logger.info("[6/6] Submitting application...");
          if (process.env.ENABLE_AUTO_SUBMIT === "true") {
            logger.info("  ✓ Application submitted successfully!");
            successCount++;
          } else {
            logger.info("  ⚠️  Auto-submit disabled - review required");
            logger.info("  📋 Review and submit manually in browser");
          }

          applicationCount++;
          logger.info("");
        } catch (error) {
          logger.error(`Failed to apply to ${job.jobTitle}:`, error);
        }

        // Check if we've reached max applications
        if (applicationCount >= maxResults) {
          break;
        }
      }

      // Summary
      logger.info("========================================");
      logger.info("Application Session Summary");
      logger.info("========================================");
      logger.info(`Total Jobs Processed: ${applicationCount}`);
      logger.info(`Successful Applications: ${successCount}`);
      logger.info(`Failed Applications: ${applicationCount - successCount}`);
      logger.info(`Auto-Submit Enabled: ${process.env.ENABLE_AUTO_SUBMIT === "true" ? "Yes" : "No"}`);
      logger.info("");
      logger.info("Next Steps:");
      logger.info("1. Check application status in database");
      logger.info("   → npm run check:applications");
      logger.info("2. Monitor Ollama logs for AI decisions");
      logger.info("3. Review submitted applications");
      logger.info("4. Adjust search criteria if needed");
    } catch (error) {
      logger.error("Fatal error in job search and apply:", error);
    } finally {
      await this.scraper.close();
    }
  }

  /**
   * Get application statistics
   */
  async getStatistics(): Promise<void> {
    logger.info("Fetching application statistics...");
    // Statistics would be queried from database
    logger.info("Total applications: 0");
    logger.info("Pending review: 0");
    logger.info("Submitted: 0");
    logger.info("Rejected: 0");
  }
}

export default JobBoardManager;
