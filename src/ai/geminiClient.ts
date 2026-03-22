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
};

type GeminiPart = {
  text?: string;
};

type GeminiCandidate = {
  content?: {
    parts?: GeminiPart[];
  };
};

type GeminiGenerateContentResponse = {
  candidates?: GeminiCandidate[];
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

        const response = await axios.post<GeminiGenerateContentResponse>(
          `${this.endpoint}/${this.modelName}:generateContent`,
          {
            contents: [
              {
                role: "user",
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              temperature: effectiveTemperature,
              maxOutputTokens: seekConfig.ai.maxOutputTokens,
            },
          },
          {
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": this.apiKey,
            },
            timeout: 120_000,
          },
        );

        this.lastCallAt = Date.now();
        const responseText = this.extractTextFromResponse(response.data);

        if (!responseText) {
          throw new Error("Gemini response did not contain any text parts.");
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
          error,
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
}

export const gemini = GeminiClient.getInstance();
