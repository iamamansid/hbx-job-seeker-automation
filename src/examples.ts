/**
 * EXAMPLE: Integration with Job Application Orchestrator
 *
 * This file demonstrates various ways to use the current agent graph.
 */

import { ExecutorAgent } from "./agents/executor-agent";
import { PlannerAgent } from "./agents/planner-agent";
import { ProfileReasoner } from "./agents/profile-reasoner";
import { BrowserAgent } from "./browser/browser-agent";
import { BrowserLifecycleManager } from "./browser/browser-lifecycle-manager";
import { config } from "./config/index";
import { GeminiClient } from "./llm/gemini-client";
import { MemoryManager } from "./memory/memory-manager";
import { JobApplicationOrchestrator } from "./orchestrator/orchestrator";
import { JobListingSchema, type JobListing } from "./types/index";

type ExampleRuntime = {
  orchestrator: JobApplicationOrchestrator;
  browserLifecycleManager: BrowserLifecycleManager;
};

const createExampleRuntime = (): ExampleRuntime => {
  const browserLifecycleManager = BrowserLifecycleManager.getInstance(config);
  const llmClient = new GeminiClient(config);
  const memoryManager = new MemoryManager(config);
  const browserAgent = new BrowserAgent(browserLifecycleManager, config);
  const profileReasoner = new ProfileReasoner(llmClient, config);
  const plannerAgent = new PlannerAgent(llmClient, config);
  const executorAgent = new ExecutorAgent(browserAgent, profileReasoner, llmClient, config);
  const orchestrator = new JobApplicationOrchestrator(
    plannerAgent,
    executorAgent,
    memoryManager,
    config,
  );

  return { orchestrator, browserLifecycleManager };
};

const cleanupRuntime = async ({
  orchestrator,
  browserLifecycleManager,
}: ExampleRuntime): Promise<void> => {
  await orchestrator.cleanup().catch(() => undefined);
  await browserLifecycleManager.closeAll().catch(() => undefined);
};

const createSampleJob = (overrides: Partial<JobListing> = {}): JobListing =>
  JobListingSchema.parse({
    title: "Senior Backend Engineer",
    company: "TechStartup Inc",
    location: "Sydney, NSW",
    url: "https://example.com/job/senior-backend-engineer",
    description: `We are looking for an experienced Senior Backend Engineer to join our growing team.
You will build Java and Spring Boot services, improve API performance, and work across cloud-native systems.
Visa sponsorship is available for strong candidates with backend and microservices experience.`,
    salary: "AUD 150,000 - 180,000",
    portalSource: "LinkedIn",
    visaSponsorshipMentioned: true,
    scrapedAt: new Date(),
    ...overrides,
  });

/**
 * Example 1: Process a single job listing
 */
async function example_singleJob() {
  console.log("\n=== Example 1: Single Job Application ===\n");

  const runtime = createExampleRuntime();
  const { orchestrator } = runtime;

  try {
    await orchestrator.initialize();
    await orchestrator.processJob(
      createSampleJob({
        title: "Senior Backend Engineer",
        company: "TechStartup Inc",
      }),
    );
    console.log("Completed single job processing");
  } finally {
    await cleanupRuntime(runtime);
  }
}

/**
 * Example 2: Batch process multiple jobs
 */
async function example_batchJobs() {
  console.log("\n=== Example 2: Batch Job Processing ===\n");

  const runtime = createExampleRuntime();
  const { orchestrator } = runtime;

  const jobs: JobListing[] = [
    createSampleJob({
      title: "Backend Engineer",
      company: "Company A",
      location: "Melbourne, VIC",
      url: "https://example.com/job/backend-engineer-1",
      description: "Java, Spring Boot, REST APIs, and visa sponsorship available in Melbourne.",
      portalSource: "Seek",
    }),
    createSampleJob({
      title: "Senior Backend Engineer",
      company: "Company B",
      location: "Brisbane, QLD",
      url: "https://example.com/job/backend-engineer-2",
      description: "Microservices, Kubernetes, and sponsorship support for relocation to Brisbane.",
      portalSource: "Indeed",
    }),
    createSampleJob({
      title: "Full Stack Developer",
      company: "Company C",
      location: "Remote",
      url: "https://example.com/job/fullstack-developer",
      description: "Node.js, React, MongoDB, and occasional backend work. Sponsorship not mentioned.",
      portalSource: "ETaxJobs",
      visaSponsorshipMentioned: false,
    }),
  ];

  try {
    await orchestrator.initialize();
    await orchestrator.processJobs(jobs);
    console.log("Completed batch processing");
  } finally {
    await cleanupRuntime(runtime);
  }
}

