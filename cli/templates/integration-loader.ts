/**
 * Integration loader for service connectors
 *
 * Loads integrations from the integrations/ directory and handles:
 * - Integration file overlay
 * - OAuth configuration
 * - Tool auto-discovery
 * - Prompt/action loading
 */

import { createFileSystem, isNotFoundError, join } from "veryfront/fs";
import { defineSchema } from "veryfront/schemas";
import { filterVisibleIntegrations } from "../../src/integrations/feature-flags.ts";
import {
  getIntegrationTemplateGenerationBlocker,
  isIntegrationTemplateGeneratable,
} from "../../src/integrations/generation-support.ts";
import {
  ALL_INTEGRATION_NAMES,
  getEnvVarSchema,
  IntegrationConfigSchema,
} from "../../src/integrations/schema.ts";
import { loadTemplateFromDirectory } from "./loader.ts";
import {
  generateAtlassianOAuthFiles,
  isAtlassianProductCallbackPath,
} from "./atlassian-oauth-composition.ts";
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
).map((integration) => integration.id as IntegrationName).filter(
  isIntegrationTemplateGeneratable,
);

export function getAvailableIntegrations(): IntegrationName[] {
  return filterVisibleIntegrations(
    ALL_AVAILABLE_INTEGRATIONS.map((name) => ({ id: name })),
  ).map((integration) => integration.id as IntegrationName).filter(
    isIntegrationTemplateGeneratable,
  );
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

export type IntegrationConfigLoadFailure =
  | "not-found"
  | "read"
  | "parse"
  | "validate";

/** A typed connector failure that preserves the failed stage and original cause. */
export class IntegrationConfigLoadError extends Error {
  override readonly name = "IntegrationConfigLoadError";

  constructor(
    readonly integrationName: string,
    readonly configPath: string,
    readonly failure: IntegrationConfigLoadFailure,
    options?: ErrorOptions,
  ) {
    super(
      `Failed to ${failure === "not-found" ? "find" : failure} integration config ` +
        `${integrationName} at ${configPath}`,
      options,
    );
  }
}

/** A selected connector whose manifest entry is absent must never generate partially. */
export class IntegrationTemplateLoadError extends Error {
  override readonly name = "IntegrationTemplateLoadError";

  constructor(readonly integrationName: string) {
    super(`Integration template is missing or empty: ${integrationName}`);
  }
}

const getIntegrationBaseConfigSchema = defineSchema((v) =>
  v.object({
    name: v.literal("_base"),
    displayName: v.string().min(1).max(256),
    description: v.string().min(1).max(2048),
    internal: v.literal(true),
    auth: v.object({ type: v.literal("none") }).strict(),
    envVars: v.array(getEnvVarSchema().strict()).max(100),
    tools: v.array(v.unknown()).max(0),
  }).strict()
);

type IntegrationBaseConfig = ReturnType<
  typeof getIntegrationBaseConfigSchema
>["_output"];

/**
 * Get the directory path for an integration
 */
export function getIntegrationDirectory(integrationName: string): string {
  return buildIntegrationDirectory(getModuleDir(), integrationName);
}

function parseConfigJson(
  content: string,
  integrationName: string,
  configPath: string,
): unknown {
  try {
    return JSON.parse(content);
  } catch (cause) {
    throw new IntegrationConfigLoadError(integrationName, configPath, "parse", {
      cause,
    });
  }
}

export function parseIntegrationConfig(
  content: string,
  integrationName: string,
  configPath = `${integrationName}/connector.json`,
): IntegrationConfig {
  const parsed = parseConfigJson(content, integrationName, configPath);

  let config: IntegrationConfig;
  try {
    config = IntegrationConfigSchema.parse(parsed);
  } catch (cause) {
    throw new IntegrationConfigLoadError(
      integrationName,
      configPath,
      "validate",
      { cause },
    );
  }
  if (config.name !== integrationName) {
    throw new IntegrationConfigLoadError(
      integrationName,
      configPath,
      "validate",
      {
        cause: new TypeError(
          `connector name ${JSON.stringify(config.name)} does not match ${
            JSON.stringify(integrationName)
          }`,
        ),
      },
    );
  }
  return config;
}

function parseIntegrationBaseConfig(
  content: string,
  configPath: string,
): IntegrationBaseConfig {
  const parsed = parseConfigJson(content, "_base", configPath);
  try {
    return getIntegrationBaseConfigSchema().parse(parsed);
  } catch (cause) {
    throw new IntegrationConfigLoadError(
      "_base",
      configPath,
      "validate",
      { cause },
    );
  }
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
    return parseIntegrationConfig(content, integrationName, configPath);
  } catch (cause) {
    if (cause instanceof IntegrationConfigLoadError) throw cause;
    if (isNotFoundError(cause)) return null;
    throw new IntegrationConfigLoadError(integrationName, configPath, "read", {
      cause,
    });
  }
}

