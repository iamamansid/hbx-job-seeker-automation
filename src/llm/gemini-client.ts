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
  finishReason?: string;
};

type GeminiGenerateContentResponse = {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    thoughtsTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

type GeminiRequestContent = {
  role: "user" | "model";
  parts: Array<{ text: string }>;
};

type GeminiRequestOptions = {
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: "application/json" | "text/plain";
  thinkingBudget?: number;
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
      logger.error("Gemini text generation failed", {
        error: this.serializeError(error),
        model: this.config.llm.model,
      });
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
      const response = await this.makeRequest(
        [{ role: "user", parts: [{ text: jsonPrompt }] }],
        { responseMimeType: "application/json" },
      );
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
      logger.error("Gemini JSON generation failed", {
        error: this.serializeError(error),
        model: this.config.llm.model,
      });
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
      logger.error("Gemini chat generation failed", {
        error: this.serializeError(error),
        model: this.config.llm.model,
      });
      throw error;
    }
  }

  private async makeRequest(
    contents: GeminiRequestContent[],
    requestOptions: GeminiRequestOptions = {},
  ): Promise<GeminiGenerateContentResponse> {
    const initialOptions: GeminiRequestOptions = {
      temperature: requestOptions.temperature ?? this.config.llm.temperature,
      maxOutputTokens: requestOptions.maxOutputTokens ?? this.config.llm.maxOutputTokens,
      responseMimeType: requestOptions.responseMimeType,
      thinkingBudget: requestOptions.thinkingBudget ?? this.getDefaultThinkingBudget(),
    };

    const firstResponse = await this.postRequest(contents, initialOptions);
    if (this.hasVisibleText(firstResponse)) {
      return firstResponse;
    }

    if (!this.shouldRetryForTextlessResponse(firstResponse)) {
      return firstResponse;
    }

    const retryOptions: GeminiRequestOptions = {
      ...initialOptions,
      maxOutputTokens: Math.max((initialOptions.maxOutputTokens ?? this.config.llm.maxOutputTokens) * 2, 2048),
      thinkingBudget: this.getRetryThinkingBudget(initialOptions.thinkingBudget),
    };

    logger.warn("Gemini returned no visible text; retrying with adjusted generation config", {
      model: this.config.llm.model,
      finishReasons: firstResponse.candidates?.map((candidate) => candidate.finishReason).filter(Boolean),
      thoughtsTokenCount: firstResponse.usageMetadata?.thoughtsTokenCount ?? 0,
      candidatesTokenCount: firstResponse.usageMetadata?.candidatesTokenCount ?? 0,
      initialMaxOutputTokens: initialOptions.maxOutputTokens,
      retryMaxOutputTokens: retryOptions.maxOutputTokens,
      initialThinkingBudget: initialOptions.thinkingBudget,
      retryThinkingBudget: retryOptions.thinkingBudget,
    });

    return this.postRequest(contents, retryOptions);
  }

  private async postRequest(
    contents: GeminiRequestContent[],
    requestOptions: GeminiRequestOptions,
  ): Promise<GeminiGenerateContentResponse> {
    const generationConfig: Record<string, unknown> = {
      temperature: requestOptions.temperature ?? this.config.llm.temperature,
      topP: this.config.llm.topP,
      maxOutputTokens: requestOptions.maxOutputTokens ?? this.config.llm.maxOutputTokens,
    };

    if (requestOptions.responseMimeType) {
      generationConfig.responseMimeType = requestOptions.responseMimeType;
    }

    if (requestOptions.thinkingBudget !== undefined) {
      generationConfig.thinkingConfig = {
        thinkingBudget: requestOptions.thinkingBudget,
      };
    }

    const response = await axios.post<GeminiGenerateContentResponse>(
      this.endpoint,
      {
        contents,
        generationConfig,
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
      const finishReasons = response.candidates?.map((candidate) => candidate.finishReason).filter(Boolean);
      const thoughtsTokenCount = response.usageMetadata?.thoughtsTokenCount ?? 0;
      throw new Error(
        `Gemini response did not contain any text parts. finishReasons=${finishReasons?.join(",") || "unknown"}, thoughtsTokenCount=${thoughtsTokenCount}`,
      );
    }

    return text;
  }

  private hasVisibleText(response: GeminiGenerateContentResponse): boolean {
    return (response.candidates ?? [])
      .flatMap((candidate) => candidate.content?.parts ?? [])
      .some((part) => typeof part.text === "string" && part.text.trim().length > 0);
  }

  private shouldRetryForTextlessResponse(response: GeminiGenerateContentResponse): boolean {
    if (this.hasVisibleText(response)) {
      return false;
    }

    const finishReasons = response.candidates?.map((candidate) => candidate.finishReason);
    const hitMaxTokens = finishReasons?.includes("MAX_TOKENS") ?? false;
    const thoughtsTokenCount = response.usageMetadata?.thoughtsTokenCount ?? 0;

    return hitMaxTokens || thoughtsTokenCount > 0;
  }

  private getDefaultThinkingBudget(): number | undefined {
    return this.config.llm.model.startsWith("gemini-2.5")
      ? Math.max(128, this.config.llm.thinkingBudget)
      : undefined;
  }

  private getRetryThinkingBudget(thinkingBudget: number | undefined): number | undefined {
    if (thinkingBudget === undefined) {
      return this.getDefaultThinkingBudget();
    }

    return Math.max(128, Math.min(thinkingBudget, 256));
  }

  private serializeError(error: unknown): Record<string, unknown> {
    if (axios.isAxiosError(error)) {
      return {
        message: error.message,
        code: error.code,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
      };
    }

    if (error instanceof Error) {
      return {
        message: error.message,
        stack: error.stack,
      };
    }

    return {
      value: String(error),
    };
  }
}
