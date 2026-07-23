/*******************************
 * Main init command implementation
 * @module
 *******************************/

import { cliLogger as logger } from "#cli/utils";
import { brand, dim, green, red } from "#cli/ui";
import { createSpinner } from "../../ui/progress.ts";
import { box } from "../../ui/box.ts";
import { ensureDir } from "#std/fs.ts";
import { join } from "veryfront/platform/path";
import { createPackageJson } from "./config-generator.ts";
import { createDenoConfig } from "./deno-config-generator.ts";
import { createError, toError } from "veryfront/errors";
import type { InitOptions, InitRuntime, InitTemplate } from "./types.ts";
import { cwd } from "veryfront/platform";
import { createFileSystem } from "veryfront/platform";
import {
  detectPackageManager,
  getInstallCommand,
  getRunCommand,
  installDependencies,
  type PackageManager,
} from "../../utils/package-manager.ts";
import {
  generateGitignoreContent,
  promptForEnvVars,
} from "../../utils/env-prompt.ts";
import type {
  EnvVarConfig,
  ResolvedIntegration,
  TemplateFile,
} from "../../templates/types.ts";
import {
  loadFeature,
  mergeFiles,
  resolveFeatures,
  validateFeatures,
} from "../../templates/feature-loader.ts";
import {
  loadIntegrationBaseConfig,
  loadIntegrationBaseFilesFromDirectory,
  loadIntegrations,
  validateIntegrations,
} from "../../templates/integration-loader.ts";
import {
  runInteractiveWizard,
  shouldRunWizard,
  validateProjectName,
} from "./interactive-wizard.ts";

/**
 * Icon mapping for integrations based on category/name
 */
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

/**
 * Generate the integrations status route based on loaded integrations
 */
