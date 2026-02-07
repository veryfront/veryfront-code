import type { DiagnosticResult } from "./types.ts";
import { getConfig } from "veryfront/config";
import { createMockAdapter } from "veryfront/platform";

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
  const providerEntries = Object.entries(providers);

  if (providerEntries.length === 0) {
    results.push({
      status: "warn",
      name: "AI Providers",
      message: "No AI providers configured",
    });
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