/**
 * Example 3: Integration with LinkedIn scraping results
 */
async function example_linkedinIntegration() {
  console.log("\n=== Example 3: LinkedIn Integration (Placeholder) ===\n");

  const linkedinJobs: JobListing[] = [
    // Populate this array with scraped LinkedIn job listings.
  ];

  if (linkedinJobs.length === 0) {
    console.log("LinkedIn integration requires collected JobListing objects before processing.");
    return;
  }

  const runtime = createExampleRuntime();
  const { orchestrator } = runtime;

  try {
    await orchestrator.initialize();
    await orchestrator.processJobs(linkedinJobs);
  } finally {
    await cleanupRuntime(runtime);
  }
}

/**
 * Example 4: Integration with Indeed scraper (placeholder)
 */
async function example_indeedIntegration() {
  console.log("\n=== Example 4: Indeed Integration (Placeholder) ===\n");

  console.log("Indeed integration would typically:");
  console.log("  1. Search job results with Playwright");
  console.log("  2. Map scraped fields into JobListing objects");
  console.log("  3. Pass the resulting listings to orchestrator.processJobs()");
}

/**
 * Example 5: Continuous job monitoring (runs in a loop)
 */
async function example_continuousMonitoring() {
  console.log("\n=== Example 5: Continuous Job Monitoring ===\n");

  const runtime = createExampleRuntime();
  const { orchestrator } = runtime;

  const searchTerms = [
    "Java Backend Engineer visa sponsorship",
    "Spring Boot Developer Australia",
    "Backend Engineer 482 visa",
  ];

  try {
    await orchestrator.initialize();
    console.log(`Would monitor ${searchTerms.length} search terms...`);
    console.log("In production, this would run continuously and process new listings on a schedule.");
  } finally {
    await cleanupRuntime(runtime);
  }
}

/**
 * Example 6: Check statistics and history
 */
async function example_statistics() {
  console.log("\n=== Example 6: Application Statistics ===\n");

  const runtime = createExampleRuntime();
  const { orchestrator } = runtime;

  try {
    await orchestrator.initialize();
    const state = orchestrator.getState();
    console.log(`Historical applications tracked in memory: ${state.historicalData.length}`);
    console.log("Persistent statistics are stored through the PostgreSQL-backed memory manager.");
  } finally {
    await cleanupRuntime(runtime);
  }
}

/**
 * Example 7: Configuration and customization
 */
function example_configuration() {
  console.log("\n=== Example 7: Configuration ===\n");

  console.log("Primary settings via .env file:");
  console.log("  - GEMINI_API_KEY: Gemini API credentials");
  console.log("  - GEMINI_TIMEOUT_MS: LLM request timeout");
  console.log("  - GEMINI_TEMPERATURE: LLM sampling temperature");
  console.log("  - SEARCH_TERMS: Comma-separated search terms");
  console.log("  - MAX_APPLICATIONS_PER_RUN: Per-session application cap");
  console.log("  - BROWSER_HEADLESS: Show or hide the browser");
  console.log("  - DATABASE_URL: PostgreSQL connection string");
  console.log("  - CANDIDATE_*: Candidate profile information");

  console.log("\nPrefer environment configuration over hard-coded application changes.");
}

/**
 * Main function with menu
 */
async function main() {
  console.log(`\n${"=".repeat(60)}`);
  console.log("AUTONOMOUS JOB APPLICATION AGENT - EXAMPLES");
  console.log("=".repeat(60));
  console.log("\nAvailable examples:");
  console.log("1. Single job application");
  console.log("2. Batch process multiple jobs");
  console.log("3. LinkedIn integration (placeholder)");
  console.log("4. Indeed integration (placeholder)");
  console.log("5. Continuous job monitoring");
  console.log("6. View statistics and history");
  console.log("7. Configuration guide");

  console.log("\nTo use:");
  console.log("  - Copy example code into your main application");
  console.log("  - Build JobListing objects from your scraper");
  console.log("  - Create the orchestrator with current agent dependencies");

  console.log("\nFor more info, see README.md");
  console.log(`${"=".repeat(60)}\n`);
}

export {
  example_singleJob,
  example_batchJobs,
  example_linkedinIntegration,
  example_indeedIntegration,
  example_continuousMonitoring,
  example_statistics,
  example_configuration,
};

if (require.main === module) {
  void main();
}
