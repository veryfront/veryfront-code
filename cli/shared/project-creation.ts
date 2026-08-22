import { createError, TEMPLATE_NOT_FOUND, toError } from "veryfront/errors";
import { cliLogger as logger } from "#cli/utils";
import { createFileSystem } from "veryfront/platform";
import { join } from "veryfront/platform/path";
import { ensureDir } from "#std/fs.ts";
import { buildDenoConfig, createDenoConfig } from "../commands/init/deno-config-generator.ts";
import {
  buildPackageJson,
  createPackageJson,
  type CreatePackageJsonOptions,
  FALLBACK_PROJECT_NAME,
} from "../commands/init/config-generator.ts";
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
} from "../../templates/integration-loader.ts";
import { mergeFiles } from "../../templates/loader.ts";
import { STARTER_TEMPLATE_NAMES } from "../../templates/types.ts";
import type {
  EnvVarConfig,
  IntegrationName,
  ResolvedIntegration,
  TemplateFile,
} from "../../templates/types.ts";
import { validateProjectName } from "./project-name.ts";

export interface CreateProjectRequest {
  name?: string;
  parentDir: string;
  template: InitTemplate;
  runtime: InitRuntime;
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
  setupTips: string[];
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

function generateIntegrationsStatusRoute(integrations: ResolvedIntegration[]): string {
  const integrationEntries = integrations
    .map((integration) => {
      const icon = INTEGRATION_ICONS[integration.config.name] ?? "default";
      return `  { id: "${integration.config.name}", name: "${integration.config.displayName}", icon: "${icon}" },`;
    })
    .join("\n");

  return `/**
 * Integration Status API
 *
 * Returns the connection status of all configured integrations.
 * Used by the setup guide to show which services are connected.
 *
 * This file is auto-generated based on the integrations you selected.
 */

import { tokenStore } from "../../../../lib/token-store.ts";
import { requireUserIdFromRequest } from "../../../../lib/user-id.ts";

// Integrations configured for this project
const INTEGRATIONS = [
${integrationEntries}
];

export async function GET(req: Request): Promise<Response> {
  const userId = await requireUserIdFromRequest(req);
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const statuses = await Promise.all(
    INTEGRATIONS.map(async (integration) => {
      const connected = await tokenStore.isConnected(userId, integration.id);
      return {
        id: integration.id,
        name: integration.name,
        icon: integration.icon,
        connected,
        connectUrl: \`/api/auth/\${integration.id}\`,
      };
    }),
  );

  return Response.json({ integrations: statuses });
}
`;
}

function createConfigError(message: string): Error {
  return toError(createError({ type: "config", message }));
}

function validateIntegrationsOrThrow(integrations: IntegrationName[]): void {
  if (!integrations.length) return;

  const validation = validateIntegrations(integrations);
  if (validation.valid) return;

  for (const error of validation.errors) logger.error(error);

  throw createConfigError("Invalid integrations specified");
}

function dedupeEnvVars(envVars: EnvVarConfig[]): EnvVarConfig[] {
  const seen = new Set<string>();
  return envVars.filter(({ name }) => {
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

const MDX_EXTENSION_PACKAGE = "@veryfront/ext-content-mdx";

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
    "../../templates/index.ts"
  );

  let files = await getTemplate(template);
  const templateConfig = getTemplateConfig(template);

  if (!files) {
    throw TEMPLATE_NOT_FOUND.create({
      detail: `Unknown template "${template}". Available templates: ${
        STARTER_TEMPLATE_NAMES.join(", ")
      }`,
    });
  }

  const agentsGuide = await getAiRuleTemplate("agents.md");
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

/**
 * Declare `@veryfront/ext-content-mdx` whenever the assembled project actually
 * contains an `.mdx` file.
 *
 * The extension is an optional peer of the npm package — it drags
 * `@types/mdx`, which breaks `tsc --noEmit` for every library consumer — so a
 * project that renders MDX has to install it or those routes fail at runtime.
 *
 * The template config does not see this on its own: a starter declares the
 * extension only if its own config says so, while the need comes from the
 * assembled file set — `minimal` ships `app/about/page.mdx`, and an
 * integration scaffold can add one to any template.
 */
function withMdxExtension(
  firstPartyExtensions: string[] | undefined,
  files: TemplateFile[],
): string[] | undefined {
  if (!files.some((file) => file.path.endsWith(".mdx"))) return firstPartyExtensions;
  const existing = firstPartyExtensions ?? [];
  if (existing.includes(MDX_EXTENSION_PACKAGE)) return existing;
  return [...existing, MDX_EXTENSION_PACKAGE];
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
  if (baseConfig?.envVars) allEnvVars.push(...baseConfig.envVars);

  const {
    integrations: resolvedIntegrations,
    files: integrationFiles,
    errors: integrationErrors,
  } = await loadIntegrations(integrations);
  loadedIntegrations = resolvedIntegrations;

  if (integrationErrors.length) {
    for (const error of integrationErrors) logger.warn(error);
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

interface ScaffoldAssembly {
  /** Template and integration files, in write order. */
  files: TemplateFile[];
  envVars: EnvVarConfig[];
  tips: string[];
  packageJsonOptions: CreatePackageJsonOptions;
}

/**
 * Resolve a template into the files a new project starts with.
 *
 * The single assembly both `createProject` (which writes them to disk) and
 * {@link materializeScaffold} (which returns them) go through, so no caller
 * can drift from another.
 */
async function assembleScaffold(request: {
  template: InitTemplate;
  integrations: IntegrationName[];
}): Promise<ScaffoldAssembly> {
  const template = await loadTemplateFiles(request.template);
  const envVars = [...template.envVars];

  const integrationAssembly = await assembleIntegrationFiles(
    request.integrations,
    template.files,
    envVars,
  );

  return {
    files: integrationAssembly.files,
    envVars,
    tips: integrationAssembly.tips,
    packageJsonOptions: {
      dependencies: template.dependencies,
      firstPartyExtensions: withMdxExtension(
        template.firstPartyExtensions,
        integrationAssembly.files,
      ),
      integrations: integrationAssembly.loadedIntegrations.map((integration) => ({
        name: integration.config.name,
        npmDependencies: integration.config.npmDependencies,
      })),
    },
  };
}

/**
 * Every path `createProject` writes outright, in the order it writes them.
 *
 * `.gitignore` is absent on purpose: it is merged with whatever is already
 * there rather than replaced, so an existing one is never a conflict.
 */
function scaffoldWritePaths(assembly: ScaffoldAssembly, request: CreateProjectRequest): string[] {
  const paths = assembly.files
    .map((file) => file.path)
    .filter((path) => path !== ".env" && path !== ".env.example");
  if (request.includePackageMetadata) {
    paths.push("package.json");
    if (request.runtime === "deno") paths.push("deno.json");
  }
  if (assembly.envVars.length) paths.push(".env", ".env.example");
  return paths;
}

async function findExistingPaths(dir: string, paths: string[]): Promise<string[]> {
  const fs = createFileSystem();
  const existing: string[] = [];
  for (const path of paths) {
    if (await fs.exists(join(dir, path))) existing.push(path);
  }
  return existing;
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

  validateIntegrationsOrThrow(request.integrations);

  if (
    projectName !== undefined &&
    request.conflictPolicy === "fail" &&
    await fs.exists(projectDir)
  ) {
    throw createConfigError(`Directory "${projectName}" already exists`);
  }

  const assembly = await assembleScaffold(request);

  // A named project gets a fresh directory, checked above. Without a name the
  // scaffold lands in `parentDir` itself, which always exists, so the conflict
  // is any file the scaffold would write over - a `package.json` with the
  // author's scripts, a `README.md` - and those are refused the same way.
  if (projectName === undefined && request.conflictPolicy === "fail") {
    const conflicts = await findExistingPaths(projectDir, scaffoldWritePaths(assembly, request));
    if (conflicts.length) {
      throw createConfigError(
        `Directory already contains ${conflicts.join(", ")}. Use --force to overwrite.`,
      );
    }
  }

  if (projectName !== undefined) await ensureDir(projectDir);

  const createdPaths = await writeScaffoldFiles(projectDir, assembly.files);
  const setupTips = assembly.tips;
  const allEnvVars = assembly.envVars;

  if (request.includePackageMetadata) {
    await createPackageJson(projectDir, projectName, assembly.packageJsonOptions);
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
    setupTips,
  };
}

/**
 * Slugs other product surfaces use for a template this CLI names differently.
 *
 * Studio's "blank" project is the CLI's `minimal` starter. Mapping the two
 * vocabularies here is what lets a hosted caller materialize the same bytes
 * `veryfront init` writes instead of copying a separately maintained project.
 */
export const SCAFFOLD_TEMPLATE_ALIASES: Readonly<Record<string, InitTemplate>> = Object.freeze({
  blank: "minimal",
  "pages-router": "ai-agent",
  "app-router": "ai-agent",
});

/** Canonical starter template for a slug, or `null` when nothing matches. */
export function resolveScaffoldTemplate(slug: string): InitTemplate | null {
  const canonical = SCAFFOLD_TEMPLATE_ALIASES[slug] ?? slug;
  return (STARTER_TEMPLATE_NAMES as readonly string[]).includes(canonical)
    ? canonical as InitTemplate
    : null;
}

/** Every template slug a caller may ask for, canonical names and aliases. */
export function listScaffoldTemplates(): string[] {
  return [...STARTER_TEMPLATE_NAMES, ...Object.keys(SCAFFOLD_TEMPLATE_ALIASES)].sort();
}

/** What to build: which starter, under what name, for which runtime. */
export interface MaterializeScaffoldRequest {
  /** Canonical template name or a slug from {@link SCAFFOLD_TEMPLATE_ALIASES}. */
  template: string;
  /**
   * Written into `package.json#name`. Validated exactly as `veryfront init`
   * validates it, so neither path can produce a project the other rejects.
   */
  projectName?: string;
  runtime?: InitRuntime;
  integrations?: IntegrationName[];
  environmentValues?: Record<string, string>;
  /** Include `package.json` (and `deno.json` on the Deno runtime). */
  includePackageMetadata?: boolean;
}

/** A new project: every file it starts with, plus anything worth telling the author. */
export interface MaterializedScaffold {
  /** Canonical template the requested slug resolved to. */
  template: InitTemplate;
  /** Complete project contents, sorted by path. */
  files: TemplateFile[];
  tips: string[];
}

/**
 * Produce the complete contents of a new project without touching a disk.
 *
 * This is the artifact a hosted "create project" flow should write, so a
 * project created outside the CLI is byte-identical to one `veryfront init`
 * scaffolds from the same template. It runs the same assembly and the same
 * `package.json` / `deno.json` / `.gitignore` / `.env` generators that
 * {@link createProject} writes, so the two cannot report different files for
 * the same request.
 */
export async function materializeScaffold(
  request: MaterializeScaffoldRequest,
): Promise<MaterializedScaffold> {
  const template = resolveScaffoldTemplate(request.template);
  if (!template) {
    throw TEMPLATE_NOT_FOUND.create({
      detail: `Unknown template "${request.template}". Available templates: ${
        listScaffoldTemplates().join(", ")
      }`,
    });
  }

  if (request.projectName !== undefined) {
    const nameError = validateProjectName(request.projectName);
    if (nameError) throw createConfigError(nameError);
  }

  const integrations = request.integrations ?? [];
  validateIntegrationsOrThrow(integrations);

  const assembly = await assembleScaffold({ template, integrations });

  // Keyed by path, because the generated files below are the same files the
  // CLI writes last: whatever a template ships at those paths is merged in,
  // never emitted twice.
  const files = new Map(assembly.files.map((file) => [file.path, file.content]));
  files.delete(".env");
  files.delete(".env.example");

  if (request.includePackageMetadata !== false) {
    const shipped = files.get("package.json");
    files.set(
      "package.json",
      buildPackageJson(request.projectName ?? FALLBACK_PROJECT_NAME, {
        ...assembly.packageJsonOptions,
        existingDependencies: shipped ? JSON.parse(shipped).dependencies ?? {} : undefined,
      }),
    );
    if (request.runtime === "deno") {
      files.set("deno.json", buildDenoConfig());
    }
  }

  if (assembly.envVars.length) {
    const env = await promptForEnvVars(dedupeEnvVars(assembly.envVars), {
      skipPrompt: true,
      prefilledValues: request.environmentValues ?? {},
    });
    files.set(".env", env.envContent);
    files.set(".env.example", env.envExampleContent);
  }

  files.set(".gitignore", generateGitignoreContent(files.get(".gitignore")));

  return {
    template,
    files: [...files]
      .map(([path, content]) => ({ path, content }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    tips: assembly.tips,
  };
}
