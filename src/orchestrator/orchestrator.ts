import PlannerAgent from "../agents/planner-agent";
import ExecutorAgent from "../agents/executor-agent";
import MemoryManager from "../memory/memory-manager";
import logger from "../utils/logger";
import { AgentState, JobDescription, OrchestratorState } from "../types/index";
import { config } from "../config/index";

/**
 * Main Orchestrator:
 * Controls the overall workflow loop: SEARCH → ANALYZE → PLAN → ACT → VERIFY → LEARN
 */
export class JobApplicationOrchestrator {
  private planner: PlannerAgent;
  private executor: ExecutorAgent;
  private memory: MemoryManager;
  private state: OrchestratorState;

  constructor() {
    this.planner = new PlannerAgent();
    this.executor = new ExecutorAgent();
    this.memory = new MemoryManager();
    this.state = {
      currentState: AgentState.IDLE,
      currentJob: null,
      currentPlan: null,
      currentApplicationId: null,
      startTime: Date.now(),
      stepCount: 0,
      historicalData: [],
    };
  }

  /**
   * Initialize orchestrator
   */
  async initialize(): Promise<void> {
    try {
      logger.info("Initializing Job Application Orchestrator...");

      // Initialize memory
      await this.memory.initialize();

      // Check Ollama availability
      logger.info("Checking Ollama availability...");
      // Will be checked on first use

      // Load historical data
      this.state.historicalData = await this.memory.getApplicationHistory(100);
      logger.info(`Loaded ${this.state.historicalData.length} historical applications`);

      logger.info("Orchestrator initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize orchestrator:", error);
      throw error;
    }
  }

  /**
   * Process a single job
   * This is the main workflow: ANALYZE → PLAN → ACT → VERIFY → LEARN
   */
  async processJob(jobUrl: string, jobDescription: JobDescription): Promise<void> {
    try {
      this.state.currentJob = jobDescription;
      this.state.currentApplicationId = this.generateApplicationId();
      this.state.stepCount = 0;

      logger.info(`\n${"=".repeat(60)}`);
      logger.info(`Processing Job: ${jobDescription.jobTitle} @ ${jobDescription.companyName}`);
      logger.info(`URL: ${jobUrl}`);
      logger.info(`${"=".repeat(60)}\n`);

      // STEP 1: ANALYZE - Check if already applied
      this.state.currentState = AgentState.ANALYZING;
      const alreadyApplied = await this.memory.hasAppliedBefore(jobUrl);
      if (alreadyApplied) {
        logger.info("Already applied to this job. Skipping.");
        return;
      }

      const isRejected = await this.memory.isJobRejected(jobUrl);
      if (isRejected) {
        logger.info("Job was previously rejected. Skipping.");
        return;
      }

      // STEP 2: ANALYZE - Analyze relevance
      this.state.stepCount++;
      const relevancy = await this.planner.analyzeRelevance(jobDescription);

      if (!relevancy.isRelevant || relevancy.relevanceScore < 30) {
        logger.warn(`Job not relevant (score: ${relevancy.relevanceScore}%). Rejecting.`);
        logger.info(`Reason: ${relevancy.reasoning}`);

        await this.memory.recordRejectedJob(
          jobUrl,
          jobDescription.companyName || "Unknown",
          relevancy.reasoning,
        );

        return;
      }

      logger.info(`✓ Job is relevant (score: ${relevancy.relevanceScore}%)`);
      logger.info(`  Matched criteria: ${relevancy.criteriaMatched.join(", ")}`);

      // STEP 3: PLAN - Create application strategy
      this.state.currentState = AgentState.PLANNING;
      this.state.stepCount++;
      const plan = await this.planner.planApplication(jobDescription);

      if (!plan.shouldApply) {
        logger.info("Plan decided not to apply. Rejecting.");
        await this.memory.recordRejectedJob(
          jobUrl,
          jobDescription.companyName || "Unknown",
          "Planning phase decided not to apply",
        );
        return;
      }

      logger.info(`✓ Application plan created`);
      logger.info(`  - Estimated fill time: ${plan.estimatedFillTime}s`);
      logger.info(`  - Key practices to highlight: ${plan.keyPracticesToHighlight.join(", ")}`);

      // STEP 4: ACT - Execute the application
      this.state.currentState = AgentState.EXECUTING;
      this.state.stepCount++;
      const executionResult = await this.executor.executeApplication(jobUrl, jobDescription);

      if (!executionResult.success) {
        logger.error(`✗ Application execution failed`);
        logger.error(`  Errors: ${executionResult.errors.join("; ")}`);

        // Record failed attempt
        await this.memory.recordApplication({
          companyName: jobDescription.companyName || "Unknown",
          jobTitle: jobDescription.jobTitle || "Unknown",
          jobUrl,
          status: "failed",
          relevanceScore: relevancy.relevanceScore,
          notes: `Execution failed: ${executionResult.errors[0]}`,
          formDataFilled: executionResult.filledFields,
          errorLog: executionResult.errors.join("\n"),
        });

        return;
      }

      // STEP 5: VERIFY - Check form completion
      this.state.currentState = AgentState.VERIFYING;
      this.state.stepCount++;

      const fillRate = Math.round((Object.keys(executionResult.filledFields).length / 10) * 100); // Estimate based on fields filled
      const isComplete = fillRate >= 70;

      logger.info(`✓ Form processing completed`);
      logger.info(`  - Fields filled: ${Object.keys(executionResult.filledFields).length}`);
      logger.info(`  - Completion rate: ${fillRate}%`);

      if (!isComplete) {
        logger.warn("Form completion below 70% threshold");
      }

      // Record successful application attempt
      const applicationRecord = await this.memory.recordApplication({
        companyName: jobDescription.companyName || "Unknown",
        jobTitle: jobDescription.jobTitle || "Unknown",
        jobUrl,
        status: isComplete ? "applied" : "pending",
        relevanceScore: relevancy.relevanceScore,
        fillRating: fillRate,
        notes: executionResult.message,
        formDataFilled: executionResult.filledFields,
      });

      // STEP 6: LEARN - Extract insights for future applications
      this.state.currentState = AgentState.LEARNING;
      this.state.stepCount++;
      await this.learnFromApplication(applicationRecord);

      logger.info(`\n${"=".repeat(60)}`);
      logger.info(`✓ Job application process completed`);
      logger.info(`  - Application ID: ${applicationRecord.id}`);
      logger.info(`  - Status: ${applicationRecord.status}`);
      logger.info(`  - Relevance Score: ${applicationRecord.relevanceScore}%`);
      logger.info(`${"=".repeat(60)}\n`);
    } catch (error) {
      logger.error("Error processing job:", error);
      this.state.currentState = AgentState.ERROR;
    }
  }

