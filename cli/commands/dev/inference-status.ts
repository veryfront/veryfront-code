export interface InferenceEnvironment {
  apiToken?: string;
  projectSlug?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
  mistralApiKey?: string;
}

const CLOUD_GATEWAY_LABEL = "Veryfront Cloud AI Gateway";

function isSet(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

/**
 * Whether a rendered option list claims the Cloud gateway. Callers use this to
 * decide if a stored session still needs validating — the gateway is the only
 * option whose credential the CLI can check itself.
 */
export function advertisesCloudGateway(options: readonly string[]): boolean {
  return options.includes(CLOUD_GATEWAY_LABEL);
}

/** Return the inference paths the current dev process can use without exposing credentials. */
export function listInferenceOptions(environment: InferenceEnvironment): string[] {
  const options: string[] = [];

  // The gateway authenticates on the token alone. A freshly scaffolded project
  // has no linked slug yet and its chat route still answers, so gating this on
  // `projectSlug` hid the one inference path `veryfront login` sets up.
  if (isSet(environment.apiToken)) {
    options.push(CLOUD_GATEWAY_LABEL);
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
