import type { ParsedArgs } from "#cli/shared/types";
import { cliLogger } from "#cli/utils";
import {
  createSuccessEnvelope,
  isJsonMode,
  outputJson,
} from "../../shared/json-output.ts";
import { bold, dim } from "../../ui/colors.ts";

const ENV_OVERRIDES: Record<string, string> = {
  projectSlug: "VERYFRONT_PROJECT_SLUG",
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

  for (const name of [
    "veryfront.config.ts",
    "veryfront.config.js",
    "veryfront.json",
  ]) {
    if (await fs.exists(join(projectDir, name))) return name;
  }
  return null;
}

export function getEnvOverrides(): string[] {
  const overrides: string[] = [];
  for (const [field, envVar] of Object.entries(ENV_OVERRIDES)) {
    try {
      if (Deno.env.get(envVar)) overrides.push(`${field} (${envVar})`);
    } catch {
      // env access may fail in restricted environments
    }
  }
  return overrides;
}

export async function handleConfigCommand(_args: ParsedArgs): Promise<void> {
  const { getEnvironmentConfig } = await import("veryfront/config");
  const { cwd } = await import("veryfront/platform");
  const config = getEnvironmentConfig();

  const projectDir = cwd();
  const configSource = await detectConfigSource(projectDir);
  const envOverrides = getEnvOverrides();

  const configData = {
    projectSlug: config.projectSlug ?? null,
    nodeEnv: config.nodeEnv,
    veryfrontEnv: config.veryfrontEnv || null,
    apiBaseUrl: config.apiBaseUrl,
    debug: config.debug,
    ci: config.ci,
    hasApiToken: !!config.apiToken,
    configSource,
    envOverrides,
  };

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
  if (envOverrides.length > 0) {
    cliLogger.info(`  ${dim("Env overrides:")}  ${envOverrides.join(", ")}`);
  }
  cliLogger.info("");
}
