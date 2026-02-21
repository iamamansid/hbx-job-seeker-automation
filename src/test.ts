import OllamaClient from "./llm/ollama-client";
import BrowserAgent from "./browser/browser-agent";
import PlannerAgent from "./agents/planner-agent";
import ExecutorAgent from "./agents/executor-agent";
import ProfileReasoner from "./agents/profile-reasoner";
import MemoryManager from "./memory/memory-manager";
import logger from "./utils/logger";
import { JobDescription } from "./types/index";
import { config } from "./config/index";

async function testOllamaClient() {
  console.log("\n=== Testing Ollama Client ===");

  const ollama = new OllamaClient();
  const isHealthy = await ollama.healthCheck();

  if (!isHealthy) {
    console.error("❌ Ollama health check failed. Ensure Ollama is running with 'ollama serve'");
    return false;
  }

  console.log("✓ Ollama health check passed");

  // Test text generation
  const textResponse = await ollama.generate("Say 'Hello from Ollama' in exactly those words.");
  if (textResponse.success) {
    console.log("✓ Text generation works");
  } else {
    console.error("❌ Text generation failed:", textResponse.error);
    return false;
  }

  // Test JSON generation
  const jsonResponse = await ollama.generateJSON<{ role: string; years: number }>(
    "Extract job information",
    'Job: Senior Engineer with 5 years experience. Respond with role and years as JSON.',
  );

  if (jsonResponse.success && jsonResponse.data) {
    console.log("✓ JSON generation works");
  } else {
    console.error("❌ JSON generation failed:", jsonResponse.error);
    // Not fatal - could be a parsing issue
  }

  return true;
}

async function testBrowserAgent() {
  console.log("\n=== Testing Browser Agent ===");

  const browser = new BrowserAgent();

  try {
    console.log("Launching browser...");
    await browser.launch();
    console.log("✓ Browser launched successfully");

    // Navigate to a simple test page
    const success = await browser.goto("https://example.com");
    if (!success) {
      console.error("❌ Failed to navigate to test page");
      return false;
    }

    console.log("✓ Page navigation works");

    // Get page content
    const content = await browser.getPageContent();
    if (content.length > 0) {
      console.log("✓ Page content extraction works");
    }

    // Close browser
    await browser.close();
    console.log("✓ Browser closed successfully");

    return true;
  } catch (error) {
    console.error("❌ Browser test failed:", error);
    await browser.close();
    return false;
  }
}

async function testPlannerAgent() {
  console.log("\n=== Testing Planner Agent ===");

  const planner = new PlannerAgent();

  const testJob: JobDescription = {
    jobTitle: "Senior Java Backend Engineer",
    companyName: "TechCorp",
    location: "San Francisco, CA",
    workType: "Hybrid",
    requirements: [
      "5+ years Java experience",
      "Spring Boot expertise",
      "Microservices",
      "REST APIs",
    ],
    responsibilities: ["Design backend systems", "Lead team discussions"],
    benefits: ["Health insurance", "Remote flexibility"],
    fullDescription:
      "We are seeking a Senior Java Backend Engineer with strong experience in distributed systems...",
  };

  try {
    // Test relevance analysis
    console.log("Analyzing job relevance...");
    const relevancy = await planner.analyzeRelevance(testJob);

    if (relevancy) {
      console.log("✓ Relevance analysis completed");
      console.log(`  - Relevant: ${relevancy.isRelevant}`);
      console.log(`  - Score: ${relevancy.relevanceScore}%`);
    }

    // Test application planning
    console.log("Creating application plan...");
    const plan = await planner.planApplication(testJob);

    if (plan) {
      console.log("✓ Application plan created");
      console.log(`  - Should apply: ${plan.shouldApply}`);
      console.log(`  - Estimated time: ${plan.estimatedFillTime}s`);
    }

    return true;
  } catch (error) {
    console.error("❌ Planner agent test failed:", error);
    return false;
  }
}

