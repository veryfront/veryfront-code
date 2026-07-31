import { createError, toError } from "veryfront/errors";
import { cliLogger as logger } from "#cli/utils";
import { createFileSystem } from "veryfront/platform";
import { join } from "veryfront/platform/path";
import { ensureDir } from "#std/fs.ts";
import { createDenoConfig } from "../commands/init/deno-config-generator.ts";
import { createPackageJson } from "../commands/init/config-generator.ts";
import type { InitRuntime, InitTemplate } from "../commands/init/types.ts";
import {
  type EnvPromptResult,
  generateGitignoreContent,
  promptForEnvVars,
} from "../utils/env-prompt.ts";
import {
  detectPackageManager,
  installDependencies,
  type PackageManager,
} from "../utils/package-manager.ts";
import {
  loadIntegrationBaseConfig,
  loadIntegrationBaseFilesFromDirectory,
  loadIntegrations,
  validateIntegrations,
} from "../templates/integration-loader.ts";
import {
  loadFeature,
  mergeFiles,
  resolveFeatures,
  validateFeatures,
} from "../templates/feature-loader.ts";
import {
  getAtlassianOAuthScopes,
  getUnselectedAtlassianOAuthScopes,
} from "../templates/atlassian-oauth-composition.ts";
import type {
  EnvVarConfig,
  FeatureName,
  IntegrationName,
  ResolvedIntegration,
  TemplateFile,
} from "../templates/types.ts";
import { validateProjectName } from "./project-name.ts";

export interface CreateProjectRequest {
  name?: string;
  parentDir: string;
  template: InitTemplate;
  runtime: InitRuntime;
  features: FeatureName[];
  integrations: IntegrationName[];
  environmentValues: Record<string, string>;
  conflictPolicy: "fail" | "overwrite";
  installDependencies: boolean;
  initializeGit: boolean;
  includePackageMetadata: boolean;
}

export interface CreateProjectResult {
  projectDir: string;
  projectName?: string;
  createdPaths: string[];
  packageManager: PackageManager;
  dependencyInstallation: "installed" | "failed" | "skipped";
  gitInitialization: "initialized" | "failed" | "skipped";
  featureTips: string[];
}

export type ProjectCreationEvent =
  | { kind: "dependency-installation-started"; packageManager: PackageManager }
  | {
    kind: "dependency-installation-finished";
    packageManager: PackageManager;
    status: "installed" | "failed";
  };

export interface ProjectCreationObserver {
  onEvent(event: ProjectCreationEvent): void | Promise<void>;
}

export interface CreateProjectDependencies {
  observer?: ProjectCreationObserver;
  resolveEnvironmentFiles?: (
    variables: EnvVarConfig[],
    values: Record<string, string>,
  ) => Promise<Pick<EnvPromptResult, "envContent" | "envExampleContent">>;
}

const INTEGRATION_ICONS: Record<string, string> = {
  gmail: "mail",
  outlook: "mail",
  slack: "slack",
  teams: "teams",
  calendar: "calendar",
  github: "github",
  gitlab: "gitlab",
  bitbucket: "bitbucket",
  jira: "jira",
  confluence: "confluence",
  notion: "notion",
  linear: "linear",
  asana: "asana",
  trello: "trello",
  monday: "monday",
  clickup: "clickup",
  figma: "figma",
  drive: "drive",
  onedrive: "onedrive",
  sharepoint: "sharepoint",
  box: "box",
  sheets: "sheets",
  airtable: "airtable",
  supabase: "database",
  neon: "database",
  snowflake: "database",
  salesforce: "salesforce",
  pipedrive: "pipedrive",
  zendesk: "zendesk",
  intercom: "intercom",
  freshdesk: "freshdesk",
  servicenow: "servicenow",
  stripe: "stripe",
  quickbooks: "quickbooks",
  xero: "xero",
  shopify: "shopify",
  mailchimp: "mailchimp",
  twitter: "twitter",
  zoom: "zoom",
  webex: "webex",
  twilio: "twilio",
  sentry: "sentry",
  posthog: "posthog",
  mixpanel: "mixpanel",
  anthropic: "ai",
  aws: "cloud",
};

