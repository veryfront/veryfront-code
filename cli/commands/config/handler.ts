import type { ParsedArgs } from "#cli/shared/types";
import { createSuccessEnvelope, isJsonMode, outputJson } from "../../shared/json-output.ts";
import { bold, dim } from "../../ui/colors.ts";

export async function handleConfigCommand(_args: ParsedArgs): Promise<void> {
  const { getEnvironmentConfig } = await import("veryfront/config");
  const config = getEnvironmentConfig();

  const configData = {
    projectSlug: config.projectSlug ?? null,
    nodeEnv: config.nodeEnv,
    veryfrontEnv: config.veryfrontEnv,
    apiBaseUrl: config.apiBaseUrl,
    debug: config.debug,
    ci: config.ci,
    hasApiToken: !!config.apiToken,
  };

  if (isJsonMode()) {
    await outputJson(createSuccessEnvelope("config", configData));
    return;
  }

  console.log(`\n  ${bold("Project Configuration")}\n`);
  console.log(
    `  ${dim("Project slug:")}  ${configData.projectSlug ?? "(not set)"}`,
  );
  console.log(`  ${dim("Environment:")}   ${configData.nodeEnv}`);
  console.log(`  ${dim("VF Environment:")} ${configData.veryfrontEnv}`);
  console.log(`  ${dim("API endpoint:")} ${configData.apiBaseUrl}`);
  console.log(`  ${dim("Debug:")}         ${configData.debug}`);
  console.log(`  ${dim("CI:")}            ${configData.ci}`);
  console.log(
    `  ${dim("Authenticated:")} ${configData.hasApiToken ? "yes" : "no"}`,
  );
  console.log();
}
