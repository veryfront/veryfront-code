import type { DiagnosticResult } from "./types.ts";
import { exists } from "#std/fs.ts";
import { join } from "veryfront/platform/path";
import type { VeryfrontConfig } from "veryfront/config";
import { createProjectDiscoveryConfig } from "veryfront/discovery";
import { getEnv } from "veryfront/platform";
import { loadConfigOrNull } from "./project-config.ts";

/** Discovery buckets that make a project's AI surface visible to the runtime. */
const AI_SURFACE_KEYS = ["agentDirs", "toolDirs", "workflowDirs", "skillDirs"] as const;

/**
 * Environment variables the built-in providers read their credentials from,
 * mirroring `autoInitializeFromEnv` in `src/provider/model-registry.ts`.
 * Anything else follows the documented `<PROVIDER>_API_KEY` convention.
 */
const PROVIDER_ENV_KEYS: Record<string, readonly string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
};

function providerEnvKeys(name: string): readonly string[] {
  return PROVIDER_ENV_KEYS[name.toLowerCase()] ?? [`${name.toUpperCase()}_API_KEY`];
}

/** The env var actually holding this provider's credential, if any. */
function findProviderEnvKey(name: string): string | undefined {
  return providerEnvKeys(name).find((key) => (getEnv(key) ?? "").trim() !== "");
}

/**
 * Lists the AI directories the runtime would actually discover, so doctor
 * reports what the project ships instead of a config flag nothing reads.
 */
async function findAISurfaces(
  projectDir: string,
  config: VeryfrontConfig,
): Promise<string[]> {
  const discovery = createProjectDiscoveryConfig({ projectDir, config });
  const surfaces: string[] = [];

  for (const key of AI_SURFACE_KEYS) {
    for (const dir of discovery[key]) {
      if (await exists(join(projectDir, dir))) {
        surfaces.push(`${dir}/`);
        break;
      }
    }
  }

  return surfaces;
}

/**
 * Check AI Configuration and API Keys
 */
export async function checkAIConfig(projectDir: string): Promise<DiagnosticResult[]> {
  // The runtime adapter, not a mock one: a mock filesystem never finds the
  // project's veryfront.config, so every `ai` setting below would read as unset.
  const config = await loadConfigOrNull(projectDir);

  if (!config) {
    return [
      {
        status: "warn",
        name: "AI Configuration",
        message: "Could not load configuration to check AI settings",
      },
    ];
  }

  const surfaces = await findAISurfaces(projectDir, config);
  const explicitlyEnabled = config.ai?.enabled === true;

  if (!explicitlyEnabled && surfaces.length === 0) {
    return [
      {
        status: "pass",
        name: "AI Features",
        message: "Disabled (default)",
      },
    ];
  }

  const results: DiagnosticResult[] = [
    {
      status: "pass",
      name: "AI Features",
      message: surfaces.length > 0 ? `Enabled (${surfaces.join(", ")})` : "Enabled",
    },
  ];

  const providers = config.ai?.providers ?? {};
  const providerEntries = Object.entries(providers);

  if (providerEntries.length === 0) {
    // Providers are optional: keys usually come from the environment. Only an
    // explicit `ai.enabled` config with no providers is worth flagging.
    if (explicitlyEnabled) {
      results.push({
        status: "warn",
        name: "AI Providers",
        message: "No LLM providers configured",
      });
    }
    return results;
  }

  for (const [name, provider] of providerEntries) {
    if (provider?.apiKey) {
      results.push({
        status: "pass",
        name: `AI Provider: ${name}`,
        message: "API Key configured",
      });
      continue;
    }

    // Providers normally resolve their credential from the environment, so an
    // absent `apiKey` in config is only a problem when the env has none either.
    const envKey = findProviderEnvKey(name);

    results.push({
      status: envKey ? "pass" : "fail",
      name: `AI Provider: ${name}`,
      message: envKey ? `API Key from ${envKey}` : "Missing API Key",
      details: envKey
        ? undefined
        : `Set ${providerEnvKeys(name)[0]} or ai.providers.${name}.apiKey`,
    });
  }

  return results;
}
