/**
 * Main init command implementation
 * @module
 */

import { cliLogger as logger } from "@veryfront/utils";
import { FileSystemError } from "@veryfront/errors";
import { cyan, green, yellow } from "@veryfront/compat/console";
import { ensureDir } from "std/fs/mod.ts";
import { join } from "@veryfront/platform/compat/path/index.ts";
import { createPackageJson } from "./config-generator.ts";
import { createError, toError } from "@veryfront/errors/veryfront-error.ts";
import type { InitOptions, InitTemplate } from "./types.ts";
import { cwd } from "@veryfront/platform/compat/process.ts";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";
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
  const integrationEntries = integrations.map((integration) => {
    const icon = INTEGRATION_ICONS[integration.config.name] || "default";
    return `  { id: "${integration.config.name}", name: "${integration.config.displayName}", icon: "${icon}" },`;
  }).join("\n");

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

/**
 * Initializes a new Veryfront project with the specified template
 *
 * @param options - Configuration options for project initialization
 * @throws {FileSystemError} If target directory already exists
 * @throws {Error} If template not found or file operations fail
 *
 * @example
 * ```ts
 * // Create new project in current directory
 * await initCommand({ template: 'minimal' })
 *
 * // Create new project in named directory
 * await initCommand({ name: 'my-app', template: 'app' })
 *
 * // Create AI agent with integrations
 * await initCommand({ name: 'my-agent', template: 'ai', integrations: ['gmail', 'slack'] })
 * ```
 */
