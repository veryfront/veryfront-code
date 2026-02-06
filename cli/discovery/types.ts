/**
 * Discovery Types
 *
 * Type definitions for the discovery module.
 */

import type { Tool } from "#veryfront/tool";
import type { Agent } from "#veryfront/agent";
import type { Resource } from "#veryfront/resource";
import type { Prompt } from "#veryfront/prompt";
import type { Workflow } from "#veryfront/workflow";
import type { Platform } from "#veryfront/platform/core-platform.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";

/**
 * Context for file discovery operations
 */
export interface FileDiscoveryContext {
  platform: Platform;
  fsAdapter?: FileSystemAdapter;
  nodeDeps?: {
    fs: typeof import("node:fs");
    path: typeof import("node:path");
  };
  baseDir?: string;
}

/**
 * Configuration for the discovery process
 */
export interface DiscoveryConfig {
  baseDir: string;
  toolDirs?: string[];
  agentDirs?: string[];
  resourceDirs?: string[];
  promptDirs?: string[];
  workflowDirs?: string[];
  verbose?: boolean;
  fsAdapter?: FileSystemAdapter;
}

/**
 * Result of the discovery process
 */
export interface DiscoveryResult {
  tools: Map<string, Tool>;
  agents: Map<string, Agent>;
  resources: Map<string, Resource>;
  prompts: Map<string, Prompt>;
  workflows: Map<string, Workflow>;
  errors: Array<{ file: string; error: Error }>;
}

/**
 * Handler for discovering specific item types
 */
export interface DiscoveryHandler<T> {
  typeName: string;
  validate: (item: unknown) => item is T;
  getId: (item: T, file: string, dir: string) => string;
  register: (id: string, item: T, file: string, dir: string) => T;
  getResultMap: (result: DiscoveryResult) => Map<string, T>;
}
