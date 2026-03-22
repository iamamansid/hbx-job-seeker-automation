import axios from "axios";

import { seekConfig } from "../config/config";
import { type SessionSummary, type TopMatch } from "../seek/types";
import { logger } from "../utils/logger";
import { formatInTimezone } from "../utils/time";

const formatTopMatches = (topMatches: TopMatch[]): string =>
  topMatches.length > 0
    ? topMatches.map((match, index) => `${index + 1}. ${match.title} @ ${match.company}`).join("\n")
    : "No scored matches yet";

export class TelegramNotifier {
  async send(message: string): Promise<void> {
    try {
      if (!seekConfig.telegram.enabled) {
        logger.info("Telegram notifier is disabled; message logged locally instead.", { message });
        return;
      }

      await axios.post(`https://api.telegram.org/bot${seekConfig.telegram.botToken}/sendMessage`, {
        chat_id: seekConfig.telegram.chatId,
        text: message,
      });
    } catch (error) {
      logger.error("Failed to send Telegram notification", { error, message });
    }
  }

  async sendApplicationSuccess(title: string, company: string, score: number): Promise<void> {
    await this.send(`✅ Applied: ${title} @ ${company} | Score: ${score}`);
  }

  async sendExternalApplication(title: string, company: string, url: string): Promise<void> {
    await this.send(`⚠️ Manual apply needed: ${title} @ ${company}\n${url}`);
  }

  async sendCaptchaDetected(details: string): Promise<void> {
    await this.send(`🛑 CAPTCHA detected on SEEK. Session paused for 2 hours.\n${details}`);
  }

  async sendSessionError(details: string): Promise<void> {
    await this.send(`❌ SEEK auto-applier session error\n${details}`);
  }

  async sendDailySummary(summary: SessionSummary): Promise<void> {
    const dateLabel = formatInTimezone(new Date(summary.finishedAt), seekConfig.scheduler.timezone, false);
    await this.send(
      [
        `📊 Daily SEEK Report — ${dateLabel}`,
        `✅ Applied: ${summary.applied} jobs`,
        `⚠️ External (manual needed): ${summary.external} jobs`,
        `❌ Errors: ${summary.errors} jobs`,
        `🚫 Skipped: ${summary.skipped + summary.duplicates} jobs`,
        `🧪 Dry run queued: ${summary.dryRunQueued} jobs`,
        `🏆 Top matches: ${formatTopMatches(summary.topMatches)}`,
      ].join("\n"),
    );
  }
}

export const notifier = new TelegramNotifier();
