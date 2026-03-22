import { FlywayRunner } from "../database/flyway-runner";

async function main(): Promise<void> {
  const flyway = new FlywayRunner();
  await flyway.migrate();
  console.log("Flyway migrations completed.");
}

void main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
