import axios from "axios";
import { type ZodType } from "zod";
import { type Config } from "../config/index";
import { type ChatMessage, type LLMClient } from "../types/index";
import { logger } from "../utils/logger";

export class GeminiClient implements LLMClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(private readonly config: Config) {
    if (!config.llm.geminiApiKey) {
      throw new Error("GEMINI_API_KEY environment variable is missing.");
    }
    this.apiKey = config.llm.geminiApiKey;
    this.baseUrl = `https://aiplatform.googleapis.com/v1/publishers/google/models/${encodeURIComponent(
      this.config.llm.model
    )}:streamGenerateContent?key=${this.apiKey}`;
  }

  async generate(prompt: string): Promise<string> {
    logger.debug("Generating text with Gemini 2.5 Pro...", {
      promptLength: prompt.length,
    });

    try {
      const response = await this.makeRequest([
        { role: "user", parts: [{ text: prompt }] },
      ]);
      return this.extractTextFromStream(response);
    } catch (error) {
      logger.error("Gemini text generation failed", { error });
      throw error;
    }
  }

  async generateJSON<T>(prompt: string, schema: ZodType<T, any, unknown>): Promise<T> {
    const jsonPrompt = `${prompt}\n\nRespond ONLY with valid JSON. No markdown, no backticks, no preamble.`;
    logger.debug("Generating JSON with Gemini 2.5 Pro...", {
      promptLength: jsonPrompt.length,
    });

    try {
      const response = await this.makeRequest([
        { role: "user", parts: [{ text: jsonPrompt }] },
      ]);
      const rawText = await this.extractTextFromStream(response);
      const cleanJsonText = rawText.replace(/^```json/i, "").replace(/```$/i, "").trim();
      
      const parsedData = JSON.parse(cleanJsonText);
      const result = schema.safeParse(parsedData);
      
      if (!result.success) {
        throw new Error(`LLM response schema validation failed: ${result.error.message}`);
      }
      
      return result.data;
    } catch (error) {
      logger.error("Gemini JSON generation failed", { error });
      throw error;
    }
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    logger.debug("Generating chat response with Gemini 2.5 Pro...", {
      messageCount: messages.length,
    });

    try {
      // Map ChatMessage roles to Gemini roles -> user/model
      const mappedContents = messages.map(msg => {
        let role = "user";
        if (msg.role === "assistant") {
           role = "model";
        }
        // Map system prompt to user if model doesn't support system instructions directly in contents array
        return {
          role,
          parts: [{ text: msg.content }]
        };
      });

      // Gemini streaming API might throw an error if consecutive roles are the same, 
      // but typical Usage should alternate properly or start with user.
      const response = await this.makeRequest(mappedContents);
      return this.extractTextFromStream(response);
    } catch (error) {
      logger.error("Gemini chat generation failed", { error });
      throw error;
    }
  }

  private async makeRequest(contents: any[]): Promise<any> {
    return axios.post(
      this.baseUrl,
      { contents },
      {
        headers: { "Content-Type": "application/json" },
        responseType: "stream",
        timeout: 120_000, 
      }
    );
  }

  private async extractTextFromStream(response: any): Promise<string> {
    return new Promise((resolve, reject) => {
      let buffer = "";

      response.data.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf-8");
      });

      response.data.on("end", () => {
        try {
          let textResult = "";
          
          let parsed;
          try {
             parsed = JSON.parse(buffer);
          } catch(e) {
             // If streaming format is `[\n{\n...}\n,\n{\n...}\n]`
             if (buffer.trim().startsWith("[")) {
                 parsed = JSON.parse(buffer.replace(/,\s*]$/, "]"));
             } else {
                 parsed = JSON.parse(`[${buffer.replace(/}\s*,\s*{/g, "},{")}]`);
             }
          }
          
          if (Array.isArray(parsed)) {
             for (const chunk of parsed) {
                if (chunk.candidates?.[0]?.content?.parts?.[0]?.text) {
                   textResult += chunk.candidates[0].content.parts[0].text;
                }
             }
          } else if (parsed.candidates) {
             textResult += parsed.candidates[0]?.content?.parts?.[0]?.text || "";
          }
          
          resolve(textResult.trim());
        } catch (e) {
          logger.error("Failed to parse Gemini stream", { error: e, buffer });
          reject(e);
        }
      });

      response.data.on("error", (err: any) => reject(err));
    });
  }
}
