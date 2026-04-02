import { stopServer } from "./server.ts";

export default async function globalTeardown(): Promise<void> {
  console.log("\n=== E2E Test Teardown ===");
  console.log("Stopping Veryfront dev server...\n");

  await stopServer();

  console.log("\n=== Cleanup Complete ===\n");
}
