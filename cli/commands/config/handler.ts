import type { ParsedArgs } from "#cli/shared/types";
import { cliLogger } from "#cli/utils";
import { getEnv } from "veryfront/platform";
import {
  ENVIRONMENT_PROJECT_REFERENCE_NAMES,
  resolveEnvironmentProjectReference,
} from "#cli/shared/config";
import { createSuccessEnvelope, isJsonMode, outputJson } from "../../shared/json-output.ts";
import { bold, dim } from "../../ui/colors.ts";

const ENV_OVERRIDES: Record<string, string> = {
  apiBaseUrl: "VERYFRONT_API_BASE_URL",
  apiToken: "VERYFRONT_API_TOKEN",
  nodeEnv: "NODE_ENV",
  veryfrontEnv: "VERYFRONT_ENV",
  debug: "VERYFRONT_DEBUG",
};

export async function detectConfigSource(
  projectDir: string,
): Promise<string | null> {
  const { createFileSystem } = await import("veryfront/platform");
  const { join } = await import("veryfront/platform/path");
  const fs = createFileSystem();

  for (
    const name of [
      "veryfront.config.ts",
      "veryfront.config.js",
      "veryfront.json",
    ]
  ) {
    if (await fs.exists(join(projectDir, name))) return name;
  }
  if (await fs.exists(join(projectDir, ".veryfront", "project.json"))) {
    return ".veryfront/project.json";
  }
  return null;
}

export function getEnvOverrides(): string[] {
  const overrides: string[] = [];
  for (const envVar of ENVIRONMENT_PROJECT_REFERENCE_NAMES) {
    if (getEnv(envVar)) overrides.push(`projectSlug (${envVar})`);
  }
  for (const [field, envVar] of Object.entries(ENV_OVERRIDES)) {
    if (getEnv(envVar)) overrides.push(`${field} (${envVar})`);
  }
  return overrides;
}

export type ConfigCommandData = {
  projectSlug: string | null;
  nodeEnv: string;
  veryfrontEnv: string | null;
  apiBaseUrl: string;
  debug: boolean;
  ci: boolean;
  hasApiToken: boolean;
  configSource: string | null;
  envOverrides: string[];
};

export async function getConfigCommandData(projectDir: string): Promise<ConfigCommandData> {
  const { getEnvironmentConfig } = await import("veryfront/config");
  const config = getEnvironmentConfig();
  const { readConfigFile } = await import("#cli/shared/config");
  const { resolveCliApiUrl } = await import("../../shared/constants.ts");
  const {
    PROJECT_LINK_RELATIVE_PATH,
    readProjectLinkForControlPlane,
  } = await import("../../shared/project-link.ts");

  const detectedConfigSource = await detectConfigSource(projectDir);
  const envOverrides = getEnvOverrides();
  const fileConfig = await readConfigFile(projectDir);
  const environmentProjectReference = resolveEnvironmentProjectReference()?.reference;
  const linkedProjectSlug = !config.projectSlug && !fileConfig?.projectSlug &&
      !environmentProjectReference
    ? (await readProjectLinkForControlPlane(
      projectDir,
      resolveCliApiUrl(config, fileConfig?.apiUrl),
    ))?.projectSlug
    : undefined;

  return {
    projectSlug: config.projectSlug ?? fileConfig?.projectSlug ?? environmentProjectReference ??
      linkedProjectSlug ?? null,
    nodeEnv: config.nodeEnv,
    veryfrontEnv: config.veryfrontEnv || null,
    apiBaseUrl: config.apiBaseUrl,
    debug: config.debug,
    ci: config.ci,
    hasApiToken: !!(config.apiToken ?? fileConfig?.apiToken),
    configSource: linkedProjectSlug
      ? PROJECT_LINK_RELATIVE_PATH
      : detectedConfigSource === ".veryfront/project.json"
      ? null
      : detectedConfigSource,
    envOverrides,
  };
}

export async function handleConfigCommand(_args: ParsedArgs): Promise<void> {
  const { cwd } = await import("veryfront/platform");

  const configData = await getConfigCommandData(cwd());

  if (isJsonMode()) {
    await outputJson(createSuccessEnvelope("config", configData));
    return;
  }

  cliLogger.info(`\n  ${bold("Project Configuration")}\n`);
  cliLogger.info(
    `  ${dim("Project slug:")}  ${configData.projectSlug ?? "(not set)"}`,
  );
  cliLogger.info(`  ${dim("Environment:")}   ${configData.nodeEnv}`);
  cliLogger.info(
    `  ${dim("VF Environment:")} ${configData.veryfrontEnv ?? "(not set)"}`,
  );
  cliLogger.info(`  ${dim("API endpoint:")}  ${configData.apiBaseUrl}`);
  cliLogger.info(`  ${dim("Debug:")}         ${configData.debug}`);
  cliLogger.info(`  ${dim("CI:")}            ${configData.ci}`);
  cliLogger.info(
    `  ${dim("Authenticated:")} ${configData.hasApiToken ? "yes" : "no"}`,
  );
  cliLogger.info(
    `  ${dim("Config file:")}   ${configData.configSource ?? "(none)"}`,
  );
  if (configData.envOverrides.length > 0) {
    cliLogger.info(`  ${dim("Env overrides:")}  ${configData.envOverrides.join(", ")}`);
  }
  cliLogger.info("");
}
