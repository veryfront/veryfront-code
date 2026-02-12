/*******************************
 * Main init command implementation
 * @module
 *******************************/

import { cliLogger as logger } from "#cli/utils";
import { FILE_NOT_FOUND } from "veryfront/errors";
import { brand, dim } from "#cli/ui";
import { createSpinner } from "../../ui/progress.ts";
import { box } from "../../ui/box.ts";
import { ensureDir } from "#std/fs.ts";
import { join } from "veryfront/platform/path";
import { createPackageJson } from "./config-generator.ts";
import { createError, toError } from "veryfront/errors";
import type { InitOptions, InitTemplate } from "./types.ts";
import { cwd } from "veryfront/platform";
import { createFileSystem } from "veryfront/platform";
import {
  detectPackageManager,
  getInstallCommand,
  getRunCommand,
  installDependencies,
} from "../../utils/package-manager.ts";
import { generateGitignoreContent, promptForEnvVars } from "../../utils/env-prompt.ts";
import type { EnvVarConfig, ResolvedIntegration, TemplateFile } from "../../templates/types.ts";
import {
  loadFeature,
  mergeFiles,
  resolveFeatures,
  validateFeatures,
} from "../../templates/feature-loader.ts";
import {
  getIntegrationBaseFiles,
  loadIntegrationBaseConfig,
  loadIntegrationBaseFilesFromDirectory,
  loadIntegrations,
  validateIntegrations,
} from "../../templates/integration-loader.ts";
import { runInteractiveWizard, shouldRunWizard } from "./interactive-wizard.ts";

/**
 * Icon mapping for integrations based on category/name
 */
