import {
  DEV_ENV_RESTART_LINE,
  inferenceSetupOptionLines,
  NO_INFERENCE_HEADING,
} from "../../shared/inference-setup.ts";

export interface InferenceEnvironment {
  apiToken?: string;
  projectSlug?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
  mistralApiKey?: string;
  /** The variable `googleApiKey` came from. Defaults to `GOOGLE_API_KEY`. */
  googleApiKeyName?: "GOOGLE_API_KEY" | "GOOGLE_GENERATIVE_AI_API_KEY";
  /**
   * The model each registered agent sets, `undefined` for one that sets none.
   * Omit it when the agents are not known.
   */
  agentModels?: readonly (string | undefined)[];
  /** The application registered its own `openai` model provider. */
  defaultModelProviderRegistered?: boolean;
}

/**
 * The provider keys and endpoint the runtime reads, through `read`, in the
 * shape {@link listInferenceOptions} takes. A Google key keeps the name of the
 * variable that held it, in the runtime's order.
 */
export function readProviderKeys(
  read: (name: string) => string | undefined,
): Pick<
  InferenceEnvironment,
  | "openaiApiKey"
  | "openaiBaseUrl"
  | "anthropicApiKey"
  | "googleApiKey"
  | "googleApiKeyName"
  | "mistralApiKey"
> {
  // Same order and test as getGoogleGenAICredentialEnvName in the runtime.
  const googleApiKeyName = read("GOOGLE_API_KEY")
    ? "GOOGLE_API_KEY"
    : read("GOOGLE_GENERATIVE_AI_API_KEY")
    ? "GOOGLE_GENERATIVE_AI_API_KEY"
    : undefined;
  return {
    openaiApiKey: read("OPENAI_API_KEY"),
    openaiBaseUrl: read("OPENAI_BASE_URL"),
    anthropicApiKey: read("ANTHROPIC_API_KEY"),
    ...(googleApiKeyName ? { googleApiKey: read(googleApiKeyName), googleApiKeyName } : {}),
    mistralApiKey: read("MISTRAL_API_KEY"),
  };
}

const CLOUD_GATEWAY_LABEL = "Veryfront Cloud AI Gateway";
const CLOUD_GATEWAY_PROJECT_REQUIRED_LABEL = "Cloud (no project connected)";

function isSet(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

/**
 * Whether a rendered option list claims the Cloud gateway. Callers use this to
 * decide if a stored session still needs validating — the gateway is the only
 * option whose credential the CLI can check itself.
 */
export function advertisesCloudGateway(options: readonly string[]): boolean {
  return options.some((option) =>
    option === CLOUD_GATEWAY_LABEL || option === CLOUD_GATEWAY_PROJECT_REQUIRED_LABEL
  );
}

/**
 * Whether any listed option can serve a model request. A stored login without a
 * linked project is listed so the reader sees the missing setup, but the
 * gateway refuses model requests without a project.
 */
export function hasUsableInference(options: readonly string[]): boolean {
  return options.some((option) => option !== CLOUD_GATEWAY_PROJECT_REQUIRED_LABEL);
}

/**
 * Provider keys the default model cannot use. An agent with no model runs the
 * default OpenAI model, and the runtime refuses to swap in another provider's
 * key (`default-model-credential-mismatch`). So when every agent leaves its
 * model unset, and neither the gateway, an OpenAI key, nor an application
 * `openai` provider can serve the default, an Anthropic, Google, or Mistral key
 * serves none of those agents' default requests. The keys still serve a
 * request that picks a model of their provider, so callers warn rather than
 * drop them.
 */
export function defaultModelMismatchKeys(environment: InferenceEnvironment): string[] {
  const { agentModels } = environment;
  const defaultModelOnly = agentModels !== undefined && agentModels.length > 0 &&
    agentModels.every((model) => model === undefined);
  const defaultModelServed = (isSet(environment.apiToken) && isSet(environment.projectSlug)) ||
    isSet(environment.openaiApiKey) || environment.defaultModelProviderRegistered === true;
  if (!defaultModelOnly || defaultModelServed) return [];

  const keys: string[] = [];
  if (isSet(environment.anthropicApiKey)) keys.push("ANTHROPIC_API_KEY");
  if (isSet(environment.googleApiKey)) keys.push(environment.googleApiKeyName ?? "GOOGLE_API_KEY");
  if (isSet(environment.mistralApiKey)) keys.push("MISTRAL_API_KEY");
  return keys;
}

/** Return the inference paths the current dev process can use without exposing credentials. */
export function listInferenceOptions(environment: InferenceEnvironment): string[] {
  const options: string[] = [];

  // The gateway can validate the login token without a project, but model
  // requests need a project for billing. Name the missing setup in the Ready
  // banner so a freshly scaffolded, unlinked app does not fail only after the
  // first chat message.
  if (isSet(environment.apiToken)) {
    options.push(
      isSet(environment.projectSlug) ? CLOUD_GATEWAY_LABEL : CLOUD_GATEWAY_PROJECT_REQUIRED_LABEL,
    );
  }
  if (isSet(environment.openaiApiKey)) {
    options.push(
      isSet(environment.openaiBaseUrl) ? "OpenAI-compatible service" : "OpenAI direct",
    );
  }
  if (isSet(environment.anthropicApiKey)) options.push("Anthropic direct");
  if (isSet(environment.googleApiKey)) options.push("Google direct");
  if (isSet(environment.mistralApiKey)) options.push("Mistral direct");

  return options;
}

/**
 * The Ready banner's setup hint: the heading, both ways to get inference, and
 * the restart line, or nothing when an option can serve a model. With no usable
 * option, the first agent message to a hosted model fails, so the banner says
 * so instead of leaving the reader to find out in chat.
 */
export function devInferenceHintLines(options: readonly string[]): string[] {
  if (hasUsableInference(options)) return [];
  return [NO_INFERENCE_HEADING, ...inferenceSetupOptionLines(), DEV_ENV_RESTART_LINE];
}
