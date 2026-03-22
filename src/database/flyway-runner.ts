import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { config, type Config } from "../config/index";
import { logger } from "../utils/logger";

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  commandLabel: string;
};

export class FlywayRunner {
  private readonly rootDir = process.cwd();
  private readonly sqlDir = resolve(this.rootDir, "src", "db", "migrations");

  constructor(private readonly runtimeConfig: Config = config) {}

  async migrate(): Promise<void> {
    if (!this.runtimeConfig.migrations.autoMigrate) {
      logger.info("Skipping Flyway migrations because auto-migrate is disabled");
      return;
    }

    if (!this.hasDatabaseCredentials()) {
      throw new Error(
        "PostgreSQL credentials are incomplete. Set DATABASE_URL or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD before starting the app.",
      );
    }

    if (!existsSync(this.sqlDir)) {
      throw new Error(`Flyway SQL directory not found at ${this.sqlDir}`);
    }

    const localFlyway = await this.runLocalFlyway("migrate");
    if (localFlyway.exitCode === 0) {
      logger.info("Flyway migrations completed using local Flyway CLI");
      return;
    }

    logger.warn("Local Flyway CLI unavailable or failed, falling back to Docker", {
      stderr: localFlyway.stderr,
    });

    const dockerFlyway = await this.runDockerFlyway("migrate");
    if (dockerFlyway.exitCode !== 0) {
      throw new Error(
        `Flyway migration failed. Local stderr: ${localFlyway.stderr || "n/a"} | Docker stderr: ${dockerFlyway.stderr || "n/a"}`,
      );
    }

    logger.info("Flyway migrations completed using Dockerized Flyway");
  }

  private async runLocalFlyway(command: "migrate"): Promise<CommandResult> {
    const binary = process.env.FLYWAY_BIN?.trim() || "flyway";
    return this.runCommand(binary, [...this.buildFlywayArgs(), command], "local-flyway");
  }

  private async runDockerFlyway(command: "migrate"): Promise<CommandResult> {
    const volumeArg = `${this.sqlDir}:/flyway/sql`;
    const args = [
      "run",
      "--rm",
      "-v",
      volumeArg,
      this.runtimeConfig.migrations.dockerImage,
      ...this.buildFlywayArgs("/flyway/sql"),
      command,
    ];

    return this.runCommand("docker", args, "docker-flyway");
  }

  private buildFlywayArgs(sqlLocation = this.sqlDir): string[] {
    const jdbcUrl = this.getJdbcUrl();

    return [
      `-url=${jdbcUrl}`,
      `-user=${this.runtimeConfig.database.user}`,
      `-password=${this.runtimeConfig.database.password}`,
      `-connectRetries=3`,
      `-locations=filesystem:${sqlLocation}`,
      `-schemas=${this.runtimeConfig.database.schema}`,
      `-defaultSchema=${this.runtimeConfig.database.schema}`,
      `-table=${this.runtimeConfig.migrations.schemaHistoryTable}`,
      "-createSchemas=true",
    ];
  }

  private getJdbcUrl(): string {
    if (this.runtimeConfig.database.url) {
      const dbUrl = new URL(this.runtimeConfig.database.url);
      return `jdbc:postgresql://${dbUrl.host}${dbUrl.pathname}`;
    }

    const sslMode = this.runtimeConfig.database.ssl ? "?sslmode=require" : "";
    return (
      `jdbc:postgresql://${this.runtimeConfig.database.host}:${this.runtimeConfig.database.port}/` +
      `${this.runtimeConfig.database.database}${sslMode}`
    );
  }

  private hasDatabaseCredentials(): boolean {
    if (this.runtimeConfig.database.url) {
      return true;
    }

    return (
      this.runtimeConfig.database.host.length > 0 &&
      this.runtimeConfig.database.database.length > 0 &&
      this.runtimeConfig.database.user.length > 0 &&
      this.runtimeConfig.database.password.length > 0
    );
  }

  private async runCommand(
    command: string,
    args: string[],
    commandLabel: string,
  ): Promise<CommandResult> {
    return new Promise<CommandResult>((resolveResult) => {
      const child = spawn(command, args, {
        cwd: this.rootDir,
        env: process.env,
        shell: false,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        stderr += error.message;
      });
      child.on("close", (exitCode) => {
        resolveResult({
          exitCode: exitCode ?? 1,
          stdout,
          stderr,
          commandLabel,
        });
      });
    });
  }
}
