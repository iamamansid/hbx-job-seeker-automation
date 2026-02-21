/**
 * EXAMPLE: Integration with Job Application Orchestrator
 * 
 * This file demonstrates various ways to use the Job Application Agent
 */

import JobApplicationOrchestrator from "./orchestrator/orchestrator";
import { JobDescription } from "./types/index";
import logger from "./utils/logger";

/**
 * Example 1: Process a single job from URL and job description
 */
async function example_singleJob() {
  console.log("\n=== Example 1: Single Job Application ===\n");

  const orchestrator = new JobApplicationOrchestrator();
  await orchestrator.initialize();

  const jobDescription: JobDescription = {
    jobTitle: "Senior Backend Engineer",
    companyName: "TechStartup Inc",
    location: "San Francisco, CA",
    workType: "Hybrid",
    requirements: [
      "5+ years JavaScript/TypeScript",
      "Node.js and Express experience",
      "Database design and optimization",
      "Microservices architecture",
      "Docker and Kubernetes",
    ],
    responsibilities: [
      "Design and implement scalable backend systems",
      "Lead architectural discussions with team",
      "Mentor junior developers",
      "Optimize database queries and API performance",
    ],
    benefits: [
      "Competitive salary ($150k-$200k)",
      "Stock options",
      "Health insurance",
      "Remote flexibility",
      "Professional development budget",
    ],
    fullDescription: `We are looking for an experienced Senior Backend Engineer to join our growing team. 
      You'll be working on our cloud infrastructure, building APIs, and designing systems that serve millions of users.
      Must have strong experience with Node.js and modern JavaScript. Kubernetes experience is a plus.`,
    salaryRange: "$150,000 - $200,000",
  };

  try {
    // Process the job
    await orchestrator.processJob("https://example.com/job/senior-backend-engineer", jobDescription);
    console.log("✓ Job processing completed");
  } finally {
    await orchestrator.cleanup();
  }
}

/**
 * Example 2: Batch process multiple jobs
 */
async function example_batchJobs() {
  console.log("\n=== Example 2: Batch Job Processing ===\n");

  const orchestrator = new JobApplicationOrchestrator();
  await orchestrator.initialize();

  const jobs = [
    {
      url: "https://example.com/job/backend-engineer-1",
      description: {
        jobTitle: "Backend Engineer",
        companyName: "Company A",
        location: "New York, NY",
        workType: "Remote",
        requirements: ["Java", "Spring Boot"],
      } as JobDescription,
    },
    {
      url: "https://example.com/job/backend-engineer-2",
      description: {
        jobTitle: "Senior Backend Engineer",
        companyName: "Company B",
        location: "San Francisco, CA",
        workType: "Hybrid",
        requirements: ["Java", "Kubernetes", "Microservices"],
      } as JobDescription,
    },
    {
      url: "https://example.com/job/fullstack-developer",
      description: {
        jobTitle: "Full Stack Developer",
        companyName: "Company C",
        location: "Remote",
        workType: "Remote",
        requirements: ["Node.js", "React", "MongoDB"],
      } as JobDescription,
    },
  ];

  try {
    // Process multiple jobs
    await orchestrator.processJobs(jobs);
    console.log("✓ Batch processing completed");
  } finally {
    await orchestrator.cleanup();
  }
}

/**
 * Example 3: Integration with LinkedIn API (placeholder)
 */
async function example_linkedinIntegration() {
  console.log("\n=== Example 3: LinkedIn Integration (Placeholder) ===\n");

  // This is where you would integrate LinkedIn API
  // In production, you might:
  // 1. Auth to LinkedIn
  // 2. Search for jobs
  // 3. Parse job descriptions
  // 4. Extract job posting URLs

  const linkedinJobs: Array<{ url: string; description: JobDescription }> = [
    // Would be populated from LinkedIn API
  ];

  if (linkedinJobs.length > 0) {
    const orchestrator = new JobApplicationOrchestrator();
    await orchestrator.initialize();

    try {
      await orchestrator.processJobs(linkedinJobs);
    } finally {
      await orchestrator.cleanup();
    }
  } else {
    console.log(
      "LinkedIn integration requires API credentials. See documentation for setup.",
    );
  }
}

/**
 * Example 4: Integration with Indeed scraper (placeholder)
 */
async function example_indeedIntegration() {
  console.log("\n=== Example 4: Indeed Integration (Placeholder) ===\n");

  // In production, you might use a library like cheerio to scrape Indeed
  // Or use Indeed's API if available

  const indeedJobs: Array<{ url: string; description: JobDescription }> = [];

  // Example of how you might parse Indeed pages:
  // 1. Use Playwright to navigate Indeed search
  // 2. Extract job titles and links
  // 3. Click each link and scrape description
  // 4. Process through orchestrator

  console.log("Indeed integration could be added using web scraping...");
}

/**
 * Example 5: Continuous job monitoring (runs in a loop)
 */
async function example_continuousMonitoring() {
  console.log("\n=== Example 5: Continuous Job Monitoring ===\n");

  const orchestrator = new JobApplicationOrchestrator();
  await orchestrator.initialize();

  const searchTerms = [
    "JavaScript Backend Engineer",
    "Node.js Developer",
    "Full Stack Engineer",
  ];

  // In production, this would:
  // 1. Search for jobs matching terms
  // 2. Extract new job postings
  // 3. Process each one
  // 4. Wait before next run
  // 5. Repeat on schedule

  console.log(`Would monitor ${searchTerms.length} search terms...`);
  console.log("In production, this would run continuously and check for new jobs");

  await orchestrator.cleanup();
}

/**
 * Example 6: Check statistics and history
 */
async function example_statistics() {
  console.log("\n=== Example 6: Application Statistics ===\n");

  const orchestrator = new JobApplicationOrchestrator();
  await orchestrator.initialize();

  // Get historical data
  const state = orchestrator.getState();
  console.log(`Historical applications: ${state.historicalData.length}`);

  // Get from memory/database through orchestrator's memory manager
  // In production, you'd expose memory methods

  console.log("Statistics tracking is built into the memory system");
  console.log("Check data/applications.db for detailed application history");

  await orchestrator.cleanup();
}

/**
 * Example 7: Configuration and customization
 */
function example_configuration() {
  console.log("\n=== Example 7: Configuration ===\n");

  console.log("All settings via .env file:");
  console.log("  - OLLAMA_MODEL: Which LLM to use");
  console.log("  - ENABLE_AUTO_SUBMIT: Auto-submit forms (default: false for safety)");
  console.log("  - MAX_JOBS_TO_APPLY: Max applications per session");
  console.log("  - BROWSER_HEADLESS: Show/hide browser window");
  console.log("  - LOG_LEVEL: Logging verbosity");
  console.log("  - CANDIDATE_* : Your profile information");

  console.log(
    "\nDo NOT change code for configuration - use .env file instead",
  );
}

/**
 * Main function with menu
 */
async function main() {
  console.log("\n" + "=".repeat(60));
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
  console.log("  - Run specific orchestrator method you need");
  console.log("  - Customize job sources and search terms");

  console.log("\nFor more info, see README.md");
  console.log("=".repeat(60) + "\n");
}

// Export examples for use in other files
export {
  example_singleJob,
  example_batchJobs,
  example_linkedinIntegration,
  example_indeedIntegration,
  example_continuousMonitoring,
  example_statistics,
  example_configuration,
};

// Run if executed directly
if (require.main === module) {
  main();
}
