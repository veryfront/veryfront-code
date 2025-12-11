import type { DiagnosticResult } from "./types.ts";
import { getConfig } from "../../../core/config/loader.ts";
import { createMockAdapter } from "../../../platform/adapters/mock.ts";

export async function checkAIConfig(projectDir: string): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];

  const adapter = createMockAdapter();
  let config;

  try {
    config = await getConfig(projectDir, adapter);
  } catch {
    return [{
      status: "warn",
      name: "AI Configuration",
      message: "Could not load configuration to check AI settings",
    }];
  }

  if (!config.ai?.enabled) {
    return [{
      status: "pass",
      name: "AI Features",
      message: "Disabled (default)",
    }];
  }

  results.push({
    status: "pass",
    name: "AI Features",
    message: "Enabled",
  });

  const providers = config.ai.providers || {};
  const providerNames = Object.keys(providers);

  if (providerNames.length === 0) {
    results.push({
      status: "warn",
      name: "AI Providers",
      message: "No AI providers configured",
    });
  } else {
    for (const name of providerNames) {
      const providerConfig = providers[name];
      const apiKey = providerConfig?.apiKey;

      if (apiKey) {
        results.push({
          status: "pass",
          name: `AI Provider: ${name}`,
          message: "API Key configured",
        });
      } else {
        results.push({
          status: "fail",
          name: `AI Provider: ${name}`,
          message: "Missing API Key",
        });
      }
    }
  }

  return results;
}
