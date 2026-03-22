import axios, { AxiosInstance } from "axios";
import { config } from "../config/index";
import logger from "../utils/logger";
import { LLMResponse } from "../types/index";

export class OllamaClient {
  private client: AxiosInstance;
  private baseUrl: string;
  private model: string;
  private readonly thinkingLogsEnabled: boolean;
  private readonly thinkingLogMaxChars: number;

  constructor() {
    this.baseUrl = config.ollama.baseUrl;
    this.model = config.ollama.model;
    this.thinkingLogsEnabled = process.env.LLM_THINKING_LOGS !== "false";
    this.thinkingLogMaxChars = Math.max(
      200,
      parseInt(process.env.LLM_THINKING_MAX_CHARS || "1800", 10) || 1800
    );
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 60000, // 60 seconds - LLM can be slow
    });
  }

  /**
   * Check if Ollama is running and model is available
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get("/api/tags");
      const models = response.data.models || [];
      const modelExists = models.some((m: any) => m.name === this.model);

      if (!modelExists) {
        logger.warn(`Model ${this.model} not found. Available models:`, models.map((m: any) => m.name));
      }

      logger.info(`Ollama health check passed. Model: ${this.model}`);
      return true;
    } catch (error) {
      logger.error("Ollama health check failed:", error);
      return false;
    }
  }

  /**
   * Generate text using the local Ollama model
   */
  async generate(prompt: string): Promise<LLMResponse<string>> {
    try {
      logger.debug("Sending prompt to Ollama:", prompt.substring(0, 100) + "...");
      this.logThinking("generate.prompt", prompt);

      const response = await this.client.post("/api/generate", {
        model: this.model,
        prompt,
        temperature: config.ollama.temperature,
        top_p: config.ollama.topP,
        stream: false,
      });

      const generatedText = response.data.response || "";
      this.logThinking("generate.response", generatedText);
      this.logThinking(
        "generate.tokens",
        `prompt=${response.data.prompt_eval_count || 0}, completion=${response.data.eval_count || 0}`
      );

      return {
        success: true,
        data: generatedText,
        tokensUsed: {
          prompt: response.data.prompt_eval_count || 0,
          completion: response.data.eval_count || 0,
        },
      };
    } catch (error) {
      logger.error("Error generating text with Ollama:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Generate structured JSON output using the local model
   */
  async generateJSON<T>(systemPrompt: string, userPrompt: string): Promise<LLMResponse<T>> {
    try {
      const fullPrompt = `${systemPrompt}

User Request:
${userPrompt}

Please respond ONLY with valid JSON in the following format (no markdown, no code blocks, no extra text):`;

      logger.debug("Generating JSON from Ollama, system:", systemPrompt.substring(0, 100));
      this.logThinking("json.system", systemPrompt);
      this.logThinking("json.user", userPrompt);

      const response = await this.client.post("/api/generate", {
        model: this.model,
        prompt: fullPrompt,
        temperature: config.ollama.temperature,
        top_p: config.ollama.topP,
        stream: false,
      });

      const responseText = response.data.response || "";
      this.logThinking("json.raw_response", responseText);

      // Try to extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response: " + responseText.substring(0, 200));
      }

      const parsedData = JSON.parse(jsonMatch[0]) as T;
      this.logThinking("json.parsed", JSON.stringify(parsedData));
      this.logThinking(
        "json.tokens",
        `prompt=${response.data.prompt_eval_count || 0}, completion=${response.data.eval_count || 0}`
      );

      return {
        success: true,
        data: parsedData,
        reasoning: responseText,
        tokensUsed: {
          prompt: response.data.prompt_eval_count || 0,
          completion: response.data.eval_count || 0,
        },
      };
    } catch (error) {
      logger.error("Error generating JSON with Ollama:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Multi-turn conversation with memory
   */
  async chat(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>): Promise<LLMResponse<string>> {
    try {
      // Ollama's chat endpoint is not available in all versions, use generate instead
      const conversationText = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
      this.logThinking("chat.messages", conversationText);

      const response = await this.client.post("/api/generate", {
        model: this.model,
        prompt: conversationText,
        temperature: config.ollama.temperature,
        top_p: config.ollama.topP,
        stream: false,
      });
      this.logThinking("chat.response", response.data.response || "");

      return {
        success: true,
        data: response.data.response || "",
      };
    } catch (error) {
      logger.error("Error in chat with Ollama:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Extract and validate structured data
   */
  async extractStructured<T>(object: string, schema: string): Promise<LLMResponse<T>> {
    const systemPrompt = `You are a JSON extraction expert. Extract information from the given text and return ONLY valid JSON matching the provided schema. Do not include any markdown formatting, code blocks, or explanations.`;

    const userPrompt = `TEXT TO EXTRACT FROM:
${object}

REQUIRED JSON SCHEMA:
${schema}

Extract the data and respond with ONLY the JSON object.`;

    return this.generateJSON<T>(systemPrompt, userPrompt);
  }

  private logThinking(stage: string, content: string): void {
    if (!this.thinkingLogsEnabled) {
      return;
    }
    const cleaned = (content || "").trim();
    if (!cleaned) {
      return;
    }

    const output =
      cleaned.length > this.thinkingLogMaxChars
        ? `${cleaned.substring(0, this.thinkingLogMaxChars)} ...[truncated]`
        : cleaned;
    logger.info(`[LLM:${stage}] ${output}`);
  }
}

export default OllamaClient;