const INTEGRATION_ICONS: Record<string, string> = {
  gmail: "mail",
  outlook: "mail",
  slack: "slack",
  teams: "teams",
  discord: "discord",
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
  dropbox: "dropbox",
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
  hubspot: "hubspot",
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

import { tokenStore } from "../../../../lib/token-store";

// Integrations configured for this project
const INTEGRATIONS = [
${integrationEntries}
];

export async function GET(_req: Request) {
  // Get actual user ID from session in production
  const userId = "current-user";

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

/**
 * Initializes a new Veryfront project with the specified template
 */
export async function initCommand(options: InitOptions): Promise<void> {
  const { name, features = [], quiet = false } = options;
  let { integrations = [] } = options;

  function log(msg: string): void {
    if (!quiet) logger.info(msg);
  }

  let template: InitTemplate;
  let projectName = name;
  let initGit = false;

  if (shouldRunWizard(options)) {
    const wizardResult = await runInteractiveWizard();
    template = wizardResult.template;
    if (wizardResult.projectName) {
      projectName = wizardResult.projectName;
    }
    initGit = wizardResult.initGit;
  } else {
    template = options.template ?? "minimal";
  }

  const projectDir = projectName ? join(cwd(), projectName) : cwd();
  const fs = createFileSystem();

  validateOrThrow("features", features, validateFeatures);
  validateOrThrow("integrations", integrations, validateIntegrations);

  const featuresStr = features.length ? ` with features: ${features.join(", ")}` : "";
  const integrationsStr = integrations.length
    ? ` with integrations: ${integrations.join(", ")}`
    : "";

  log(
    `Creating new Veryfront project${
      projectName ? ` in ${projectName}` : ""
    } with template: ${template}${featuresStr}${integrationsStr}`,
  );

  if (projectName && (await fs.exists(projectDir))) {
    throw FILE_NOT_FOUND.create({ detail: `Directory ${projectName} already exists` });
  }

  const { getTemplate, getTemplateConfig } = await import("../../templates/index.ts");

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

  const allEnvVars: EnvVarConfig[] = templateConfig?.envVars ? [...templateConfig.envVars] : [];
  const featureTips: string[] = [];

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

      logger.debug(`Loading feature: ${featureName} (${feature.files.length} files)`);
      templateFiles = mergeFiles(templateFiles, feature.files);

      if (feature.config.envVars) allEnvVars.push(...feature.config.envVars);
      if (feature.config.tips) featureTips.push(...feature.config.tips);
    }
  }

  if (integrations.length) {
    logger.debug(`Loading integrations: ${integrations.join(", ")}`);

    templateFiles = mergeFiles(templateFiles, getIntegrationBaseFiles());
    templateFiles = mergeFiles(templateFiles, await loadIntegrationBaseFilesFromDirectory());

    const baseConfig = await loadIntegrationBaseConfig();
    if (baseConfig?.envVars) allEnvVars.push(...baseConfig.envVars);

    const {
      integrations: loadedIntegrations,
      files: integrationFiles,
      errors: integrationErrors,
    } = await loadIntegrations(integrations);

    if (integrationErrors.length) {
      for (const error of integrationErrors) logger.warn(error);
    }

    templateFiles = mergeFiles(templateFiles, integrationFiles);

    for (const integration of loadedIntegrations) {
      if (integration.config.envVars) allEnvVars.push(...integration.config.envVars);
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
  const filesSpinner = quiet ? null : createSpinner("Creating project files...");
  try {
    for (const file of templateFiles as TemplateFile[]) {
      if (file.path === ".env" || file.path === ".env.example") continue;

      const filePath = join(projectDir, file.path);
      const fileDir = join(projectDir, ...file.path.split("/").slice(0, -1));

      if (fileDir !== projectDir) await ensureDir(fileDir);

      await fs.writeTextFile(filePath, file.content);
      logger.debug(`Created file: ${file.path}`);
    }

    // Skip in quiet/TUI mode since local dev uses CDN and package.json can cause hydration issues
    if (!options.quiet) {
      await createPackageJson(projectDir, projectName);
    }

    if (allEnvVars.length) {
      const envResult = await promptForEnvVars(dedupeEnvVars(allEnvVars), {
        skipPrompt: options.skipEnvPrompt,
        prefilledValues: options.env,
      });

      await fs.writeTextFile(join(projectDir, ".env"), envResult.envContent);
      logger.debug("Created file: .env");

      await fs.writeTextFile(join(projectDir, ".env.example"), envResult.envExampleContent);
      logger.debug("Created file: .env.example");
    }

    const gitignorePath = join(projectDir, ".gitignore");
    let existingGitignore: string | undefined;
    try {
      existingGitignore = await fs.readTextFile(gitignorePath);
    } catch {
      existingGitignore = undefined;
    }

    await fs.writeTextFile(gitignorePath, generateGitignoreContent(existingGitignore));
    logger.debug("Updated file: .gitignore");

    filesSpinner?.success("Project files created");
  } catch (err) {
    filesSpinner?.error("Failed to create project files");
    throw err;
  }

  // Initialize git if requested
  if (initGit) {
    const gitSpinner = quiet ? null : createSpinner("Initializing git repository...");
    try {
      const { initializeGitRepo } = await import("../../utils/git.ts");
      const success = await initializeGitRepo(projectDir, projectName ?? "veryfront project");
      if (success) {
        gitSpinner?.success("Git repository initialized");
      } else {
        gitSpinner?.error("Git initialization failed");
      }
    } catch {
      gitSpinner?.error("Git initialization failed");
    }
  }

  (options as InitOptions & { _featureTips?: string[] })._featureTips = featureTips;

  if (!options.skipInstall) {
    const pm = await detectPackageManager(projectDir);
    const installSpinner = quiet ? null : createSpinner(`Installing dependencies with ${pm}...`);
    const installSuccess = await installDependencies(projectDir, { silent: true, packageManager: pm });

    if (installSuccess) {
      installSpinner?.success("Dependencies installed");
    } else {
      installSpinner?.error("Dependency installation failed");
      if (!quiet) {
        logger.warn(`Run '${getInstallCommand(pm)}' manually to install dependencies.`);
      }
    }
  }

  // Build success box with next steps
  const pm = await detectPackageManager(projectDir);
  const devCommand = getRunCommand(pm, "dev");

  const nextSteps: string[] = [];
  if (projectName) {
    nextSteps.push(`${dim("1.")} cd ${brand(projectName)}`);
  }
  if (options.skipInstall) {
    nextSteps.push(`${dim(projectName ? "2." : "1.")} ${brand(getInstallCommand(pm))}`);
    nextSteps.push(`${dim(projectName ? "3." : "2.")} ${brand(devCommand)}`);
  } else {
    nextSteps.push(`${dim(projectName ? "2." : "1.")} ${brand(devCommand)}`);
  }

  const successContent = [
    `${brand("✓")} Project created successfully!`,
    "",
    brand("Next steps:"),
    ...nextSteps.map((step) => `  ${step}`),
  ];

  if (template !== "minimal") {
    successContent.push(
      "",
      dim("Tips:"),
      dim("  • Add your OPENAI_API_KEY to .env"),
      dim("  • Add tools in tools/ (auto-discovered)"),
      dim("  • Add agents in agents/ (auto-discovered)"),
    );
  }

  const displayFeatureTips = (options as InitOptions & { _featureTips?: string[] })._featureTips;
  if (displayFeatureTips?.length) {
    successContent.push("", dim("Feature tips:"));
    for (const tip of displayFeatureTips) {
      successContent.push(dim(`  • ${tip}`));
    }
  }

  if (!quiet) {
    console.log("");
    console.log(box(successContent.join("\n"), { style: "rounded", padding: 1 }));
    console.log("");
  }
}
