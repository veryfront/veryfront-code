/**
 * Integration loader for service connectors
 *
 * Loads integrations from the integrations/ directory and handles:
 * - Integration file overlay
 * - OAuth configuration
 * - Tool auto-discovery
 * - Prompt/action loading
 */

import { createFileSystem, join } from "veryfront/fs";
import { filterVisibleIntegrations } from "../src/integrations/feature-flags.ts";
import { ALL_INTEGRATION_NAMES } from "../src/integrations/schema.ts";
import { loadTemplateFromDirectory } from "./loader.ts";
import {
  buildIntegrationDirectory,
  buildUnknownIntegrationErrors,
  mergeIntegrationFiles,
  namespaceIntegrationTemplateFiles,
  resolveIntegrationModuleDir,
} from "./integration-loader-helpers.ts";
import type {
  IntegrationConfig,
  IntegrationName,
  ResolvedIntegration,
  TemplateFile,
  UseCaseConfig,
  UseCaseName,
} from "./types.ts";

/**
 * All declared integrations. Unsupported integrations stay in the source tree,
 * but are only available when explicitly enabled with
 * VERYFRONT_EXPERIMENTAL_INTEGRATIONS.
 */
export const ALL_AVAILABLE_INTEGRATIONS: IntegrationName[] = [
  ...ALL_INTEGRATION_NAMES,
];

/**
 * Default available integrations that can be added via --integrations flag.
 * Prefer getAvailableIntegrations() when runtime feature-flag changes matter.
 */
export const AVAILABLE_INTEGRATIONS: IntegrationName[] = filterVisibleIntegrations(
  ALL_AVAILABLE_INTEGRATIONS.map((name) => ({ id: name })),
).map((integration) => integration.id as IntegrationName);

export function getAvailableIntegrations(): IntegrationName[] {
  return filterVisibleIntegrations(
    ALL_AVAILABLE_INTEGRATIONS.map((name) => ({ id: name })),
  ).map((integration) => integration.id as IntegrationName);
}

/**
 * Available use-cases that can be selected via --usecase flag
 */
export const AVAILABLE_USECASES: UseCaseName[] = [
  "productivity",
  "developer",
  "support",
  "social",
  "custom",
];

/**
 * Pre-defined use-case configurations
 */
export const USE_CASE_CONFIGS: Record<UseCaseName, UseCaseConfig> = {
  productivity: {
    name: "productivity",
    displayName: "Personal Productivity",
    description: "Email, calendar, and team communication management",
    integrations: ["gmail", "slack", "calendar"],
    defaultPrompts: ["summarize-emails", "catch-up-slack", "block-deep-work"],
    chatUI: "full-page",
    icon: "productivity",
  },
  developer: {
    name: "developer",
    displayName: "Developer Tools",
    description: "Code review, issue tracking, and team updates",
    integrations: ["github", "jira", "slack"],
    defaultPrompts: ["review-prs", "create-ticket", "update-team"],
    chatUI: "sidebar",
    icon: "code",
  },
  support: {
    name: "support",
    displayName: "Customer Support",
    description: "Ticket management, knowledge base, and escalation",
    integrations: ["servicenow", "slack", "notion"],
    defaultPrompts: ["check-ticket-status", "search-kb", "escalate-issue"],
    chatUI: "widget",
    icon: "support",
  },
  social: {
    name: "social",
    displayName: "Social Media",
    description: "Content scheduling, posting, and monitoring",
    integrations: ["slack", "notion", "calendar"],
    defaultPrompts: ["draft-content", "schedule-content", "monitor-channels"],
    chatUI: "cards",
    icon: "social",
  },
  custom: {
    name: "custom",
    displayName: "Custom",
    description: "Build your own agent with custom integrations",
    integrations: [],
    defaultPrompts: [],
    chatUI: "full-page",
    icon: "settings",
  },
};

function getModuleDir(): string {
  return resolveIntegrationModuleDir(import.meta.url);
}

/**
 * Get the directory path for an integration
 */
export function getIntegrationDirectory(integrationName: string): string {
  return buildIntegrationDirectory(getModuleDir(), integrationName);
}

/**
 * Load integration configuration from connector.json
 */
export async function loadIntegrationConfig(
  integrationName: IntegrationName,
): Promise<IntegrationConfig | null> {
  const fs = createFileSystem();
  const configPath = join(
    getIntegrationDirectory(integrationName),
    "connector.json",
  );

  try {
    const content = await fs.readTextFile(configPath);
    return JSON.parse(content) as IntegrationConfig;
  } catch {
    return null;
  }
}

/**
 * Load an integration with its files
 */
export async function loadIntegration(
  integrationName: IntegrationName,
): Promise<ResolvedIntegration | null> {
  const config = await loadIntegrationConfig(integrationName);
  if (!config) return null;

  const files = namespaceIntegrationTemplateFiles(
    integrationName,
    await loadTemplateFromDirectory(`integration:${integrationName}`),
  );

  return { config, files };
}

/**
 * Validate integration names
 */
export function validateIntegrations(integrations: IntegrationName[]): {
  valid: boolean;
  errors: string[];
} {
  const errors = buildUnknownIntegrationErrors(integrations, getAvailableIntegrations());

  return { valid: errors.length === 0, errors };
}

/**
 * Load multiple integrations and merge their files
 */
export async function loadIntegrations(
  integrationNames: IntegrationName[],
): Promise<{
  integrations: ResolvedIntegration[];
  files: TemplateFile[];
  errors: string[];
}> {
  const integrations: ResolvedIntegration[] = [];
  const errors: string[] = [];
  for (const name of integrationNames) {
    const integration = await loadIntegration(name);
    if (!integration) {
      errors.push(`Integration not found: ${name}`);
      continue;
    }

    integrations.push(integration);
  }

  return {
    integrations,
    files: mergeIntegrationFiles(integrations),
    errors,
  };
}

/**
 * Check if an integration exists
 */
export async function integrationExists(integrationName: string): Promise<boolean> {
  const fs = createFileSystem();
  const integrationDir = getIntegrationDirectory(integrationName);

  try {
    const stat = await fs.stat(integrationDir);
    return stat.isDirectory;
  } catch {
    return false;
  }
}

/**
 * Get use-case configuration
 */
export function getUseCaseConfig(useCaseName: UseCaseName): UseCaseConfig {
  return USE_CASE_CONFIGS[useCaseName];
}

/**
 * Get all available prompts for a set of integrations
 */
export async function getAvailablePrompts(
  integrationNames: IntegrationName[],
): Promise<
  Array<{
    integration: IntegrationName;
    prompts: IntegrationConfig["prompts"];
  }>
> {
  const result: Array<{
    integration: IntegrationName;
    prompts: IntegrationConfig["prompts"];
  }> = [];

  for (const name of integrationNames) {
    const config = await loadIntegrationConfig(name);
    if (!config?.prompts) continue;

    result.push({ integration: name, prompts: config.prompts });
  }

  return result;
}

/**
 * Load base files from the _base integration directory
 * These include setup guide page and status API
 */
export function loadIntegrationBaseFilesFromDirectory(): Promise<TemplateFile[]> {
  return loadTemplateFromDirectory("integration:_base");
}

/**
 * Load the _base integration config to get shared env vars like APP_URL
 */
export function loadIntegrationBaseConfig(): Promise<IntegrationConfig | null> {
  return loadIntegrationConfig("_base" as IntegrationName);
}
