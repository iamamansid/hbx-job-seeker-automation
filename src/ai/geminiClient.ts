import axios from "axios";

import { seekConfig } from "../config/config";
import { sleep } from "../utils/humanDelay";
import { logger } from "../utils/logger";
import { normalizeWhitespace, truncate } from "../utils/text";

type GeminiGenerateOptions = {
  label?: string;
  metadata?: Record<string, unknown>;
  logPromptPreview?: boolean;
  logResponsePreview?: boolean;
  responseMimeType?: "application/json" | "text/plain";
  maxOutputTokens?: number;
  thinkingBudget?: number;
};

type GeminiPart = {
  text?: string;
};

type GeminiCandidate = {
  content?: {
    parts?: GeminiPart[];
  };
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

class GeminiClient {
  private static instance: GeminiClient;

  private readonly modelName = seekConfig.ai.model;
  private readonly apiKey = seekConfig.ai.apiKey;
  private readonly endpoint = "https://generativelanguage.googleapis.com/v1beta/models";
  private lastCallAt = 0;
  private callChain: Promise<void> = Promise.resolve();

  public static getInstance(): GeminiClient {
    if (!GeminiClient.instance) {
      GeminiClient.instance = new GeminiClient();
    }

    return GeminiClient.instance;
  }

  private extractTextFromResponse(data: GeminiGenerateContentResponse): string {
    return (data.candidates ?? [])
      .flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("")
      .trim();
  }

  public async generate(
    prompt: string,
    temperature?: number,
    options: GeminiGenerateOptions = {},
  ): Promise<string> {
    const task = this.callChain.then(async () => {
      const startedAt = Date.now();
      const effectiveTemperature = temperature ?? 0.7;

      try {
        const elapsed = Date.now() - this.lastCallAt;
        const waitMs = Math.max(0, seekConfig.ai.minDelayBetweenCallsMs - elapsed);

        logger.info("Gemini request started", {
          label: options.label ?? "unspecified",
          model: this.modelName,
          apiSurface: "gemini-direct-rest",
          temperature: effectiveTemperature,
          promptChars: prompt.length,
          queuedDelayMs: waitMs,
          ...options.metadata,
          ...(options.logPromptPreview
            ? {
                promptPreview: truncate(normalizeWhitespace(prompt), 500),
              }
            : {}),
        });

        if (waitMs > 0) {
          await sleep(waitMs);
        }

        const response = await this.requestWithRetry(prompt, {
          temperature: effectiveTemperature,
          responseMimeType: options.responseMimeType,
          maxOutputTokens: options.maxOutputTokens ?? seekConfig.ai.maxOutputTokens,
          thinkingBudget: options.thinkingBudget ?? this.getDefaultThinkingBudget(),
        });

        const responseText = this.extractTextFromResponse(response);
        this.lastCallAt = Date.now();

        if (!responseText) {
          const finishReasons = response.candidates?.map((candidate) => candidate.finishReason).filter(Boolean);
          throw new Error(
            `Gemini response did not contain any text parts. finishReasons=${finishReasons?.join(",") || "unknown"}, thoughtsTokenCount=${response.usageMetadata?.thoughtsTokenCount ?? 0}`,
          );
        }

        logger.info("Gemini request completed", {
          label: options.label ?? "unspecified",
          model: this.modelName,
          apiSurface: "gemini-direct-rest",
          temperature: effectiveTemperature,
          promptChars: prompt.length,
          responseChars: responseText.length,
          durationMs: Date.now() - startedAt,
          ...options.metadata,
          ...(options.logResponsePreview
            ? {
                responsePreview: truncate(normalizeWhitespace(responseText), 500),
              }
            : {}),
        });

        return responseText;
      } catch (error) {
        this.lastCallAt = Date.now();
        logger.error("Gemini content generation failed", {
          error: this.serializeError(error),
          label: options.label ?? "unspecified",
          model: this.modelName,
          apiSurface: "gemini-direct-rest",
          temperature: effectiveTemperature,
          promptChars: prompt.length,
          durationMs: Date.now() - startedAt,
          ...options.metadata,
          ...(options.logPromptPreview
            ? {
                promptPreview: truncate(normalizeWhitespace(prompt), 500),
              }
            : {}),
        });
        throw error;
      }
    });

    this.callChain = task.then(
      () => undefined,
      () => undefined,
    );

    return task;
  }

  private async requestWithRetry(
    prompt: string,
    request: Required<Pick<GeminiGenerateOptions, "maxOutputTokens" | "thinkingBudget">> &
      Pick<GeminiGenerateOptions, "responseMimeType"> & { temperature: number },
  ): Promise<GeminiGenerateContentResponse> {
    const firstResponse = await this.postGenerateContent(prompt, request);
    if (this.hasVisibleText(firstResponse)) {
      return firstResponse;
    }

    if (!this.shouldRetryForTextlessResponse(firstResponse, request.thinkingBudget)) {
      return firstResponse;
    }

    const retryRequest = {
      ...request,
      maxOutputTokens: Math.max(request.maxOutputTokens * 2, 2048),
      thinkingBudget: this.getRetryThinkingBudget(request.thinkingBudget),
    };

    logger.warn("Gemini returned no visible text; retrying with adjusted generation config", {
      model: this.modelName,
      finishReasons: firstResponse.candidates?.map((candidate) => candidate.finishReason).filter(Boolean),
      thoughtsTokenCount: firstResponse.usageMetadata?.thoughtsTokenCount ?? 0,
      candidatesTokenCount: firstResponse.usageMetadata?.candidatesTokenCount ?? 0,
      initialMaxOutputTokens: request.maxOutputTokens,
      retryMaxOutputTokens: retryRequest.maxOutputTokens,
      initialThinkingBudget: request.thinkingBudget,
      retryThinkingBudget: retryRequest.thinkingBudget,
    });

    return this.postGenerateContent(prompt, retryRequest);
  }

  private async postGenerateContent(
    prompt: string,
    request: Required<Pick<GeminiGenerateOptions, "maxOutputTokens" | "thinkingBudget">> &
      Pick<GeminiGenerateOptions, "responseMimeType"> & { temperature: number },
  ): Promise<GeminiGenerateContentResponse> {
    const generationConfig: Record<string, unknown> = {
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens,
      thinkingConfig: {
        thinkingBudget: request.thinkingBudget,
      },
    };

    if (request.responseMimeType) {
      generationConfig.responseMimeType = request.responseMimeType;
    }

    const response = await axios.post<GeminiGenerateContentResponse>(
      `${this.endpoint}/${this.modelName}:generateContent`,
      {
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        timeout: 120_000,
      },
    );

    return response.data;
  }

  private hasVisibleText(response: GeminiGenerateContentResponse): boolean {
    return (response.candidates ?? [])
      .flatMap((candidate) => candidate.content?.parts ?? [])
      .some((part) => typeof part.text === "string" && part.text.trim().length > 0);
  }

  private shouldRetryForTextlessResponse(
    response: GeminiGenerateContentResponse,
    thinkingBudget: number,
  ): boolean {
    if (this.hasVisibleText(response)) {
      return false;
    }

    const finishReasons = response.candidates?.map((candidate) => candidate.finishReason);
    const hitMaxTokens = finishReasons?.includes("MAX_TOKENS") ?? false;
    const thoughtsTokenCount = response.usageMetadata?.thoughtsTokenCount ?? 0;

    return hitMaxTokens || thoughtsTokenCount > 0 || thinkingBudget > 128;
  }

  private getDefaultThinkingBudget(): number {
    return this.modelName.startsWith("gemini-2.5")
      ? Math.max(128, seekConfig.ai.thinkingBudget)
      : seekConfig.ai.thinkingBudget;
  }

  private getRetryThinkingBudget(thinkingBudget: number): number {
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

export const gemini = GeminiClient.getInstance();