export async function initCommand(options: InitOptions): Promise<void> {
  const { name, features = [], quiet = false } = options;
  let { integrations = [] } = options;

  // Conditional logging helper
  const log = (msg: string) => {
    if (!quiet) logger.info(msg);
  };

  // Run interactive wizard if no template/integrations specified
  let template: InitTemplate;
  if (shouldRunWizard(options)) {
    const wizardResult = await runInteractiveWizard();
    template = wizardResult.template;
    if (wizardResult.integrations.length > 0) {
      integrations = wizardResult.integrations;
    }
  } else {
    // Determine template: explicit > default to AI (primary use case)
    if (options.template) {
      template = options.template;
    } else {
      template = "ai";
    }
  }
  const projectDir = name ? join(cwd(), name) : cwd();
  const fs = createFileSystem();

  // Validate features if provided
  if (features.length > 0) {
    const validation = validateFeatures(features);
    if (!validation.valid) {
      for (const error of validation.errors) {
        logger.error(error);
      }
      throw toError(createError({
        type: "config",
        message: "Invalid features specified",
      }));
    }
  }

  // Validate integrations if provided
  if (integrations.length > 0) {
    const validation = validateIntegrations(integrations);
    if (!validation.valid) {
      for (const error of validation.errors) {
        logger.error(error);
      }
      throw toError(createError({
        type: "config",
        message: "Invalid integrations specified",
      }));
    }
  }

  const featuresStr = features.length > 0 ? ` with features: ${features.join(", ")}` : "";
  const integrationsStr = integrations.length > 0
    ? ` with integrations: ${integrations.join(", ")}`
    : "";
  log(
    `Creating new Veryfront project${
      name ? ` in ${name}` : ""
    } with template: ${template}${featuresStr}${integrationsStr}`,
  );

  // Check if directory exists
  if (name) {
    const exists = await fs.exists(projectDir);
    if (exists) {
      throw new FileSystemError(`Directory ${name} already exists`);
    }
  }

  const { getTemplate, getTemplateConfig } = await import("../../templates/index.ts");

  let templateFiles = await getTemplate(template);
  const templateConfig = getTemplateConfig(template);

  if (!templateFiles) {
    throw toError(createError({
      type: "config",
      message: `Template ${template} not found`,
    }));
  }

  // Collect env vars from template and features
  const allEnvVars: EnvVarConfig[] = templateConfig?.envVars ? [...templateConfig.envVars] : [];
  const featureTips: string[] = [];

  // Load and merge features if provided
  if (features.length > 0) {
    const { ordered, errors } = await resolveFeatures(features);
    if (errors.length > 0) {
      for (const error of errors) {
        logger.error(error);
      }
      throw toError(createError({
        type: "config",
        message: "Failed to resolve features",
      }));
    }

    logger.debug(`Resolved feature order: ${ordered.join(" -> ")}`);

    // Load and merge each feature
    for (const featureName of ordered) {
      const feature = await loadFeature(featureName);
      if (feature) {
        logger.debug(`Loading feature: ${featureName} (${feature.files.length} files)`);
        templateFiles = mergeFiles(templateFiles, feature.files);

        // Collect feature env vars
        if (feature.config.envVars) {
          allEnvVars.push(...feature.config.envVars);
        }

        // Collect feature tips
        if (feature.config.tips) {
          featureTips.push(...feature.config.tips);
        }
      } else {
        logger.warn(`Feature ${featureName} not found, skipping`);
      }
    }
  }

  // Load and merge integrations if provided
  if (integrations.length > 0) {
    logger.debug(`Loading integrations: ${integrations.join(", ")}`);

    // Add base integration files (token store, oauth utils, shared components)
    const baseFiles = getIntegrationBaseFiles();
    templateFiles = mergeFiles(templateFiles, baseFiles);

    // Load additional base files from _base directory (setup guide, status API)
    const baseDirectoryFiles = await loadIntegrationBaseFilesFromDirectory();
    templateFiles = mergeFiles(templateFiles, baseDirectoryFiles);

    // Load base config for shared env vars (APP_URL, etc.)
    const baseConfig = await loadIntegrationBaseConfig();
    if (baseConfig?.envVars) {
      allEnvVars.push(...baseConfig.envVars);
    }

    // Load each integration
    const { integrations: loadedIntegrations, files: integrationFiles, errors: integrationErrors } =
      await loadIntegrations(integrations);

    if (integrationErrors.length > 0) {
      for (const error of integrationErrors) {
        logger.warn(error);
      }
    }

    // Merge integration files
    templateFiles = mergeFiles(templateFiles, integrationFiles);

    // Collect env vars from integrations
    for (const integration of loadedIntegrations) {
      if (integration.config.envVars) {
        allEnvVars.push(...integration.config.envVars);
      }
    }

    // Generate dynamic integrations status route based on loaded integrations
    const statusRouteContent = generateIntegrationsStatusRoute(loadedIntegrations);
    const statusRouteFile: TemplateFile = {
      path: "app/api/integrations/status/route.ts",
      content: statusRouteContent,
    };
    templateFiles = mergeFiles(templateFiles, [statusRouteFile]);

    logger.debug(
      `Loaded ${loadedIntegrations.length} integrations with ${integrationFiles.length} files`,
    );

    // Add integration setup tips
    featureTips.push(`Integrations loaded: ${integrations.join(", ")}`);
    featureTips.push("Visit /setup for guided OAuth app setup");
    featureTips.push("Connect services at /api/auth/<service>");
  }

  if (name) {
    await ensureDir(projectDir);
  }

  // Create all template files (excluding .env which we'll generate separately)
  for (const file of templateFiles as TemplateFile[]) {
    // Skip .env files - we'll generate them with prompting
    if (file.path === ".env" || file.path === ".env.example") {
      continue;
    }

    const filePath = join(projectDir, file.path);
    const fileDir = join(projectDir, ...file.path.split("/").slice(0, -1));

    if (fileDir !== projectDir) {
      await ensureDir(fileDir);
    }

    await fs.writeTextFile(filePath, file.content);
    logger.debug(`Created file: ${file.path}`);
  }

  // Create package.json with ES module support
  // Skip in quiet/TUI mode since local dev uses CDN and package.json can cause hydration issues
  if (!options.quiet) {
    await createPackageJson(projectDir, name);
  }

  // Handle environment variables from both template and features
  if (allEnvVars.length > 0) {
    // Deduplicate env vars by name (keep first occurrence)
    const seenEnvVars = new Set<string>();
    const uniqueEnvVars = allEnvVars.filter((envVar) => {
      if (seenEnvVars.has(envVar.name)) {
        return false;
      }
      seenEnvVars.add(envVar.name);
      return true;
    });

    const envResult = await promptForEnvVars(uniqueEnvVars, {
      skipPrompt: options.skipEnvPrompt,
      prefilledValues: options.env,
    });

    // Write .env file
    await fs.writeTextFile(join(projectDir, ".env"), envResult.envContent);
    logger.debug("Created file: .env");

    // Write .env.example file
    await fs.writeTextFile(join(projectDir, ".env.example"), envResult.envExampleContent);
    logger.debug("Created file: .env.example");
  }

  // Ensure .gitignore includes .env
  const gitignorePath = join(projectDir, ".gitignore");
  let existingGitignore: string | undefined;
  try {
    existingGitignore = await fs.readTextFile(gitignorePath);
  } catch {
    // File doesn't exist, that's fine
  }
  const gitignoreContent = generateGitignoreContent(existingGitignore);
  await fs.writeTextFile(gitignorePath, gitignoreContent);
  logger.debug("Updated file: .gitignore");

  // Store feature tips for later display
  (options as InitOptions & { _featureTips?: string[] })._featureTips = featureTips;

  log(`Created Veryfront project${name ? ` at ${name}` : ""}`);

  // Auto-install dependencies unless skipInstall is true
  if (!options.skipInstall) {
    log("");
    const installSuccess = await installDependencies(projectDir);

    if (!installSuccess) {
      const pm = await detectPackageManager(projectDir);
      if (!quiet) {
        logger.warn(
          `Dependency installation failed. Run '${getInstallCommand(pm)}' manually.`,
        );
      }
    }
  }

  log(`\n${cyan("Next steps:")}`);
  if (name) {
    log(`  cd ${name}`);
  }
  if (options.skipInstall) {
    const pm = await detectPackageManager(projectDir);
    log(`  ${getInstallCommand(pm)}`);
  }
  log(`  veryfront dev`);

  // Add template-specific instructions
  if (template === "blog") {
    log(`\n${cyan("Blog tips:")}`);
    log(`  - Add posts to content/posts/`);
    log(`  - Customize layout in app/layout.tsx`);
    log(`  - Configure blog settings in veryfront.config.js`);
  } else if (template === "docs") {
    log(`\n${cyan("Documentation tips:")}`);
    log(`  - Add docs to app/docs/`);
    log(`  - Update navigation in components/Sidebar.tsx`);
    log(`  - Enable search in veryfront.config.js`);
  } else if (template === "app") {
    log(`\n${cyan("App tips:")}`);
    log(`  - Default login: demo@example.com / password`);
    log(`  - Add API routes in app/api/`);
    log(`  - Configure auth in lib/auth.ts`);
  } else if (template === "ai") {
    log(`\n${cyan("AI Starter tips:")}`);
    log(`  - Add your OPENAI_API_KEY to .env`);
    log(`  - Add tools in ai/tools/ (auto-discovered)`);
    log(`  - Add agents in ai/agents/ (auto-discovered)`);
    log(`  - Add prompts in ai/prompts/ (auto-discovered)`);
  }

  // Display feature tips if any
  const displayFeatureTips = (options as InitOptions & { _featureTips?: string[] })._featureTips;
  if (displayFeatureTips && displayFeatureTips.length > 0) {
    log(`\n${cyan("Feature tips:")}`);
    for (const tip of displayFeatureTips) {
      log(`  - ${tip}`);
    }
  }
}