function generateIntegrationsStatusRoute(
  integrations: ResolvedIntegration[],
): string {
  const atlassianOAuthScopes = getAtlassianOAuthScopes(
    integrations.map(({ config }) => config.name),
  );
  const unselectedAtlassianOAuthScopes = getUnselectedAtlassianOAuthScopes(
    integrations.map(({ config }) => config.name),
  );
  const definitions = integrations.map(({ config }) => ({
    id: config.name,
    name: config.displayName,
    icon: INTEGRATION_ICONS[config.name] ?? "default",
    authType: config.auth.type,
    connectionMode: config.auth.type === "oauth2" &&
        config.auth.grantType !== "client_credentials"
      ? "user-oauth"
      : "environment",
    requiredEnvironmentVariables: (config.envVars ?? [])
      .filter(({ required }) => required)
      .map(({ name }) => name),
    requiredOAuthScopes: config.name === "jira" || config.name === "confluence"
      ? atlassianOAuthScopes
      : [],
    forbiddenOAuthScopes: config.name === "jira" || config.name === "confluence"
      ? unselectedAtlassianOAuthScopes
      : [],
    atlassianService: config.name === "jira" || config.name === "confluence" ? config.name : null,
  }));
  const hasUserOAuth = definitions.some(({ connectionMode }) => connectionMode === "user-oauth");
  const hasAtlassianOAuth = definitions.some(({ atlassianService }) => atlassianService !== null);
  const hasEnvironmentAuth = definitions.some(
    ({ connectionMode }) => connectionMode === "environment",
  );
  const integrationEntries = definitions.map((definition) => {
    const environmentVariables = definition.requiredEnvironmentVariables.length
      ? `[
${
        definition.requiredEnvironmentVariables.map((name) => `      ${JSON.stringify(name)},`)
          .join("\n")
      }
    ]`
      : "[]";
    const requiredOAuthScopes = definition.requiredOAuthScopes.length
      ? `[
${definition.requiredOAuthScopes.map((scope) => `      ${JSON.stringify(scope)},`).join("\n")}
    ]`
      : "[]";
    const forbiddenOAuthScopes = definition.forbiddenOAuthScopes.length
      ? `[
${definition.forbiddenOAuthScopes.map((scope) => `      ${JSON.stringify(scope)},`).join("\n")}
    ]`
      : "[]";
    return `  {
    id: ${JSON.stringify(definition.id)},
    name: ${JSON.stringify(definition.name)},
    icon: ${JSON.stringify(definition.icon)},
    authType: ${JSON.stringify(definition.authType)},
    connectionMode: ${JSON.stringify(definition.connectionMode)},
    requiredEnvironmentVariables: ${environmentVariables},
    requiredOAuthScopes: ${requiredOAuthScopes},
    forbiddenOAuthScopes: ${forbiddenOAuthScopes},
    atlassianService: ${JSON.stringify(definition.atlassianService)},
  },`;
  }).join("\n");
  const imports = [
    hasUserOAuth ? 'import { oauthTokenStore } from "../../../../lib/oauth-store.ts";' : "",
    hasUserOAuth
      ? 'import { satisfiesOAuthScopePolicy } from "../../../../lib/oauth-scope-utils.ts";'
      : "",
    hasAtlassianOAuth
      ? 'import { resolveAtlassianCloudId } from "../../../../lib/atlassian-cloud.ts";'
      : "",
    'import { requireUserIdFromRequest } from "../../../../lib/user-id.ts";',
    hasEnvironmentAuth
      ? 'import { readEnvironmentVariable } from "../../../../lib/environment.ts";'
      : "",
  ].filter(Boolean).join("\n");
  const oauthTokenValidator = hasUserOAuth
    ? `function hasUsableOAuthTokens(
  value: unknown,
  requiredScopes: readonly string[],
  forbiddenScopes: readonly string[],
  now = Date.now(),
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const token = value as Record<string, unknown>;
  if (
    typeof token.accessToken !== "string" || token.accessToken.length === 0 ||
    token.accessToken.length > 131072 ||
    token.accessToken.trim() !== token.accessToken
  ) return false;
  if (!satisfiesOAuthScopePolicy(token.scope, requiredScopes, forbiddenScopes)) return false;
  const hasRefreshToken = typeof token.refreshToken === "string" &&
    token.refreshToken.length > 0 && token.refreshToken.length <= 131072 &&
    token.refreshToken.trim() === token.refreshToken;
  if (token.refreshToken !== undefined && !hasRefreshToken) return false;
  if (token.expiresAt === undefined) return true;
  if (
    typeof token.expiresAt !== "number" ||
    !Number.isSafeInteger(token.expiresAt) ||
    token.expiresAt < 0
  ) return false;
  return token.expiresAt > now || hasRefreshToken;
}`
    : "";
  const integrationOAuthValidator = hasUserOAuth
    ? `async function hasUsableIntegrationOAuth(
  integration: (typeof INTEGRATIONS)[number],
  userId: string,
): Promise<boolean> {
  const usableTokens = hasUsableOAuthTokens(
    await oauthTokenStore.getTokens(integration.id, userId),
    integration.requiredOAuthScopes,
    integration.forbiddenOAuthScopes,
  );
  if (!usableTokens) return false;
${
      hasAtlassianOAuth
        ? `  if (integration.atlassianService !== null) {
    try {
      await resolveAtlassianCloudId(userId, integration.atlassianService, {
        requiredScopes: integration.requiredOAuthScopes,
        forbiddenScopes: integration.forbiddenOAuthScopes,
      });
    } catch {
      return false;
    }
  }
`
        : ""
    }  return true;
}`
    : "";
  const environmentValidator = hasEnvironmentAuth
    ? `function hasRequiredConfiguration(names: readonly string[]): boolean {
  return names.length > 0 && names.every((name) => {
    const value = readEnvironmentVariable(name);
    return typeof value === "string" && value.trim().length > 0;
  });
}`
    : "";
  const connectionResolver = hasUserOAuth && hasEnvironmentAuth
    ? `async function resolveConnected(
  integration: (typeof INTEGRATIONS)[number],
  userId: string,
): Promise<boolean> {
  return integration.connectionMode === "user-oauth"
    ? hasUsableIntegrationOAuth(integration, userId)
    : hasRequiredConfiguration(integration.requiredEnvironmentVariables);
}`
    : hasUserOAuth
    ? `async function resolveConnected(
  integration: (typeof INTEGRATIONS)[number],
  userId: string,
): Promise<boolean> {
  return hasUsableIntegrationOAuth(integration, userId);
}`
    : `function resolveConnected(
  integration: (typeof INTEGRATIONS)[number],
  _userId: string,
): Promise<boolean> {
  return Promise.resolve(
    hasRequiredConfiguration(integration.requiredEnvironmentVariables),
  );
}`;
  const helperDefinitions = [
    oauthTokenValidator,
    integrationOAuthValidator,
    environmentValidator,
    connectionResolver,
  ].filter(Boolean).join("\n\n");

  return `/**
 * Integration Status API
 *
 * Returns the connection status of all configured integrations.
 * Used by the setup guide to show which services are connected.
 *
 * This file is auto-generated based on the integrations you selected.
 */

${imports}

// Integrations configured for this project
const INTEGRATIONS = [
${integrationEntries}
] as const;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

${helperDefinitions}

export async function GET(req: Request): Promise<Response> {
  const userId = await requireUserIdFromRequest(req);
  if (!userId) return jsonResponse({ error: "Unauthorized" }, 401);

  try {
    const integrations = await Promise.all(
      INTEGRATIONS.map(async (integration) => {
        const { id, name, icon, authType, connectionMode } = integration;
        const connected = await resolveConnected(integration, userId);
        const isUserOAuth = String(connectionMode) === "user-oauth";

        return {
          id,
          name,
          icon,
          authType,
          connected,
          connectionState: connected
            ? (isUserOAuth ? "connected" : "configured")
            : (isUserOAuth ? "disconnected" : "configuration-required"),
          connectUrl: isUserOAuth ? \`/api/auth/\${id}\` : null,
        };
      }),
    );

    return jsonResponse({ integrations });
  } catch {
    return jsonResponse({
      error: "Integration status is temporarily unavailable",
    }, 503);
  }
}
`;
}