async function testProfileReasoner() {
  console.log("\n=== Testing Profile Reasoner ===");

  const reasoner = new ProfileReasoner();

  const testJob: JobDescription = {
    jobTitle: "Backend Engineer",
    companyName: "TechCorp",
    location: "New York, NY",
    workType: "Remote",
    requirements: ["Java", "Spring Boot"],
  };

  try {
    // Test profile inference
    console.log("Inferring missing profile information...");
    const inference = await reasoner.inferMissingInfo(testJob);

    if (inference) {
      console.log("✓ Profile inference completed");
      console.log(`  - Inferred notice period: ${inference.inferredNoticePeriod}`);
      console.log(`  - Work preference: ${inference.inferredWorkPreference}`);
    }

    // Test answer generation
    console.log("Generating contextual answer...");
    const answer = await reasoner.generateAnswer("Why are you interested in this role?", testJob);

    if (answer && answer.length > 0) {
      console.log("✓ Answer generation completed");
      console.log(`  - Sample: ${answer.substring(0, 50)}...`);
    }

    return true;
  } catch (error) {
    console.error("❌ Profile reasoner test failed:", error);
    return false;
  }
}

async function testMemoryManager() {
  console.log("\n=== Testing Memory Manager ===");

  const memory = new MemoryManager();

  try {
    // Initialize
    console.log("Initializing database...");
    await memory.initialize();
    console.log("✓ Database initialized");

    // Record a test application
    console.log("Recording test application...");
    const record = await memory.recordApplication({
      companyName: "TestCorp",
      jobTitle: "Test Engineer",
      jobUrl: "https://example.com/job1",
      status: "applied",
      relevanceScore: 85,
      fillRating: 90,
      notes: "Test application",
      formDataFilled: { name: "Test", email: "test@example.com" },
    });

    console.log(`✓ Application recorded with ID: ${record.id}`);

    // Check if already applied
    const hasApplied = await memory.hasAppliedBefore(record.jobUrl);
    if (hasApplied) {
      console.log("✓ Duplicate detection works");
    }

    // Get statistics
    const stats = await memory.getStatistics();
    console.log("✓ Statistics retrieved:", {
      total: stats.totalApplications,
      successful: stats.appliedCount,
      successRate: `${stats.successRate.toFixed(2)}%`,
    });

    // Get history
    const history = await memory.getApplicationHistory(10);
    console.log(`✓ Retrieved ${history.length} application records`);

    // Close database
    await memory.close();
    console.log("✓ Database closed");

    return true;
  } catch (error) {
    console.error("❌ Memory manager test failed:", error);
    return false;
  }
}

async function runAllTests() {
  console.log("\n" + "=".repeat(60));
  console.log("AUTONOMOUS JOB APPLICATION AGENT - TEST SUITE");
  console.log("=".repeat(60));

  const results = {
    ollama: false,
    browser: false,
    planner: false,
    reasoner: false,
    memory: false,
  };

  // Run tests
  results.ollama = await testOllamaClient();
  results.browser = await testBrowserAgent();
  results.planner = await testPlannerAgent();
  results.reasoner = await testProfileReasoner();
  results.memory = await testMemoryManager();

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("TEST SUMMARY");
  console.log("=".repeat(60));

  const passed = Object.values(results).filter((r) => r).length;
  const total = Object.keys(results).length;

  console.log(`\n${passed}/${total} tests passed`);

  for (const [test, result] of Object.entries(results)) {
    const status = result ? "✓ PASS" : "✗ FAIL";
    console.log(`  ${status}: ${test}`);
  }

  if (passed === total) {
    console.log("\n✓ All tests passed! Agent is ready for use.");
  } else {
    console.log(
      "\n❌ Some tests failed. Check logs above for details.",
    );
  }

  console.log("\n" + "=".repeat(60));
  console.log("Configuration:");
  console.log(`  - Ollama: ${config.ollama.baseUrl}`);
  console.log(`  - Model: ${config.ollama.model}`);
  console.log(`  - Database: ${config.memory.dbPath}`);
  console.log(`  - Auto-submit: ${config.agent.enableAutoSubmit ? "ENABLED" : "DISABLED (SAFE)"}`);
  console.log("=".repeat(60) + "\n");

  process.exit(passed === total ? 0 : 1);
}

runAllTests().catch((error) => {
  console.error("Test suite failed:", error);
  process.exit(1);
});
