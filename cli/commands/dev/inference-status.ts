import {
  DEV_ENV_RESTART_LINE,
  inferenceSetupOptionLines,
  NO_INFERENCE_HEADING,
  unusedProviderKeyHeading,
} from "../../shared/inference-setup.ts";

export interface InferenceEnvironment {
  apiToken?: string;
  projectSlug?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
  mistralApiKey?: string;
  /**
   * The model each registered agent sets, `undefined` for one that sets none.
   * Omit it when the agents are not known: every key then counts as usable.
   */
  agentModels?: readonly (string | undefined)[];
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
 * Provider keys that no agent can use. An agent with no model runs the default
 * OpenAI model, and the runtime refuses to swap in another provider's key
 * (`default-model-credential-mismatch`). So when every agent leaves its model
 * unset, and neither the gateway nor an OpenAI key can serve the default
 * model, an Anthropic, Google, or Mistral key serves none of them.
 */
export function providerKeysNoAgentCanUse(environment: InferenceEnvironment): string[] {
  const { agentModels } = environment;
  const defaultModelOnly = agentModels !== undefined && agentModels.length > 0 &&
    agentModels.every((model) => model === undefined);
  const gatewayServesDefault = isSet(environment.apiToken) && isSet(environment.projectSlug);
  if (!defaultModelOnly || gatewayServesDefault || isSet(environment.openaiApiKey)) return [];

  const unused: string[] = [];
  if (isSet(environment.anthropicApiKey)) unused.push("ANTHROPIC_API_KEY");
  if (isSet(environment.googleApiKey)) unused.push("GOOGLE_API_KEY");
  if (isSet(environment.mistralApiKey)) unused.push("MISTRAL_API_KEY");
  return unused;
}

/** Return the inference paths the current dev process can use without exposing credentials. */
export function listInferenceOptions(environment: InferenceEnvironment): string[] {
  const options: string[] = [];
  const unused = new Set(providerKeysNoAgentCanUse(environment));

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
  if (isSet(environment.anthropicApiKey) && !unused.has("ANTHROPIC_API_KEY")) {
    options.push("Anthropic direct");
  }
  if (isSet(environment.googleApiKey) && !unused.has("GOOGLE_API_KEY")) {
    options.push("Google direct");
  }
  if (isSet(environment.mistralApiKey) && !unused.has("MISTRAL_API_KEY")) {
    options.push("Mistral direct");
  }

  return options;
}

/**
 * The Ready banner's setup hint: the heading, both ways to get inference, and
 * the restart line, or nothing when an option can serve a model. With no usable
 * option, the first agent message to a hosted model fails, so the banner says
 * so instead of leaving the reader to find out in chat. A key no agent can use
 * ({@link providerKeysNoAgentCanUse}) is named in the heading, so the reader
 * is not told that no key was found.
 */
export function devInferenceHintLines(
  options: readonly string[],
  unusedKeys: readonly string[] = [],
): string[] {
  if (hasUsableInference(options)) return [];
  const heading = unusedKeys.length > 0
    ? unusedProviderKeyHeading(unusedKeys)
    : NO_INFERENCE_HEADING;
  return [heading, ...inferenceSetupOptionLines(), DEV_ENV_RESTART_LINE];
}