function createConfigError(message: string): Error {
  return toError(createError({ type: "config", message }));
}

function validateOrThrow<T extends string>(
  kind: "features" | "integrations",
  values: T[],
  validate: (values: T[]) => { valid: boolean; errors: string[] },
): void {
  if (!values.length) return;

  const validation = validate(values);
  if (validation.valid) return;

  for (const error of validation.errors) logger.error(error);

  throw createConfigError(`Invalid ${kind} specified`);
}

function dedupeEnvVars(envVars: EnvVarConfig[]): EnvVarConfig[] {
  const seen = new Set<string>();
  return envVars.filter(({ name }) => {
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

async function loadTemplateFiles(
  template: InitTemplate,
): Promise<
  {
    files: TemplateFile[];
    envVars: EnvVarConfig[];
    dependencies?: Record<string, string>;
    firstPartyExtensions?: string[];
  }
> {
  const { getAiRuleTemplate, getTemplate, getTemplateConfig } = await import(
    "../templates/index.ts"
  );

  let files = await getTemplate(template);
  const templateConfig = getTemplateConfig(template);

  if (!files) throw createConfigError(`Template ${template} not found`);

  const agentsGuide = getAiRuleTemplate("agents.md");
  if (!agentsGuide) throw createConfigError("Project agent guide template not found");

  if (!files.some((file) => file.path === "AGENTS.md")) {
    files = mergeFiles(files, [{ path: "AGENTS.md", content: agentsGuide }]);
  }

  return {
    files,
    envVars: templateConfig?.envVars ? [...templateConfig.envVars] : [],
    dependencies: templateConfig?.npmDependencies,
    firstPartyExtensions: templateConfig?.firstPartyExtensions,
  };
}

async function assembleFeatureFiles(
  features: FeatureName[],
  templateFiles: TemplateFile[],
  allEnvVars: EnvVarConfig[],
): Promise<{ files: TemplateFile[]; tips: string[] }> {
  let files = templateFiles;
  const tips: string[] = [];
  if (!features.length) return { files, tips };

  const { ordered, errors } = await resolveFeatures(features);
  if (errors.length) {
    for (const error of errors) logger.error(error);
    throw createConfigError("Failed to resolve features");
  }

  logger.debug(`Resolved feature order: ${ordered.join(" -> ")}`);

  for (const featureName of ordered) {
    const feature = await loadFeature(featureName);
    if (!feature) {
      logger.warn(`Feature ${featureName} not found, skipping`);
      continue;
    }

    logger.debug(`Loading feature: ${featureName} (${feature.files.length} files)`);

    files = mergeFiles(files, feature.files);
    if (feature.config.envVars) allEnvVars.push(...feature.config.envVars);
    if (feature.config.tips) tips.push(...feature.config.tips);
  }

  return { files, tips };
}

async function assembleIntegrationFiles(
  integrations: IntegrationName[],
  templateFiles: TemplateFile[],
  allEnvVars: EnvVarConfig[],
): Promise<{ files: TemplateFile[]; loadedIntegrations: ResolvedIntegration[]; tips: string[] }> {
  let files = templateFiles;
  const tips: string[] = [];
  let loadedIntegrations: ResolvedIntegration[] = [];

  if (!integrations.length) return { files, loadedIntegrations, tips };

  logger.debug(`Loading integrations: ${integrations.join(", ")}`);

  files = mergeFiles(files, await loadIntegrationBaseFilesFromDirectory());

  const baseConfig = await loadIntegrationBaseConfig();
  if (baseConfig.envVars) allEnvVars.push(...baseConfig.envVars);

  const {
    integrations: resolvedIntegrations,
    files: integrationFiles,
    errors: integrationErrors,
  } = await loadIntegrations(integrations);
  loadedIntegrations = resolvedIntegrations;

  if (integrationErrors.length) {
    for (const error of integrationErrors) logger.error(error);
    throw createConfigError(
      `Failed to load selected integrations: ${integrationErrors.join("; ")}`,
    );
  }

  files = mergeFiles(files, integrationFiles);

  for (const integration of loadedIntegrations) {
    if (integration.config.envVars) allEnvVars.push(...integration.config.envVars);
  }

  files = mergeFiles(files, [
    {
      path: "app/api/integrations/status/route.ts",
      content: generateIntegrationsStatusRoute(loadedIntegrations),
    },
  ]);

  logger.debug(
    `Loaded ${loadedIntegrations.length} integrations with ${integrationFiles.length} files`,
  );

  tips.push(`Integrations loaded: ${integrations.join(", ")}`);
  tips.push("Visit /setup for guided OAuth app setup");
  tips.push("Connect services at /api/auth/<service>");

  return { files, loadedIntegrations, tips };
}

async function writeScaffoldFiles(
  projectDir: string,
  templateFiles: TemplateFile[],
): Promise<string[]> {
  const fs = createFileSystem();
  const createdPaths: string[] = [];

  for (const file of templateFiles) {
    if (file.path === ".env" || file.path === ".env.example") continue;

    const filePath = join(projectDir, file.path);
    const fileDir = join(projectDir, ...file.path.split("/").slice(0, -1));

    if (fileDir !== projectDir) await ensureDir(fileDir);

    await fs.writeTextFile(filePath, file.content);
    createdPaths.push(file.path);
    logger.debug(`Created file: ${file.path}`);
  }

  return createdPaths;
}

async function writeEnvFiles(
  projectDir: string,
  envVars: EnvVarConfig[],
  request: CreateProjectRequest,
  dependencies: CreateProjectDependencies,
): Promise<string[]> {
  if (!envVars.length) return [];

  const fs = createFileSystem();
  const resolveEnvironmentFiles = dependencies.resolveEnvironmentFiles ??
    ((variables, values) =>
      promptForEnvVars(variables, {
        skipPrompt: true,
        prefilledValues: values,
      }));

  const envResult = await resolveEnvironmentFiles(
    dedupeEnvVars(envVars),
    request.environmentValues,
  );

  await fs.writeTextFile(join(projectDir, ".env"), envResult.envContent);
  logger.debug("Created file: .env");
  await fs.writeTextFile(join(projectDir, ".env.example"), envResult.envExampleContent);
  logger.debug("Created file: .env.example");
  return [".env", ".env.example"];
}

async function writeGitignore(projectDir: string): Promise<void> {
  const fs = createFileSystem();
  const gitignorePath = join(projectDir, ".gitignore");
  let existingGitignore: string | undefined;
  try {
    existingGitignore = await fs.readTextFile(gitignorePath);
  } catch {
    existingGitignore = undefined;
  }

  await fs.writeTextFile(gitignorePath, generateGitignoreContent(existingGitignore));
  logger.debug("Updated file: .gitignore");
}

function packageManagerPreference(runtime: InitRuntime): PackageManager {
  return runtime === "node" ? "npm" : runtime;
}

async function initializeGit(
  projectDir: string,
  projectName: string | undefined,
  enabled: boolean,
): Promise<CreateProjectResult["gitInitialization"]> {
  if (!enabled) return "skipped";

  try {
    const { initializeGitRepo } = await import("../utils/git.ts");
    return await initializeGitRepo(projectDir, projectName ?? "veryfront project")
      ? "initialized"
      : "failed";
  } catch {
    return "failed";
  }
}

async function installProjectDependencies(
  projectDir: string,
  packageManager: PackageManager,
  enabled: boolean,
  observer: ProjectCreationObserver | undefined,
): Promise<CreateProjectResult["dependencyInstallation"]> {
  if (!enabled) return "skipped";

  await observer?.onEvent({
    kind: "dependency-installation-started",
    packageManager,
  });
  const installed = await installDependencies(projectDir, {
    silent: true,
    packageManager,
  });
  const status = installed ? "installed" : "failed";
  await observer?.onEvent({
    kind: "dependency-installation-finished",
    packageManager,
    status,
  });
  return status;
}

export async function createProject(
  request: CreateProjectRequest,
  dependencies: CreateProjectDependencies = {},
): Promise<CreateProjectResult> {
  const projectName = request.name;
  if (projectName !== undefined) {
    const nameError = validateProjectName(projectName);
    if (nameError) throw createConfigError(nameError);
  }

  const projectDir = projectName === undefined
    ? request.parentDir
    : join(request.parentDir, projectName);
  const fs = createFileSystem();

  validateOrThrow("features", request.features, validateFeatures);
  validateOrThrow("integrations", request.integrations, validateIntegrations);

  if (
    projectName !== undefined &&
    request.conflictPolicy === "fail" &&
    await fs.exists(projectDir)
  ) {
    throw createConfigError(`Directory "${projectName}" already exists`);
  }

  const template = await loadTemplateFiles(request.template);
  const allEnvVars = [...template.envVars];

  const featureAssembly = await assembleFeatureFiles(
    request.features,
    template.files,
    allEnvVars,
  );
  const integrationAssembly = await assembleIntegrationFiles(
    request.integrations,
    featureAssembly.files,
    allEnvVars,
  );

  if (projectName !== undefined) await ensureDir(projectDir);

  const createdPaths = await writeScaffoldFiles(projectDir, integrationAssembly.files);
  const featureTips = [...featureAssembly.tips, ...integrationAssembly.tips];

  if (request.includePackageMetadata) {
    await createPackageJson(projectDir, projectName, {
      dependencies: template.dependencies,
      firstPartyExtensions: template.firstPartyExtensions,
      integrations: integrationAssembly.loadedIntegrations.map((integration) => ({
        name: integration.config.name,
        npmDependencies: integration.config.npmDependencies,
      })),
    });
    createdPaths.push("package.json");

    if (request.runtime === "deno") {
      await createDenoConfig(projectDir);
      createdPaths.push("deno.json");
    }
  }

  createdPaths.push(
    ...await writeEnvFiles(projectDir, allEnvVars, request, dependencies),
  );

  await writeGitignore(projectDir);
  createdPaths.push(".gitignore");

  const packageManager = await detectPackageManager(
    projectDir,
    packageManagerPreference(request.runtime),
  );
  const dependencyInstallation = await installProjectDependencies(
    projectDir,
    packageManager,
    request.installDependencies,
    dependencies.observer,
  );
  const gitInitialization = await initializeGit(
    projectDir,
    projectName,
    request.initializeGit,
  );

  return {
    projectDir,
    projectName,
    createdPaths,
    packageManager,
    dependencyInstallation,
    gitInitialization,
    featureTips,
  };
}
