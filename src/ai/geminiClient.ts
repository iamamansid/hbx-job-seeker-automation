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

type VertexPart = {
  text?: string;
  thought?: boolean;
};

type VertexCandidate = {
  content?: {
    parts?: VertexPart[];
  };
};

type VertexGenerateContentResponse = {
  candidates?: VertexCandidate[];
};

class GeminiClient {
  private static instance: GeminiClient;

  private readonly modelName = seekConfig.ai.model;

  private readonly apiKey = seekConfig.ai.apiKey;

  private readonly endpoint = "https://aiplatform.googleapis.com/v1/publishers/google/models";

  private lastCallAt = 0;

  private callChain: Promise<void> = Promise.resolve();

  public static getInstance(): GeminiClient {
    if (!GeminiClient.instance) {
      GeminiClient.instance = new GeminiClient();
    }

    return GeminiClient.instance;
  }

  private extractTextFromChunk(chunk: VertexGenerateContentResponse): string {
    return (chunk.candidates ?? [])
      .flatMap((candidate) => candidate.content?.parts ?? [])
      .filter((part) => typeof part.text === "string" && !part.thought)
      .map((part) => part.text ?? "")
      .join("");
  }

  private extractTextFromResponse(data: unknown): string {
    if (Array.isArray(data)) {
      return data
        .map((chunk) => this.extractTextFromChunk(chunk as VertexGenerateContentResponse))
        .join("")
        .trim();
    }

    if (data && typeof data === "object") {
      return this.extractTextFromChunk(data as VertexGenerateContentResponse).trim();
    }

    return "";
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
          apiSurface: "vertex-express-stream",
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

        const response = await axios.post<VertexGenerateContentResponse[] | VertexGenerateContentResponse>(
          `${this.endpoint}/${this.modelName}:streamGenerateContent`,
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
            params: {
              key: this.apiKey,
            },
            headers: {
              "Content-Type": "application/json",
            },
            timeout: 120000,
          },
        );

        this.lastCallAt = Date.now();
        const responseText = this.extractTextFromResponse(response.data);

        if (!responseText) {
          throw new Error("Vertex Gemini response did not contain any text parts.");
        }

        logger.info("Gemini request completed", {
          label: options.label ?? "unspecified",
          model: this.modelName,
          apiSurface: "vertex-express-stream",
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
          apiSurface: "vertex-express-stream",
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
