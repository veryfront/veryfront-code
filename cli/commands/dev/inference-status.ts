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
const CLOUD_GATEWAY_PROJECT_REQUIRED_LABEL =
  "Veryfront Cloud AI Gateway (project required: set VERYFRONT_PROJECT_SLUG or add projectSlug to veryfront.config.ts)";

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
    option === CLOUD_GATEWAY_LABEL || option.startsWith(`${CLOUD_GATEWAY_LABEL} (`)
  );
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
