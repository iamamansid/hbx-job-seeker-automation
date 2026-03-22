import { config, type Config } from "../config/index";
import { jobListingToDescription } from "../integrations/job-scraper";
import { MemoryManager } from "../memory/memory-manager";
import {
  AgentState,
  type ApplicationRecord,
  type JobListing,
  type OrchestratorState,
} from "../types/index";
import { logger } from "../utils/logger";
import { ExecutorAgent } from "../agents/executor-agent";
import { PlannerAgent } from "../agents/planner-agent";

export class JobApplicationOrchestrator {
  private readonly state: OrchestratorState = {
    currentState: AgentState.IDLE,
    currentJob: null,
    currentPlan: null,
    currentApplicationId: null,
    startTime: Date.now(),
    stepCount: 0,
    historicalData: [],
  };

  constructor(
    private readonly planner: PlannerAgent,
    private readonly executor: ExecutorAgent,
    private readonly memory: MemoryManager,
    private readonly runtimeConfig: Config = config,
  ) {}

  async initialize(): Promise<void> {
    await this.memory.initialize();
    logger.info("Orchestrator initialized with PostgreSQL MemoryManager");
  }

  async processJob(job: JobListing): Promise<void> {
    const jobDescription = jobListingToDescription(job);
    this.state.currentJob = job;
    this.state.currentApplicationId = this.generateApplicationId();
    this.state.currentPlan = null;
    this.state.currentState = AgentState.ANALYZING;
    this.state.stepCount = 0;

    logger.info(`Processing ${job.title} at ${job.company}`, {
      portalSource: job.portalSource,
      url: job.url,
    });

    try {
      if (await this.memory.hasAppliedBefore(job.url)) {
        logger.info(`Skipping ${job.url} because it already has an application record`);
        return;
      }

      if (await this.memory.isJobRejected(job.url)) {
        logger.info(`Skipping ${job.url} because it was previously rejected`);
        return;
      }

      // Ensure job is in DB
      const jobId = await this.memory.storeJobListing(job);

      const relevancy = await this.withRetry("relevance analysis", () =>
        this.planner.analyzeRelevance(jobDescription),
      );

      await this.memory.logEvent(jobId, 'ANALYZED', `Relevancy Score: ${relevancy.relevanceScore}`, { relevancy });

      if (!relevancy.isRelevant || relevancy.relevanceScore < 30 || relevancy.visaSponsorshipScore < 6) {
        await this.memory.logEvent(jobId, 'REJECTED', `Rejected by planner: ${relevancy.reasoning}`);
        logger.info(`Rejected job ${job.url}`, {
          relevanceScore: relevancy.relevanceScore,
          visaSponsorshipScore: relevancy.visaSponsorshipScore,
        });
        return;
      }

      this.state.currentState = AgentState.PLANNING;
      this.state.stepCount += 1;
      const plan = await this.withRetry("application planning", () =>
        this.planner.planApplication(jobDescription),
      );
      this.state.currentPlan = plan;

      await this.memory.logEvent(jobId, 'PLANNED', `Planned application strategy`);

      if (!plan.shouldApply) {
        await this.memory.logEvent(jobId, 'REJECTED', "Planning stage recommended skipping");
        logger.info(`Skipped ${job.url} because the application plan marked it as not worth applying`);
        return;
      }

      this.state.currentState = AgentState.EXECUTING;
      this.state.stepCount += 1;
      const executionResult = await this.executor.executeApplication(job.url, jobDescription);

      if (!executionResult.success) {
        await this.memory.logEvent(jobId, 'FAILED', executionResult.message, { errors: executionResult.errors });
        return;
      }

      this.state.currentState = AgentState.VERIFYING;
      this.state.stepCount += 1;

      // Fix BUG 2: Hardcoded fill rate denominator
      const totalFields = executionResult.totalFields || Object.keys(executionResult.filledFields).length;
      const fillRate = totalFields === 0 ? 0 : Math.round((Object.keys(executionResult.filledFields).length / totalFields) * 100);
      const isComplete = fillRate >= 70;

      await this.memory.logEvent(jobId, 'APPLIED', executionResult.message, {
        fillRate,
        isComplete,
        formDataFilled: executionResult.filledFields,
      });

      this.state.currentState = AgentState.LEARNING;
      this.state.stepCount += 1;
      await this.learnFromApplication(job.company);

      logger.info(`Completed processing for ${job.title}`, {
        url: job.url,
        status: isComplete ? "applied" : "pending",
        fillRate,
      });
    } catch (error) {
      this.state.currentState = AgentState.ERROR;
      logger.error("Unexpected orchestrator failure while processing job", { error, url: job.url });
    }
  }

  async processJobs(jobs: JobListing[]): Promise<void> {
    const limit = Math.min(jobs.length, this.runtimeConfig.search.maxApplicationsPerRun);
    logger.info(`Processing ${limit} job(s) out of ${jobs.length} discovered`);

    const keywords = this.runtimeConfig.search.searchTerms?.join(", ") ?? "java developer";
    const location = this.runtimeConfig.search.targetCountry ?? "Australia";
    
    await this.memory.startRun(keywords, location);

    try {
      for (let index = 0; index < limit; index += 1) {
        await this.processJob(jobs[index]);

        if (index < limit - 1) {
          await this.delay(1_500);
        }
      }
      await this.memory.endRun("COMPLETED");
    } catch (e) {
      await this.memory.endRun("FAILED");
      throw e;
    }

    await this.printSummary();
  }

  getState(): OrchestratorState {
    return this.state;
  }

  async cleanup(): Promise<void> {
    await this.memory.close();
  }

  private async learnFromApplication(companyName: string): Promise<void> {
    const stats = await this.memory.getStatistics();
    logger.info(`Learning checkpoint for ${companyName}`, {
      totalApplications: stats.totalApplications,
      appliedCount: stats.appliedCount,
      failedCount: stats.failedCount,
      successRate: stats.successRate,
    });
  }

  private async printSummary(): Promise<void> {
    const stats = await this.memory.getStatistics();
    logger.info("Orchestrator summary", {
      totalApplications: stats.totalApplications,
      appliedCount: stats.appliedCount,
      failedCount: stats.failedCount,
      uniqueCompanies: stats.uniqueCompanies,
      successRate: stats.successRate,
      sessionDurationSeconds: Math.round((Date.now() - this.state.startTime) / 1000),
    });
  }

  private async withRetry<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= this.runtimeConfig.agent.maxRetries; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        logger.warn(`${operationName} attempt ${attempt} failed`, { error });
        if (attempt === this.runtimeConfig.agent.maxRetries) {
          throw error;
        }

        await this.delay(1000 * attempt);
      }
    }

    throw new Error(`${operationName} failed unexpectedly`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private generateApplicationId(): string {
    return `app_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
