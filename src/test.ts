import { BrowserAgent } from "./browser/browser-agent";
import { BrowserLifecycleManager } from "./browser/browser-lifecycle-manager";
import { config } from "./config/index";
import { GeminiClient } from "./llm/gemini-client";
import { MemoryManager } from "./memory/memory-manager";
import { PlannerAgent } from "./agents/planner-agent";
import { ProfileReasoner } from "./agents/profile-reasoner";
import { ExecutorAgent } from "./agents/executor-agent";
import { logger } from "./utils/logger";

async function runSmokeTest(): Promise<void> {
  const browserLifecycleManager = BrowserLifecycleManager.getInstance(config);
  const llmClient = new GeminiClient(config);
  const memoryManager = new MemoryManager(config);
  const browserAgent = new BrowserAgent(browserLifecycleManager, config);
  const profileReasoner = new ProfileReasoner(llmClient, config);
  const plannerAgent = new PlannerAgent(llmClient, config);
  const executorAgent = new ExecutorAgent(browserAgent, profileReasoner, llmClient, config);

  try {
    await memoryManager.initialize();
    logger.info("Smoke test initialized dependencies", {
      llmModel: config.llm.model,
      targetPortals: config.search.targetPortals,
      autoSubmit: config.agent.enableAutoSubmit,
    });

    await browserLifecycleManager.closeAll();
    await executorAgent.suggestNextAction("<form><input name='email' /></form>");
    await plannerAgent.extractJobDescription("<h1>Java Developer</h1><p>Visa sponsorship available</p>");
    await profileReasoner.scoreResponse("I am excited about this opportunity.", {
      jobTitle: "Java Developer",
      companyName: "Example Co",
      location: "Sydney, NSW",
      requirements: ["Java", "Spring Boot"],
      responsibilities: [],
      benefits: [],
      workType: "Hybrid",
      fullDescription: "Java role with sponsorship.",
      salaryRange: "AUD 100,000 - 120,000",
      url: "https://example.com/job",
    });
    logger.info("Smoke test completed");
  } catch (error) {
    logger.error("Smoke test failed", { error });
    process.exitCode = 1;
  } finally {
    await memoryManager.close().catch(() => undefined);
    await browserLifecycleManager.closeAll().catch(() => undefined);
  }
}

void runSmokeTest();
