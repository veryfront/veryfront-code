import { startServer } from "./server.js";

export default async function globalSetup(): Promise<void> {
  console.log("\n=== E2E Test Setup ===");
  console.log("Starting Veryfront dev server...\n");

  await startServer();

  console.log("\n=== Server Ready ===\n");
}
