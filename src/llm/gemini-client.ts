import axios from "axios";
import { type ZodType } from "zod";

import { type Config } from "../config/index";
import { type ChatMessage, type LLMClient } from "../types/index";
import { logger } from "../utils/logger";

type GeminiPart = {
  text?: string;
};

type GeminiContent = {
  role?: string;
  parts?: GeminiPart[];
};

type GeminiCandidate = {
  content?: GeminiContent;
};

type GeminiGenerateContentResponse = {
  candidates?: GeminiCandidate[];
};

type GeminiRequestContent = {
  role: "user" | "model";
  parts: Array<{ text: string }>;
};

export class GeminiClient implements LLMClient {
  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor(private readonly config: Config) {
    if (!config.llm.geminiApiKey) {
      throw new Error("GEMINI_API_KEY environment variable is missing.");
    }

    this.apiKey = config.llm.geminiApiKey;
    this.endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      this.config.llm.model,
    )}:generateContent`;
  }

  async generate(prompt: string): Promise<string> {
    logger.debug("Generating text with Gemini", {
      model: this.config.llm.model,
      promptLength: prompt.length,
    });

    try {
      const response = await this.makeRequest([
        { role: "user", parts: [{ text: prompt }] },
      ]);
      return this.extractTextFromResponse(response);
    } catch (error) {
      logger.error("Gemini text generation failed", { error, model: this.config.llm.model });
      throw error;
    }
  }

  async generateJSON<T>(prompt: string, schema: ZodType<T, any, unknown>): Promise<T> {
    const jsonPrompt = `${prompt}\n\nRespond ONLY with valid JSON. No markdown, no backticks, no preamble.`;
    logger.debug("Generating JSON with Gemini", {
      model: this.config.llm.model,
      promptLength: jsonPrompt.length,
    });

    try {
      const response = await this.makeRequest([
        { role: "user", parts: [{ text: jsonPrompt }] },
      ]);
      const rawText = this.extractTextFromResponse(response);
      const cleanJsonText = rawText
        .replace(/^```json/i, "")
        .replace(/^```/i, "")
        .replace(/```$/i, "")
        .trim();
      const jsonMatch = cleanJsonText.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      const parsedData = JSON.parse(jsonMatch ? jsonMatch[0] : cleanJsonText);
      const result = schema.safeParse(parsedData);

      if (!result.success) {
        throw new Error(`LLM response schema validation failed: ${result.error.message}`);
      }

      return result.data;
    } catch (error) {
      logger.error("Gemini JSON generation failed", { error, model: this.config.llm.model });
      throw error;
    }
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    logger.debug("Generating chat response with Gemini", {
      model: this.config.llm.model,
      messageCount: messages.length,
    });

    try {
      const mappedContents: GeminiRequestContent[] = messages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      }));

      const response = await this.makeRequest(mappedContents);
      return this.extractTextFromResponse(response);
    } catch (error) {
      logger.error("Gemini chat generation failed", { error, model: this.config.llm.model });
      throw error;
    }
  }

  private async makeRequest(contents: GeminiRequestContent[]): Promise<GeminiGenerateContentResponse> {
    const response = await axios.post<GeminiGenerateContentResponse>(
      this.endpoint,
      {
        contents,
        generationConfig: {
          temperature: this.config.llm.temperature,
          topP: this.config.llm.topP,
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        timeout: this.config.llm.timeoutMs,
      },
    );

    return response.data;
  }

  private extractTextFromResponse(response: GeminiGenerateContentResponse): string {
    const text = (response.candidates ?? [])
      .flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("")
      .trim();

    if (!text) {
      throw new Error("Gemini response did not contain any text parts.");
    }

    return text;
  }
}
