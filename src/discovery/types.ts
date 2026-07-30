/**
 * Discovery Types
 *
 * Type definitions for the discovery module.
 */

import type { Agent } from "#veryfront/agent/types.ts";
import type { Prompt } from "#veryfront/prompt/types.ts";
import type { Resource } from "#veryfront/resource/types.ts";
import type { Skill } from "#veryfront/skill/types.ts";
import type { Tool } from "#veryfront/tool/types.ts";
import type { Workflow } from "#veryfront/workflow/types.ts";
import type { TaskDefinition } from "#veryfront/task/types.ts";
import type { EvalDefinition } from "#veryfront/eval/types.ts";
import type { ScheduleDefinition } from "#veryfront/schedule/types.ts";
import type { WebhookDefinition } from "#veryfront/webhook/types.ts";
import type { Platform } from "#veryfront/platform/core-platform.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import type { FileDiscoveryEntryBudget } from "#veryfront/utils/file-discovery.ts";

/**
 * Context for file discovery operations
 */
export interface FileDiscoveryContext {
  platform: Platform;
  fsAdapter?: FileSystemAdapter;
  /** Stable project or source-snapshot identity for transpiled module reuse. */
  cacheNamespace?: string;
  nodeDeps?: {
    fs: typeof import("node:fs");
    path: typeof import("node:path");
    url: typeof import("node:url");
  };
  baseDir?: string;
  /** Shared budget across every filesystem walk in one discovery generation. */
  entryBudget?: FileDiscoveryEntryBudget;
}

/**
 * Configuration for the discovery process
 */
export interface DiscoveryConfig {
  baseDir: string;
  /** Stable project or source-snapshot identity for transpiled module reuse. */
  cacheNamespace?: string;
  toolDirs?: readonly string[];
  agentDirs?: readonly string[];
  skillDirs?: readonly string[];
  resourceDirs?: readonly string[];
  promptDirs?: readonly string[];
  workflowDirs?: readonly string[];
  taskDirs?: readonly string[];
  scheduleDirs?: readonly string[];
  webhookDirs?: readonly string[];
  evalDirs?: readonly string[];
  verbose?: boolean;
  fsAdapter?: FileSystemAdapter;
}

/**
 * Result of the discovery process
 */
export type DiscoveryErrorCode =
  | "invalid_export"
  | "duplicate_id"
  | "load_error";

export interface DiscoveryError {
  file: string;
  error: Error;
  code?: DiscoveryErrorCode;
  sourceKind?: string;
  sourceId?: string;
  exportName?: string;
}

export interface DiscoveryResult {
  tools: Map<string, Tool>;
  agents: Map<string, Agent>;
  skills: Map<string, Skill>;
  resources: Map<string, Resource>;
  prompts: Map<string, Prompt>;
  workflows: Map<string, Workflow>;
  tasks: Map<string, TaskDefinition>;
  schedules: Map<string, ScheduleDefinition>;
  webhooks: Map<string, WebhookDefinition>;
  evals: Map<string, EvalDefinition>;
  errors: DiscoveryError[];
}

/**
 * Handler for discovering specific item types
 */
export interface DiscoveryHandler<TInput, TRegistered = TInput> {
  typeName: string;
  shouldDiscover?: (file: string, dir: string) => boolean;
  validate: (item: unknown) => item is TInput;
  getId: (item: TInput, file: string, dir: string) => string;
  register: (
    id: string,
    item: TInput,
    file: string,
    dir: string,
    exportName?: string,
  ) => TRegistered;
  getResultMap: (result: DiscoveryResult) => Map<string, TRegistered>;
}
