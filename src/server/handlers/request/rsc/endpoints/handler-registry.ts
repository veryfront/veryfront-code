/**
 * RSC handler registry for managing per-project handlers
 * @module rsc-endpoints/handler-registry
 */

import { RSCDevServerHandler } from "../handlers/index.ts";

/**
 * Global registry of RSC handlers by project directory
 * Maintains handlers per projectDir to avoid cross-project leakage
 */
const rscHandlersByProject = new Map<string, RSCDevServerHandler>();

/**
 * Get or create RSC handler instance for a project
 * @param projectDir - Project directory path
 * @returns RSC handler instance
 */
export function getRSCHandler(projectDir: string): RSCDevServerHandler {
  let handler = rscHandlersByProject.get(projectDir);
  if (!handler) {
    handler = new RSCDevServerHandler(projectDir);
    rscHandlersByProject.set(projectDir, handler);
  }
  return handler;
}

/**
 * Test-only: reset the singleton RSC handler to avoid cross-test leakage
 */
export function __resetRSCHandlerForTests(): void {
  rscHandlersByProject.clear();
}
