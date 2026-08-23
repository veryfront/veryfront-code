import {
  ALREADY_EXISTS,
  createError,
  INVALID_ARGUMENT,
  NOT_SUPPORTED,
  TEMPLATE_NOT_FOUND,
  toError,
} from "veryfront/errors";
import { isNotFoundError } from "veryfront/fs";
import { cliLogger as logger } from "#cli/utils";
import { createFileSystem, type FileSystem } from "veryfront/platform";
import { join } from "veryfront/platform/path";
import { LOCKFILE_CLIENTS, NPM_FAMILY_CLIENTS } from "veryfront/utils/package-client";
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
  /** Filesystem capability used for preflight and materialization. */
  fileSystem?: FileSystem;
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

  throw INVALID_ARGUMENT.create({
    detail: "Invalid integrations specified",
    context: { integrations },
  });
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
  fs: FileSystem,
): Promise<string[]> {
  const createdPaths: string[] = [];

  for (const file of templateFiles) {
    if (file.path === ".env" || file.path === ".env.example") continue;

    const filePath = join(projectDir, file.path);
    const fileDir = join(projectDir, ...file.path.split("/").slice(0, -1));

    if (fileDir !== projectDir) await fs.mkdir(fileDir, { recursive: true });

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
  fs: FileSystem,
): Promise<string[]> {
  if (!envVars.length) return [];

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

async function writeGitignore(projectDir: string, fs: FileSystem): Promise<void> {
  if (!fs.rename) {
    throw NOT_SUPPORTED.create({
      detail: "Filesystem does not support atomic .gitignore replacement.",
    });
  }
  const gitignorePath = join(projectDir, ".gitignore");
  const temporaryPath = join(projectDir, `.gitignore.veryfront-${crypto.randomUUID()}.tmp`);
  let existingGitignore: string | undefined;
  try {
    existingGitignore = await fs.readTextFile(gitignorePath);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    existingGitignore = undefined;
  }

  try {
    await fs.writeTextFile(temporaryPath, generateGitignoreContent(existingGitignore));
    await fs.rename(temporaryPath, gitignorePath);
  } catch (error) {
    await fs.remove(temporaryPath).catch(() => {});
    throw error;
  }
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

function installerWritePaths(request: CreateProjectRequest): string[] {
  if (!request.installDependencies) return [];

  const packageManager = packageManagerPreference(request.runtime);
  const lockfiles = LOCKFILE_CLIENTS
    .filter(([, client]) => client === packageManager)
    .map(([path]) => path);
  if (packageManager === "npm") {
    lockfiles.push("npm-shrinkwrap.json", "node_modules/.package-lock.json");
  }
  return lockfiles;
}

function installerConflictPaths(request: CreateProjectRequest): string[] {
  const paths = installerWritePaths(request);
  if (
    request.installDependencies &&
    NPM_FAMILY_CLIENTS.includes(packageManagerPreference(request.runtime))
  ) {
    paths.push("node_modules");
  }
  return paths;
}

function conflictWritePaths(
  assembly: ScaffoldAssembly,
  request: CreateProjectRequest,
): string[] {
  return [...scaffoldWritePaths(assembly, request), ...installerConflictPaths(request)];
}

function protectedMergePaths(): string[] {
  return [".gitignore"];
}

function protectedLeafPaths(request: CreateProjectRequest): string[] {
  return [...protectedMergePaths(), ...installerWritePaths(request)];
}

async function findExistingPaths(
  dir: string,
  paths: string[],
  fs: FileSystem,
): Promise<string[]> {
  const existing: string[] = [];
  for (const path of paths) {
    if (await fs.exists(join(dir, path))) existing.push(path);
  }
  return existing;
}

/**
 * True when `path` is a symlink. `lstat` is what makes a link visible: `stat`
 * follows it and reports the target. Adapters without `lstat` have no links of
 * their own, so nothing can be one.
 */
async function isSymlinkPath(path: string, fs: FileSystem): Promise<boolean> {
  if (!fs.lstat) return false;
  try {
    return (await fs.lstat(path)).isSymlink === true;
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    return false; // Nothing there, so nothing to write through.
  }
}

/**
 * Paths the scaffold cannot write through, checked before anything is written.
 *
 * `findExistingPaths` resolves a whole path, so it cannot see either of these:
 *
 * - a link anywhere along the path. `app -> ../elsewhere` makes `app/page.tsx`
 *   resolve outside the project, and a dangling `README.md -> ../outside.md`
 *   resolves to nothing at all, so both are reported absent and the write then
 *   follows the link out of the project.
 * - a regular file where a directory has to go. `app/page.tsx` cannot resolve
 *   through a file named `app`, so the write stops halfway through instead.
 *
 * A real file sitting at a scaffold path is not listed here. That one resolves
 * fine and is the conflict `findExistingPaths` reports.
 */
async function findUnwritablePaths(
  dir: string,
  paths: string[],
  protectedLeafPaths: string[] = [],
  fs: FileSystem,
): Promise<string[]> {
  // `lstat` is what makes a link visible: `stat` follows it and reports the
  // target. It is optional only for virtual filesystems that have no links of
  // their own; every runtime this CLI scaffolds on provides it, and `stat`
  // still catches a plain file in the way if one ever does not.
  const describe = fs.lstat?.bind(fs) ?? fs.stat.bind(fs);
  const blocked = new Set<string>();

  for (const path of [...paths, ...protectedLeafPaths]) {
    const segments = path.split("/");
    for (let depth = 1; depth <= segments.length; depth++) {
      const prefix = segments.slice(0, depth).join("/");
      if (blocked.has(prefix)) break;
      let info: Awaited<ReturnType<typeof describe>>;
      try {
        info = await describe(join(dir, prefix));
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
        break; // Nothing there yet, so nothing below it either.
      }
      if (info.isSymlink) {
        blocked.add(prefix);
        break;
      }
      if (protectedLeafPaths.includes(prefix) && depth === segments.length && !info.isFile) {
        blocked.add(prefix);
        break;
      }
      // The last segment is the file itself, and a real file there is a
      // conflict rather than something to refuse outright.
      if (depth < segments.length && !info.isDirectory) {
        blocked.add(prefix);
        break;
      }
    }
  }

  return [...blocked].sort();
}

export async function createProject(
  request: CreateProjectRequest,
  dependencies: CreateProjectDependencies = {},
): Promise<CreateProjectResult> {
  const fs = dependencies.fileSystem ?? createFileSystem();
  const projectName = request.name;
  if (projectName !== undefined) {
    const nameError = validateProjectName(projectName);
    if (nameError) throw INVALID_ARGUMENT.create({ detail: nameError });
  }

  const projectDir = projectName === undefined
    ? request.parentDir
    : join(request.parentDir, projectName);

  validateIntegrationsOrThrow(request.integrations);

  const assembly = await assembleScaffold(request);
  const writePaths = conflictWritePaths(assembly, request);
  const where = projectName === undefined ? "Directory" : `Directory "${projectName}"`;

  // The scaffold picks this path itself by joining the name onto the parent, so
  // a link sitting there sends every write to a directory the caller never
  // named, possibly outside the parent entirely. Refuse it for the same reason
  // a link at any other scaffold path is refused. A parent directory the caller
  // passed in is their own choice, so only the derived path is checked.
  if (projectName !== undefined && await isSymlinkPath(projectDir, fs)) {
    throw ALREADY_EXISTS.create({
      detail: `${where} is a link the scaffold cannot write through. ` +
        `Move it aside or use a different name.`,
      context: { projectDir },
    });
  }

  // Checked whatever the conflict policy is: `--force` says you accept your
  // files being replaced, not the scaffold writing somewhere else entirely.
  const unwritable = await findUnwritablePaths(
    projectDir,
    writePaths,
    protectedLeafPaths(request),
    fs,
  );
  if (unwritable.length) {
    throw ALREADY_EXISTS.create({
      detail: `${where} already contains ${unwritable.join(", ")} as a file or a link ` +
        `the scaffold cannot write through. Move it aside or use a different name.`,
      context: { projectDir, unwritable },
    });
  }

  // A conflict is a file the scaffold would write over - a `package.json` with
  // the author's scripts, a `README.md` - not the directory existing. So an
  // empty directory, a fresh clone holding only `.git`, or the working
  // directory itself (the no-name case) all scaffold, and a `--force` is asked
  // for only when something would actually be replaced.
  if (request.conflictPolicy === "fail") {
    const conflicts = await findExistingPaths(projectDir, writePaths, fs);
    if (conflicts.length) {
      throw ALREADY_EXISTS.create({
        detail: `${where} already contains ${conflicts.join(", ")}. Use --force to overwrite.`,
        context: { projectDir, conflicts },
      });
    }
  }

  if (projectName !== undefined) await fs.mkdir(projectDir, { recursive: true });

  await writeGitignore(projectDir, fs);
  const createdPaths = [".gitignore"];

  createdPaths.push(...await writeScaffoldFiles(projectDir, assembly.files, fs));
  const setupTips = assembly.tips;
  const allEnvVars = assembly.envVars;

  if (request.includePackageMetadata) {
    await createPackageJson(projectDir, projectName, assembly.packageJsonOptions, fs);
    createdPaths.push("package.json");

    if (request.runtime === "deno") {
      await createDenoConfig(projectDir, fs);
      createdPaths.push("deno.json");
    }
  }

  createdPaths.push(
    ...await writeEnvFiles(projectDir, allEnvVars, request, dependencies, fs),
  );

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
    if (nameError) throw INVALID_ARGUMENT.create({ detail: nameError });
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
