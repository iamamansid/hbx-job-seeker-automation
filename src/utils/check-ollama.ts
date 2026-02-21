import axios from "axios";
import { config } from "../config/index";

async function checkOllama() {
  console.log("\n=== Ollama Health Check ===\n");
  console.log(`Checking Ollama at: ${config.ollama.baseUrl}`);

  try {
    // Check if Ollama is running
    const response = await axios.get(`${config.ollama.baseUrl}/api/tags`, { timeout: 5000 });

    console.log("✓ Ollama is running!");

    // List available models
    const models = response.data.models || [];
    console.log(`\nAvailable models (${models.length}):`);

    if (models.length === 0) {
      console.log("  No models installed");
      console.log("\nTo install Llama 3.2, run:");
      console.log("  ollama pull llama3.2");
      console.log("  ollama pull neural-chat");
    } else {
      models.forEach((model: any) => {
        console.log(`  - ${model.name} (${(model.size / 1024 / 1024 / 1024).toFixed(2)} GB)`);
      });
    }

    // Check if configured model is available
    const modelExists = models.some((m: any) => m.name === config.ollama.model);
    if (!modelExists) {
      console.log(`\n⚠️  Configured model "${config.ollama.model}" not found!`);
      console.log(`To install it, run: ollama pull ${config.ollama.model}`);
    } else {
      console.log(`\n✓ Configured model "${config.ollama.model}" is available`);
    }

    // Test generation
    console.log("\nTesting model generation...");
    const testResponse = await axios.post(`${config.ollama.baseUrl}/api/generate`, {
      model: config.ollama.model,
      prompt: "Say 'Hello' in one word.",
      stream: false,
      temperature: 0.5,
    });

    console.log("✓ Model generation works!");
    console.log(`Response: ${testResponse.data.response?.substring(0, 50)}...`);

    console.log("\n✓ Ollama is ready for the job application agent!\n");
  } catch (error: any) {
    console.error("✗ Ollama health check failed!");

    if ((error as any).code === "ECONNREFUSED") {
      console.log("\nOllama is not running. To start it, run:");
      console.log("  ollama serve");
    } else if ((error as any).code === "ENOTFOUND") {
      console.log("\nCannot connect to Ollama at", config.ollama.baseUrl);
      console.log("Update OLLAMA_BASE_URL in .env if using a different address");
    } else {
      console.log("Error:", (error as any).message);
    }

    console.log("\nSetup steps:");
    console.log("1. Install Ollama from https://ollama.ai");
    console.log("2. Run: ollama serve");
    console.log("3. In another terminal, run: ollama pull llama2");
    console.log("4. Update OLLAMA_MODEL in .env if needed\n");

    process.exit(1);
  }
}

checkOllama();
