/**
 * Global Setup for E2E Tests
 *
 * Runs once before all tests to start the dev server.
 */

import { startServer } from "./server.js";

export default async function globalSetup() {
  console.log("\n=== E2E Test Setup ===");
  console.log("Starting Veryfront dev server...\n");

  await startServer();

  console.log("\n=== Server Ready ===\n");
}