/**
 * Load an integration with its files
 */
export async function loadIntegration(
  integrationName: IntegrationName,
): Promise<ResolvedIntegration | null> {
  if (!isIntegrationTemplateGeneratable(integrationName)) return null;

  const config = await loadIntegrationConfig(integrationName);
  if (!config) return null;

  const sourceFiles = await loadTemplateFromDirectory(
    `integration:${integrationName}`,
  );
  if (sourceFiles.length === 0) {
    throw new IntegrationTemplateLoadError(integrationName);
  }
  const files = namespaceIntegrationTemplateFiles(
    integrationName,
    sourceFiles,
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
  const blocked = integrations.flatMap((name) => {
    const reason = getIntegrationTemplateGenerationBlocker(name);
    return reason
      ? [
        `Integration ${name} requires a provider-specific adapter before generation: ${reason}`,
      ]
      : [];
  });
  const unblocked = integrations.filter(isIntegrationTemplateGeneratable);
  const errors = [
    ...blocked,
    ...buildUnknownIntegrationErrors(unblocked, getAvailableIntegrations()),
  ];

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
    const blocker = getIntegrationTemplateGenerationBlocker(name);
    if (blocker) {
      errors.push(
        `Integration ${name} requires a provider-specific adapter before generation: ${blocker}`,
      );
      continue;
    }
    const integration = await loadIntegration(name);
    if (!integration) {
      errors.push(`Integration not found: ${name}`);
      continue;
    }

    integrations.push(integration);
  }

  const atlassianOAuthFiles = generateAtlassianOAuthFiles(
    integrations.map((integration) => integration.config.name),
  );
  const integrationFileSets = atlassianOAuthFiles.length === 0
    ? integrations
    : integrations.map((integration) => ({
      files: integration.files.filter((file) => !isAtlassianProductCallbackPath(file.path)),
    }));

  return {
    integrations,
    files: mergeIntegrationFiles([
      ...integrationFileSets,
      ...(atlassianOAuthFiles.length > 0 ? [{ files: atlassianOAuthFiles }] : []),
    ]),
    errors,
  };
}

/**
 * Check if an integration exists
 */
export async function integrationExists(
  integrationName: string,
): Promise<boolean> {
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
export async function loadIntegrationBaseFilesFromDirectory(): Promise<
  TemplateFile[]
> {
  const files = await loadTemplateFromDirectory("integration:_base");
  if (files.length === 0) throw new IntegrationTemplateLoadError("_base");
  return files;
}

/**
 * Load the _base integration config to get shared env vars like APP_URL
 */
export async function loadIntegrationBaseConfig(): Promise<
  IntegrationBaseConfig
> {
  const fs = createFileSystem();
  const configPath = join(getIntegrationDirectory("_base"), "connector.json");

  try {
    return parseIntegrationBaseConfig(
      await fs.readTextFile(configPath),
      configPath,
    );
  } catch (cause) {
    if (cause instanceof IntegrationConfigLoadError) throw cause;
    if (isNotFoundError(cause)) {
      throw new IntegrationConfigLoadError("_base", configPath, "not-found", {
        cause,
      });
    }
    throw new IntegrationConfigLoadError("_base", configPath, "read", {
      cause,
    });
  }
}
