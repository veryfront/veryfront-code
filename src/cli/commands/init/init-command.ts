
import { cliLogger as logger } from "@veryfront/utils";
import { FileSystemError } from "@veryfront/errors";
import { cyan, green, yellow } from "@veryfront/compat/console";
import { ensureDir } from "std/fs/mod.ts";
import { join } from "std/path/mod.ts";
import { createPackageJson } from "./config-generator.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";
import type { InitOptions, InitTemplate } from "./types.ts";
import { cwd } from "../../../platform/compat/process.ts";
import { createFileSystem } from "../../../platform/compat/fs.ts";
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

function generateIntegrationsStatusRoute(integrations: ResolvedIntegration[]): string {
  const integrationEntries = integrations.map((integration) => {
    const icon = INTEGRATION_ICONS[integration.config.name] || "default";
    return `  { id: "${integration.config.name}", name: "${integration.config.displayName}", icon: "${icon}" },`;
  }).join("\n");

  return `

import { tokenStore } from "../../../../lib/token-store";

const INTEGRATIONS = [
${integrationEntries}
];

export async function GET(_req: Request) {
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

export async function initCommand(options: InitOptions): Promise<void> {
  const { name, features = [] } = options;
  let { integrations = [] } = options;

  let template: InitTemplate;
  if (shouldRunWizard(options)) {
    const wizardResult = await runInteractiveWizard();
    template = wizardResult.template;
    if (wizardResult.integrations.length > 0) {
      integrations = wizardResult.integrations;
    }
  } else {
    if (options.template) {
      template = options.template;
    } else {
      template = "ai";
    }
  }
  const projectDir = name ? join(cwd(), name) : cwd();
  const fs = createFileSystem();

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
  logger.info(
    `Creating new Veryfront project${
      name ? ` in ${name}` : ""
    } with template: ${template}${featuresStr}${integrationsStr}`,
  );

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

  const allEnvVars: EnvVarConfig[] = templateConfig?.envVars ? [...templateConfig.envVars] : [];
  const featureTips: string[] = [];

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

    for (const featureName of ordered) {
      const feature = await loadFeature(featureName);
      if (feature) {
        logger.debug(`Loading feature: ${featureName} (${feature.files.length} files)`);
        templateFiles = mergeFiles(templateFiles, feature.files);

        if (feature.config.envVars) {
          allEnvVars.push(...feature.config.envVars);
        }

        if (feature.config.tips) {
          featureTips.push(...feature.config.tips);
        }
      } else {
        logger.warn(`Feature ${featureName} not found, skipping`);
      }
    }
  }

  if (integrations.length > 0) {
    logger.debug(`Loading integrations: ${integrations.join(", ")}`);

    const baseFiles = getIntegrationBaseFiles();
    templateFiles = mergeFiles(templateFiles, baseFiles);

    const baseDirectoryFiles = await loadIntegrationBaseFilesFromDirectory();
    templateFiles = mergeFiles(templateFiles, baseDirectoryFiles);

    const baseConfig = await loadIntegrationBaseConfig();
    if (baseConfig?.envVars) {
      allEnvVars.push(...baseConfig.envVars);
    }

    const { integrations: loadedIntegrations, files: integrationFiles, errors: integrationErrors } =
      await loadIntegrations(integrations);

    if (integrationErrors.length > 0) {
      for (const error of integrationErrors) {
        logger.warn(error);
      }
    }

    templateFiles = mergeFiles(templateFiles, integrationFiles);

    for (const integration of loadedIntegrations) {
      if (integration.config.envVars) {
        allEnvVars.push(...integration.config.envVars);
      }
    }

    const statusRouteContent = generateIntegrationsStatusRoute(loadedIntegrations);
    const statusRouteFile: TemplateFile = {
      path: "app/api/integrations/status/route.ts",
      content: statusRouteContent,
    };
    templateFiles = mergeFiles(templateFiles, [statusRouteFile]);

    logger.debug(
      `Loaded ${loadedIntegrations.length} integrations with ${integrationFiles.length} files`,
    );

    featureTips.push(`Integrations loaded: ${integrations.join(", ")}`);
    featureTips.push("Visit /setup for guided OAuth app setup");
    featureTips.push("Connect services at /api/auth/<service>");
  }

  if (name) {
    await ensureDir(projectDir);
  }

  for (const file of templateFiles as TemplateFile[]) {
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

  await createPackageJson(projectDir, name);

  if (allEnvVars.length > 0) {
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
  }
  const gitignoreContent = generateGitignoreContent(existingGitignore);
  await fs.writeTextFile(gitignorePath, gitignoreContent);
  logger.debug("Updated file: .gitignore");

  (options as InitOptions & { _featureTips?: string[] })._featureTips = featureTips;

  logger.info(`${green("✅")} Created Veryfront project${name ? ` at ${name}` : ""}`);

  if (!options.skipInstall) {
    logger.info("");
    const installSuccess = await installDependencies(projectDir);

    if (!installSuccess) {
      const pm = await detectPackageManager(projectDir);
      logger.warn(
        `${yellow("⚠")} Dependency installation failed. Run '${getInstallCommand(pm)}' manually.`,
      );
    }
  }

  logger.info(`\n${cyan("Next steps:")}`);
  if (name) {
    logger.info(`  cd ${name}`);
  }
  if (options.skipInstall) {
    const pm = await detectPackageManager(projectDir);
    logger.info(`  ${getInstallCommand(pm)}`);
  }
  logger.info(`  veryfront dev`);

  if (template === "blog") {
    logger.info(`\n${cyan("Blog tips:")}`);
    logger.info(`  - Add posts to content/posts/`);
    logger.info(`  - Customize layout in app/layout.tsx`);
    logger.info(`  - Configure blog settings in veryfront.config.js`);
  } else if (template === "docs") {
    logger.info(`\n${cyan("Documentation tips:")}`);
    logger.info(`  - Add docs to app/docs/`);
    logger.info(`  - Update navigation in components/Sidebar.tsx`);
    logger.info(`  - Enable search in veryfront.config.js`);
  } else if (template === "app") {
    logger.info(`\n${cyan("App tips:")}`);
    logger.info(`  - Default login: demo@example.com / password`);
    logger.info(`  - Add API routes in app/api/`);
    logger.info(`  - Configure auth in lib/auth.ts`);
  } else if (template === "ai") {
    logger.info(`\n${cyan("AI Starter tips:")}`);
    logger.info(`  - Add your OPENAI_API_KEY to .env`);
    logger.info(`  - Add tools in ai/tools/ (auto-discovered)`);
    logger.info(`  - Add agents in ai/agents/ (auto-discovered)`);
    logger.info(`  - Add prompts in ai/prompts/ (auto-discovered)`);
  }

  const displayFeatureTips = (options as InitOptions & { _featureTips?: string[] })._featureTips;
  if (displayFeatureTips && displayFeatureTips.length > 0) {
    logger.info(`\n${cyan("Feature tips:")}`);
    for (const tip of displayFeatureTips) {
      logger.info(`  - ${tip}`);
    }
  }
}
