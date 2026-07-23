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

/** Controls whether discovery may reuse a previously initialized module. */
export interface DiscoveryModuleImportOptions {
  reuseInitializedModule?: boolean;
}

/** Project module loader used by one discovery generation. */
export type DiscoveryModuleImporter = (
  file: string,
  context: FileDiscoveryContext,
  options?: DiscoveryModuleImportOptions,
) => Promise<unknown>;

/**
 * Context for file discovery operations
 */
export interface FileDiscoveryContext {
  /** Runtime family used by discovery helpers. */
  platform: Platform;
  /** Optional project filesystem adapter. */
  fsAdapter?: FileSystemAdapter;
  /** Project root used for containment checks and safe diagnostics. */
  baseDir?: string;
  /** Optional isolation-owned module loader. Defaults to the local transpiler. */
  moduleImporter?: DiscoveryModuleImporter;
}

/**
 * Configuration for the discovery process
 */
export interface DiscoveryConfig {
  /** Absolute local project root, or an empty string for project-scoped virtual filesystems. */
  baseDir: string;
  /** Project-relative directories containing tool modules. */
  toolDirs?: string[];
  /** Project-relative directories containing agent definitions. */
  agentDirs?: string[];
  /** Project-relative directories containing skill definitions. */
  skillDirs?: string[];
  /** Project-relative directories containing resource modules. */
  resourceDirs?: string[];
  /** Project-relative directories containing prompt modules. */
  promptDirs?: string[];
  /** Project-relative directories containing workflow modules. */
  workflowDirs?: string[];
  /** Project-relative directories containing task modules. */
  taskDirs?: string[];
  /** Project-relative directories containing schedule modules. */
  scheduleDirs?: string[];
  /** Project-relative directories containing webhook modules. */
  webhookDirs?: string[];
  /** Project-relative directories containing eval modules. */
  evalDirs?: string[];
  /** Whether discovery emits sanitized diagnostic logs. */
  verbose?: boolean;
  /** Optional project filesystem adapter. */
  fsAdapter?: FileSystemAdapter;
  /** Optional isolation-owned module loader. Defaults to the local transpiler. */
  moduleImporter?: DiscoveryModuleImporter;
}

/** A project-relative discovery failure and its sanitized error. */
export interface DiscoveryError {
  /** Project-relative source location. */
  file: string;
  /** Failure raised while reading, compiling, validating, or registering the source. */
  error: Error;
}

/**
 * Result of the discovery process
 */
export interface DiscoveryResult {
  /** Tools published by this generation. */
  tools: Map<string, Tool>;
  /** Agents published by this generation. */
  agents: Map<string, Agent>;
  /** Skills published by this generation. */
  skills: Map<string, Skill>;
  /** Resources published by this generation. */
  resources: Map<string, Resource>;
  /** Prompts published by this generation. */
  prompts: Map<string, Prompt>;
  /** Workflows published by this generation. */
  workflows: Map<string, Workflow>;
  /** Tasks discovered in this generation. */
  tasks: Map<string, TaskDefinition>;
  /** Schedules discovered in this generation. */
  schedules: Map<string, ScheduleDefinition>;
  /** Webhooks discovered in this generation. */
  webhooks: Map<string, WebhookDefinition>;
  /** Evals discovered in this generation. */
  evals: Map<string, EvalDefinition>;
  /** Non-fatal definition failures from this generation. */
  errors: DiscoveryError[];
}

/**
 * Handler for discovering specific item types
 */
export interface DiscoveryHandler<T> {
  /** Singular concept name used in diagnostics. */
  typeName: string;
  /** Return whether an exported value is a supported definition. */
  validate: (item: unknown) => item is T;
  /** Derive the registry identifier for an exported definition. */
  getId: (item: T, file: string, dir: string) => string;
  /** Register and return the normalized definition. */
  register: (id: string, item: T, file: string, dir: string, exportName?: string) => T;
  /** Select the result map owned by this handler. */
  getResultMap: (result: DiscoveryResult) => Map<string, T>;
}
