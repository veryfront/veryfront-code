import type { DiagnosticResult } from "./types.ts";
import { exists } from "#std/fs.ts";
import { join } from "veryfront/platform/path";
import type { VeryfrontConfig } from "veryfront/config";
import { getConfig } from "veryfront/config";
import { createProjectDiscoveryConfig } from "veryfront/discovery";
import { createMockAdapter } from "veryfront/platform";

/** Discovery buckets that make a project's AI surface visible to the runtime. */
const AI_SURFACE_KEYS = ["agentDirs", "toolDirs", "workflowDirs", "skillDirs"] as const;

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
  const adapter = createMockAdapter();

  let config: Awaited<ReturnType<typeof getConfig>>;
  try {
    config = await getConfig(projectDir, adapter);
  } catch {
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
    const apiKey = provider?.apiKey;

    results.push({
      status: apiKey ? "pass" : "fail",
      name: `AI Provider: ${name}`,
      message: apiKey ? "API Key configured" : "Missing API Key",
    });
  }

  return results;
}
