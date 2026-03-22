import fs from "fs";
import path from "path";

import DailyRotateFile from "winston-daily-rotate-file";
import winston from "winston";

const logsDir = path.join(process.cwd(), "data", "logs");
fs.mkdirSync(logsDir, { recursive: true });

const baseFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json(),
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const payload = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
    const stackSuffix = typeof stack === "string" ? `\n${stack}` : "";
    return `${timestamp} [${level}] ${message}${payload}${stackSuffix}`;
  }),
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: baseFormat,
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
    }),
    new DailyRotateFile({
      dirname: logsDir,
      filename: "seek-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      maxFiles: "14d",
      zippedArchive: false,
    }),
    new DailyRotateFile({
      dirname: logsDir,
      filename: "seek-error-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      level: "error",
      maxFiles: "30d",
      zippedArchive: false,
    }),
  ],
});
