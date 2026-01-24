import type { DiagnosticResult } from "./types.ts";
import { getConfig } from "#veryfront/config/loader.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";

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

  if (!config.ai?.enabled) {
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
      message: "Enabled",
    },
  ];

  const providers = config.ai.providers ?? {};
  const providerNames = Object.keys(providers);

  if (providerNames.length === 0) {
    results.push({
      status: "warn",
      name: "AI Providers",
      message: "No AI providers configured",
    });
    return results;
  }

  for (const name of providerNames) {
    const apiKey = providers[name]?.apiKey;

    results.push({
      status: apiKey ? "pass" : "fail",
      name: `AI Provider: ${name}`,
      message: apiKey ? "API Key configured" : "Missing API Key",
    });
  }

  return results;
}