function generateIntegrationsStatusRoute(
  integrations: ResolvedIntegration[],
): string {
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
  }));
  const hasUserOAuth = definitions.some(({ connectionMode }) =>
    connectionMode === "user-oauth"
  );
  const hasEnvironmentAuth = definitions.some(
    ({ connectionMode }) => connectionMode === "environment",
  );
  const integrationEntries = definitions.map((definition) => {
    const environmentVariables = definition.requiredEnvironmentVariables.length
      ? `[
${
        definition.requiredEnvironmentVariables.map((name) =>
          `      ${JSON.stringify(name)},`
        ).join("\n")
      }
    ]`
      : "[]";
    return `  {
    id: ${JSON.stringify(definition.id)},
    name: ${JSON.stringify(definition.name)},
    icon: ${JSON.stringify(definition.icon)},
    authType: ${JSON.stringify(definition.authType)},
    connectionMode: ${JSON.stringify(definition.connectionMode)},
    requiredEnvironmentVariables: ${environmentVariables},
  },`;
  }).join("\n");
  const imports = [
    hasUserOAuth
      ? 'import { oauthTokenStore } from "../../../../lib/oauth-store.ts";'
      : "",
    'import { requireUserIdFromRequest } from "../../../../lib/user-id.ts";',
    hasEnvironmentAuth
      ? 'import { readEnvironmentVariable } from "../../../../lib/environment.ts";'
      : "",
  ].filter(Boolean).join("\n");
  const oauthTokenValidator = hasUserOAuth
    ? `function hasUsableOAuthTokens(value: unknown, now = Date.now()): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const token = value as Record<string, unknown>;
  if (
    typeof token.accessToken !== "string" || token.accessToken.length === 0 ||
    token.accessToken.length > 131072 ||
    token.accessToken.trim() !== token.accessToken
  ) return false;
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
    ? hasUsableOAuthTokens(
      await oauthTokenStore.getTokens(integration.id, userId),
    )
    : hasRequiredConfiguration(integration.requiredEnvironmentVariables);
}`
    : hasUserOAuth
    ? `async function resolveConnected(
  integration: (typeof INTEGRATIONS)[number],
  userId: string,
): Promise<boolean> {
  return hasUsableOAuthTokens(
    await oauthTokenStore.getTokens(integration.id, userId),
  );
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

function validateOrThrow<T extends string>(
  kind: "features" | "integrations",
  values: T[],
  validate: (values: T[]) => { valid: boolean; errors: string[] },
): void {
  if (!values.length) return;

  const validation = validate(values);
  if (validation.valid) return;

  for (const error of validation.errors) logger.error(error);

  throw toError(
    createError({
      type: "config",
      message: `Invalid ${kind} specified`,
    }),
  );
}

function dedupeEnvVars(envVars: EnvVarConfig[]): EnvVarConfig[] {
  const seen = new Set<string>();
  return envVars.filter(({ name }) => {
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

type StructureNode = {
  file: boolean;
  children: Map<string, StructureNode>;
};

const STRUCTURE_ORDER = [
  "app",
  "pages",
  "agents",
  "tools",
  "workflows",
  "tasks",
  "prompts",
  "resources",
  "skills",
  "components",
  "lib",
  "content",
  "AGENTS.md",
  "README.md",
  "package.json",
  "deno.json",
  "tsconfig.json",
  ".env",
  ".env.example",
  ".gitignore",
];

function structureRank(name: string): number {
  const index = STRUCTURE_ORDER.indexOf(name);
  return index === -1 ? STRUCTURE_ORDER.length : index;
}

function sortStructureEntries(
  [nameA, nodeA]: [string, StructureNode],
  [nameB, nodeB]: [
    string,
    StructureNode,
  ],
): number {
  const rankDiff = structureRank(nameA) - structureRank(nameB);
  if (rankDiff !== 0) return rankDiff;

  if (nodeA.file !== nodeB.file) return nodeA.file ? 1 : -1;
  return nameA.localeCompare(nameB);
}

function renderProjectStructure(
  rootName: string,
  paths: string[],
  maxLines = 22,
): string[] {
  const root: StructureNode = { file: false, children: new Map() };
  const normalizedPaths = [...new Set(paths)]
    .filter((path) => path && !path.endsWith("/"))
    .sort();

  for (const path of normalizedPaths) {
    const parts = path.split("/").filter(Boolean);
    let current = root;

    for (const [index, part] of parts.entries()) {
      const isFile = index === parts.length - 1;
      let child = current.children.get(part);
      if (!child) {
        child = { file: isFile, children: new Map() };
        current.children.set(part, child);
      }
      if (isFile) child.file = true;
      current = child;
    }
  }

  const lines = [`${rootName}/`];
  let omitted = 0;

  function walk(node: StructureNode, depth: number): void {
    const entries = [...node.children.entries()].sort(sortStructureEntries);

    for (const [name, child] of entries) {
      if (lines.length >= maxLines) {
        omitted++;
        continue;
      }

      lines.push(`${"  ".repeat(depth)}${name}${child.file ? "" : "/"}`);
      if (!child.file) walk(child, depth + 1);
    }
  }

  walk(root, 1);

  if (omitted > 0) {
    lines.push(
      `${"  ".repeat(1)}... ${omitted} more ${
        omitted === 1 ? "entry" : "entries"
      }`,
    );
  }

  return lines;
}

/**
 * Initializes a new Veryfront project with the specified template
 */
export async function initCommand(options: InitOptions): Promise<void> {
  const { name, features = [], quiet = false } = options;
  const { integrations = [] } = options;
  const parentDir = options.parentDir ?? cwd();

  function log(msg: string): void {
    if (!quiet) logger.info(msg);
  }

  let template: InitTemplate;
  let projectName = name;
  let initGit = false;

  // Validate project name before doing anything else
  if (name) {
    const nameError = validateProjectName(name);
    if (nameError) {
      throw toError(createError({ type: "config", message: nameError }));
    }
  }

  // Check if directory already exists before entering the wizard
  if (name && !options.force) {
    const fs = createFileSystem();
    const targetDir = join(parentDir, name);
    if (await fs.exists(targetDir)) {
      console.error(
        red(
          `Directory "${name}" already exists. Choose a different name or use --force to overwrite.`,
        ),
      );
      return;
    }
  }

  let wizardRuntime: InitRuntime = "node";
  if (shouldRunWizard(options)) {
    const wizardResult = await runInteractiveWizard(name, options.runtime);
    if (wizardResult.cancelled) {
      return;
    }
    template = wizardResult.template;
    if (wizardResult.projectName) {
      projectName = wizardResult.projectName;
    }
    initGit = wizardResult.initGit;
    wizardRuntime = wizardResult.runtime;
  } else {
    template = options.template ?? "minimal";
  }

  const runtime: InitRuntime = options.runtime ?? wizardRuntime;
  // Map runtime to package-manager preference. "node" → "npm" so an explicit
  // --runtime node always uses npm regardless of lockfiles or user agent;
  // "bun"/"deno" force the matching pm.
  const pmPreference: PackageManager = runtime === "node" ? "npm" : runtime;

  const projectDir = projectName ? join(parentDir, projectName) : parentDir;
  const fs = createFileSystem();

  validateOrThrow("features", features, validateFeatures);
  validateOrThrow("integrations", integrations, validateIntegrations);

  const featuresStr = features.length
    ? ` with features: ${features.join(", ")}`
    : "";
  const integrationsStr = integrations.length
    ? ` with integrations: ${integrations.join(", ")}`
    : "";

  log(
    `Creating new Veryfront project${
      projectName ? ` in ${projectName}` : ""
    } with template: ${template}${featuresStr}${integrationsStr}`,
  );

  if (projectName && (await fs.exists(projectDir)) && !options.force) {
    throw toError(
      createError({
        type: "config",
        message:
          `Directory "${projectName}" already exists. Choose a different name or use --force to overwrite.`,
      }),
    );
  }

  const { getAiRuleTemplate, getTemplate, getTemplateConfig } = await import(
    "../../templates/index.ts"
  );

  let templateFiles = await getTemplate(template);
  const templateConfig = getTemplateConfig(template);

  if (!templateFiles) {
    throw toError(
      createError({
        type: "config",
        message: `Template ${template} not found`,
      }),
    );
  }

  const agentsGuide = getAiRuleTemplate("agents.md");
  if (!agentsGuide) {
    throw toError(
      createError({
        type: "config",
        message: "Project agent guide template not found",
      }),
    );
  }

  if (!templateFiles.some((file) => file.path === "AGENTS.md")) {
    templateFiles = mergeFiles(templateFiles, [
      { path: "AGENTS.md", content: agentsGuide },
    ]);
  }

  const allEnvVars: EnvVarConfig[] = templateConfig?.envVars
    ? [...templateConfig.envVars]
    : [];
  const featureTips: string[] = [];
  let loadedIntegrations: ResolvedIntegration[] = [];

  if (features.length) {
    const { ordered, errors } = await resolveFeatures(features);
    if (errors.length) {
      for (const error of errors) logger.error(error);
      throw toError(
        createError({
          type: "config",
          message: "Failed to resolve features",
        }),
      );
    }

    logger.debug(`Resolved feature order: ${ordered.join(" -> ")}`);

    for (const featureName of ordered) {
      const feature = await loadFeature(featureName);
      if (!feature) {
        logger.warn(`Feature ${featureName} not found, skipping`);
        continue;
      }

      logger.debug(
        `Loading feature: ${featureName} (${feature.files.length} files)`,
      );
      templateFiles = mergeFiles(templateFiles, feature.files);

      if (feature.config.envVars) allEnvVars.push(...feature.config.envVars);
      if (feature.config.tips) featureTips.push(...feature.config.tips);
    }
  }

  if (integrations.length) {
    logger.debug(`Loading integrations: ${integrations.join(", ")}`);

    templateFiles = mergeFiles(
      templateFiles,
      await loadIntegrationBaseFilesFromDirectory(),
    );

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
      throw toError(
        createError({
          type: "config",
          message: `Failed to load selected integrations: ${
            integrationErrors.join("; ")
          }`,
        }),
      );
    }

    templateFiles = mergeFiles(templateFiles, integrationFiles);

    for (const integration of loadedIntegrations) {
      if (integration.config.envVars) {
        allEnvVars.push(...integration.config.envVars);
      }
    }

    templateFiles = mergeFiles(templateFiles, [
      {
        path: "app/api/integrations/status/route.ts",
        content: generateIntegrationsStatusRoute(loadedIntegrations),
      },
    ]);

    logger.debug(
      `Loaded ${loadedIntegrations.length} integrations with ${integrationFiles.length} files`,
    );

    featureTips.push(`Integrations loaded: ${integrations.join(", ")}`);
    featureTips.push("Visit /setup for guided OAuth app setup");
    featureTips.push("Connect services at /api/auth/<service>");
  }

  if (projectName) await ensureDir(projectDir);

  // Create project files with progress spinner
  const filesSpinner = quiet
    ? null
    : createSpinner("Creating project files...");
  const createdPaths: string[] = [];
  try {
    for (const file of templateFiles as TemplateFile[]) {
      if (file.path === ".env" || file.path === ".env.example") continue;

      const filePath = join(projectDir, file.path);
      const fileDir = join(projectDir, ...file.path.split("/").slice(0, -1));

      if (fileDir !== projectDir) await ensureDir(fileDir);

      await fs.writeTextFile(filePath, file.content);
      createdPaths.push(file.path);
      logger.debug(`Created file: ${file.path}`);
    }

    // Skip in quiet/TUI mode since local dev uses CDN and package.json can cause hydration issues
    if (!options.quiet) {
      await createPackageJson(projectDir, projectName, {
        dependencies: templateConfig?.npmDependencies,
        firstPartyExtensions: templateConfig?.firstPartyExtensions,
        integrations: loadedIntegrations.map((integration) => ({
          name: integration.config.name,
          npmDependencies: integration.config.npmDependencies,
        })),
      });
      createdPaths.push("package.json");
      if (runtime === "deno") {
        await createDenoConfig(projectDir);
        createdPaths.push("deno.json");
      }
    }

    if (allEnvVars.length) {
      const envResult = await promptForEnvVars(dedupeEnvVars(allEnvVars), {
        skipPrompt: options.skipEnvPrompt,
        prefilledValues: options.env,
      });

      await fs.writeTextFile(join(projectDir, ".env"), envResult.envContent);
      createdPaths.push(".env");
      logger.debug("Created file: .env");

      await fs.writeTextFile(
        join(projectDir, ".env.example"),
        envResult.envExampleContent,
      );
      createdPaths.push(".env.example");
      logger.debug("Created file: .env.example");
    }

    const gitignorePath = join(projectDir, ".gitignore");
    let existingGitignore: string | undefined;
    try {
      existingGitignore = await fs.readTextFile(gitignorePath);
    } catch {
      existingGitignore = undefined;
    }

    await fs.writeTextFile(
      gitignorePath,
      generateGitignoreContent(existingGitignore),
    );
    createdPaths.push(".gitignore");
    logger.debug("Updated file: .gitignore");

    filesSpinner?.success("Project files created");
  } catch (err) {
    filesSpinner?.error("Failed to create project files");
    throw err;
  }

  // Initialize git if requested
  if (initGit) {
    const gitSpinner = quiet
      ? null
      : createSpinner("Initializing git repository...");
    try {
      const { initializeGitRepo } = await import("../../utils/git.ts");
      const success = await initializeGitRepo(
        projectDir,
        projectName ?? "veryfront project",
      );
      if (success) {
        gitSpinner?.success("Git repository initialized");
      } else {
        gitSpinner?.error("Git initialization failed");
      }
    } catch {
      gitSpinner?.error("Git initialization failed");
    }
  }

  (options as InitOptions & { _featureTips?: string[] })._featureTips =
    featureTips;

  if (!options.skipInstall) {
    const pm = await detectPackageManager(projectDir, pmPreference);
    const installSpinner = quiet
      ? null
      : createSpinner(`Installing dependencies with ${pm}...`);
    const installSuccess = await installDependencies(projectDir, {
      silent: true,
      packageManager: pm,
    });

    if (installSuccess) {
      installSpinner?.success("Dependencies installed");
    } else {
      installSpinner?.error("Dependency installation failed");
      if (!quiet) {
        logger.warn(
          `Run '${getInstallCommand(pm)}' manually to install dependencies.`,
        );
      }
    }
  }

  // Deploy to cloud if --deploy flag is set
  let deployedSlug: string | undefined;
  if (options.deploy) {
    const { chdir } = await import("veryfront/platform");
    const { ensureAuthenticated, readToken } = await import(
      "../../auth/index.ts"
    );
    const { randomSuffix } = await import("#cli/shared/slug");
    const { reserveProjectSlug } = await import("#cli/shared/reserve-slug");
    const { writeProjectSlug } = await import("#cli/shared/config");
    const { pushCommand } = await import("../push/index.ts");
    const { deployCommand } = await import("../deploy/index.ts");
    const manualDeployHint = `Run ${
      brand("veryfront push --branch main")
    }, then ${
      brand("veryfront deploy --branch main --env production")
    } to deploy later.`;

    const authResult = await ensureAuthenticated();
    if (!authResult) {
      log(`\n  Authentication required for --deploy. ${manualDeployHint}`);
    } else {
      const token = await readToken();
      if (!token) {
        log(`\n  Could not read auth token. ${manualDeployHint}`);
      } else {
        const slug = `${projectName ?? "my-app"}-${randomSuffix()}`;

        log(`\n  Deploying as ${brand(slug)}...`);

        try {
          const reserveResult = await reserveProjectSlug(slug, token);
          deployedSlug = reserveResult.slug;

          await writeProjectSlug(projectDir, deployedSlug);

          chdir(projectDir);

          await pushCommand({
            projectDir,
            branch: "main",
            force: true,
            dryRun: false,
            quiet: true,
          });

          await deployCommand({
            branch: "main",
            env: "production",
            force: true,
            dryRun: false,
            quiet: true,
          });

          log(
            `  ${green("✓")} Deployed to ${
              brand(`https://${deployedSlug}.production.veryfront.com`)
            }`,
          );
        } catch (error) {
          const message = error instanceof Error
            ? error.message
            : String(error);
          log(`\n  Deploy failed: ${message}`);
          log(`  Your project was created locally. ${manualDeployHint}`);
        }
      }
    }
  }

  // Build success box with next steps
  const pm = await detectPackageManager(projectDir, pmPreference);
  const devCommand = getRunCommand(pm, "dev");

  const localSteps: string[] = [];
  if (projectName) {
    localSteps.push(`cd ${projectName}`);
  }
  if (options.skipInstall) {
    localSteps.push(getInstallCommand(pm));
  }
  localSteps.push(devCommand);

  const displayName = projectName ?? "Project";
  const structureRoot = projectName ?? ".";
  const structureLines = renderProjectStructure(structureRoot, createdPaths);
  const successContent = [
    `${green("✓")} ${displayName} ready!`,
    "",
    `${brand("Project structure")}`,
    ...structureLines,
    "",
    `${brand("Next steps")}`,
    ...localSteps,
  ];

  if (deployedSlug) {
    successContent.push(
      "",
      `${green("Live:")} https://${deployedSlug}.production.veryfront.com`,
    );
  }

  if (!deployedSlug) {
    successContent.push(
      "",
      `${brand("veryfront push --branch main")} ${dim("→ upload source")}`,
      `${brand("veryfront deploy --branch main --env production")} ${
        dim("→ create a release and go live")
      }`,
    );
  }

  if (!quiet) {
    console.log("");
    console.log(
      box(successContent.join("\n"), { style: "rounded", padding: 1 }),
    );

    const tips: string[] = [];
    if (template !== "minimal") {
      tips.push(
        `${dim("Add OPENAI_API_KEY to .env")}`,
        `${dim("Add tools in tools/, agents in agents/ (auto-discovered)")}`,
      );
    }

    const displayFeatureTips =
      (options as InitOptions & { _featureTips?: string[] })._featureTips;
    if (displayFeatureTips?.length) {
      for (const tip of displayFeatureTips) {
        tips.push(dim(tip));
      }
    }

    if (tips.length) {
      console.log("");
      for (const tip of tips) {
        console.log(`  ${tip}`);
      }
    }

    console.log("");
  }
}