  /**
   * Learn from completed applications
   */
  private async learnFromApplication(applicationRecord: any): Promise<void> {
    try {
      logger.info("Analyzing application for learning...");

      // Update memory with statistics
      const stats = await this.memory.getStatistics();

      logger.info("Updated statistics:");
      logger.info(`  - Total applications: ${stats.totalApplications}`);
      logger.info(`  - Successful: ${stats.appliedCount}`);
      logger.info(`  - Failed: ${stats.failedCount}`);
      logger.info(`  - Success rate: ${stats.successRate.toFixed(2)}%`);

      // Could implement ML-based learning here in future
      // For now, just track patterns
    } catch (error) {
      logger.error("Error learning from application:", error);
    }
  }

  /**
   * Process multiple jobs
   */
  async processJobs(jobs: Array<{ url: string; description: JobDescription }>): Promise<void> {
    try {
      logger.info(`Starting batch processing of ${jobs.length} jobs`);

      for (let i = 0; i < jobs.length && i < config.search.maxJobsToApply; i++) {
        logger.info(`\nProcessing job ${i + 1}/${Math.min(jobs.length, config.search.maxJobsToApply)}`);

        await this.processJob(jobs[i].url, jobs[i].description);

        // Small delay between applications
        if (i < jobs.length - 1) {
          logger.info("Waiting before next job...");
          await this.delay(2000); // 2 second delay
        }
      }

      // Print final summary
      await this.printSummary();
    } catch (error) {
      logger.error("Error processing jobs:", error);
    }
  }

  /**
   * Search for jobs (simulated - would integrate with real job boards)
   */
  async searchJobs(query: string): Promise<Array<{ url: string; description: JobDescription }>> {
    try {
      logger.info(`Searching for jobs: "${query}"`);

      // This is a stub - in production, this would:
      // 1. Use job board APIs or web scraping
      // 2. Parse job listings
      // 3. Extract job descriptions

      const jobs: Array<{ url: string; description: JobDescription }> = [];

      // For testing, we'll need manual job URLs or integration with job boards
      logger.info("Job search completed (stub implementation)");

      return jobs;
    } catch (error) {
      logger.error("Error searching jobs:", error);
      return [];
    }
  }

  /**
   * Print application summary
   */
  private async printSummary(): Promise<void> {
    try {
      const stats = await this.memory.getStatistics();

      console.log("\n" + "=".repeat(60));
      console.log("ORCHESTRATOR SUMMARY");
      console.log("=".repeat(60));
      console.log(
        `Total Applications: ${stats.totalApplications} | Applied: ${stats.appliedCount} | Failed: ${stats.failedCount}`,
      );
      console.log(`Unique Companies: ${stats.uniqueCompanies}`);
      console.log(`Success Rate: ${stats.successRate.toFixed(2)}%`);
      console.log(`Session Duration: ${Math.round((Date.now() - this.state.startTime) / 1000)}s`);
      console.log("=".repeat(60) + "\n");
    } catch (error) {
      logger.error("Error printing summary:", error);
    }
  }

  /**
   * Get current state
   */
  getState(): OrchestratorState {
    return this.state;
  }

  /**
   * Cleanup
   */
  async cleanup(): Promise<void> {
    try {
      await this.memory.close();
      logger.info("Orchestrator cleanup completed");
    } catch (error) {
      logger.error("Error during cleanup:", error);
    }
  }

  // Utility
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private generateApplicationId(): string {
    return `app_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export default JobApplicationOrchestrator;
