export interface InferenceEnvironment {
  apiToken?: string;
  projectSlug?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
  mistralApiKey?: string;
}

function isSet(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

/** Return the inference paths the current dev process can use without exposing credentials. */
export function listInferenceOptions(environment: InferenceEnvironment): string[] {
  const options: string[] = [];

  // The gateway authenticates on the token alone. A freshly scaffolded project
  // has no linked slug yet and its chat route still answers, so gating this on
  // `projectSlug` hid the one inference path `veryfront login` sets up.
  if (isSet(environment.apiToken)) {
    options.push("Veryfront Cloud AI Gateway");
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
