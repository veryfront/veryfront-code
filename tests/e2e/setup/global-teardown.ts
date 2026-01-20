/**
 * Global Teardown for E2E Tests
 *
 * Runs once after all tests to stop the dev server.
 */

import { stopServer } from "./server.js";

export default async function globalTeardown() {
  console.log("\n=== E2E Test Teardown ===");
  console.log("Stopping Veryfront dev server...\n");

  await stopServer();

  console.log("\n=== Cleanup Complete ===\n");
}
