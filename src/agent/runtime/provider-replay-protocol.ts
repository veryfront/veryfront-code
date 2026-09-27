/**
 * Which provider-replay protocol, and which GenAI provider name, a runtime
 * model maps to. A Veryfront Cloud model of a provider served on the Anthropic
 * surface replays like `anthropic/*`: the replay format belongs to the wire
 * protocol, not to the vendor.
 */
import {
  getModelRuntimeId,
  getModelRuntimeProvider,
} from "#veryfront/provider/runtime-inspection.ts";
import type { ModelRuntime } from "#veryfront/provider/types.ts";
import { readVeryfrontCloudModelFacts } from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import type { ProviderReplayProvider } from "./provider-replay.ts";

/** The provider-replay protocol a model's turns are replayed with. */
export function resolveActiveProviderReplayProvider(
  languageModel: ModelRuntime,
): ProviderReplayProvider | "unsupported" {
  const modelRuntimeId = getModelRuntimeId(languageModel);
  const provider =
    (typeof languageModel.modelProvider === "string" ? languageModel.modelProvider : undefined) ??
      getModelRuntimeProvider(languageModel) ??
      (modelRuntimeId !== undefined
        ? resolveRuntimeGenAiProviderName(modelRuntimeId) ?? modelRuntimeId.split("/")[0]
        : undefined);
  if (provider === "anthropic") return "anthropic";
  if (provider === "openai") return "openai-responses";
  // A Veryfront Cloud model of a provider served on the Anthropic surface
  // replays Anthropic thinking and tool blocks like `anthropic/*`.
  if (readVeryfrontCloudModelFacts(languageModel)?.surface === "anthropic") return "anthropic";
  return "unsupported";
}

/** The GenAI semantic-convention provider name for a runtime model id. */
export function resolveRuntimeGenAiProviderName(modelId: string): string | undefined {
  const normalizedModelId = modelId.startsWith("veryfront-cloud/")
    ? modelId.slice("veryfront-cloud/".length)
    : modelId;
  const provider = normalizedModelId.split("/")[0]?.trim().toLowerCase();

  switch (provider) {
    case "anthropic":
      return "anthropic";
    case "openai":
      return "openai";
    case "google":
    case "google-ai-studio":
      return "gcp.gen_ai";
    case "moonshotai":
      return "moonshotai";
    default:
      return undefined;
  }
}
