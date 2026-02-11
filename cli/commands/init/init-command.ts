/*******************************
 * Main init command implementation
 * @module
 *******************************/

import { cliLogger as logger } from "#cli/utils";
import { FILE_NOT_FOUND } from "veryfront/errors";
import { cyan } from "#cli/ui";
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
  if (shouldRunWizard(options)) {
    const wizardResult = await runInteractiveWizard();
    template = wizardResult.template;
    if (wizardResult.integrations.length) integrations = wizardResult.integrations;
  } else {
    template = options.template ?? "chat";
  }

  const projectDir = name ? join(cwd(), name) : cwd();
  const fs = createFileSystem();

  validateOrThrow("features", features, validateFeatures);
  validateOrThrow("integrations", integrations, validateIntegrations);

  const featuresStr = features.length ? ` with features: ${features.join(", ")}` : "";
  const integrationsStr = integrations.length
    ? ` with integrations: ${integrations.join(", ")}`
    : "";

  log(
    `Creating new Veryfront project${
      name ? ` in ${name}` : ""
    } with template: ${template}${featuresStr}${integrationsStr}`,
  );

  if (name && (await fs.exists(projectDir))) {
    throw FILE_NOT_FOUND.create({ detail: `Directory ${name} already exists` });
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

  if (name) await ensureDir(projectDir);

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
    await createPackageJson(projectDir, name);
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

  (options as InitOptions & { _featureTips?: string[] })._featureTips = featureTips;

  log(`Created Veryfront project${name ? ` at ${name}` : ""}`);

  if (!options.skipInstall) {
    log("");
    const installSuccess = await installDependencies(projectDir);

    if (!installSuccess) {
      const pm = await detectPackageManager(projectDir);
      if (!quiet) {
        logger.warn(`Dependency installation failed. Run '${getInstallCommand(pm)}' manually.`);
      }
    }
  }

  log(`\n${cyan("Next steps:")}`);
  if (name) log(`  cd ${name}`);

  if (options.skipInstall) {
    const pm = await detectPackageManager(projectDir);
    log(`  ${getInstallCommand(pm)}`);
  }

  log(`  veryfront dev`);

  if (template !== "minimal") {
    log(`\n${cyan("Tips:")}`);
    log(`  - Add your OPENAI_API_KEY to .env`);
    log(`  - Add tools in tools/ (auto-discovered)`);
    log(`  - Add agents in agents/ (auto-discovered)`);
    log(`  - Run veryfront dev to start building`);
  }

  const displayFeatureTips = (options as InitOptions & { _featureTips?: string[] })._featureTips;
  if (displayFeatureTips?.length) {
    log(`\n${cyan("Feature tips:")}`);
    for (const tip of displayFeatureTips) log(`  - ${tip}`);
  }
}
