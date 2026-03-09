import { DEFAULT_LOCAL_MODEL } from "#veryfront/provider/local/model-catalog.ts";

export const AUTO_AGENT_MODEL = "auto";

export function normalizeAgentModelConfig(model?: string): string {
  const normalized = model?.trim();
  return normalized && normalized.length > 0 ? normalized : AUTO_AGENT_MODEL;
}

export function resolveConfiguredAgentModel(model?: string): string {
  const normalized = normalizeAgentModelConfig(model);
  return normalized === AUTO_AGENT_MODEL ? `local/${DEFAULT_LOCAL_MODEL}` : normalized;
}
