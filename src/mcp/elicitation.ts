/** Options accepted by form elicitation. */
export interface FormElicitationOptions {
  message: string;
  schema: Record<string, unknown>;
}

/** Options accepted by URL elicitation. */
export interface UrlElicitationOptions {
  message: string;
  url: string;
  elicitationId: string;
}

/** Request payload for elicitation. */
export interface ElicitationRequest {
  method: "elicitation/create";
  params: Record<string, unknown>;
}

/** Builds form elicitation. */
export function buildFormElicitation(
  options: FormElicitationOptions,
): ElicitationRequest {
  return {
    method: "elicitation/create",
    params: {
      mode: "form",
      message: options.message,
      requestedSchema: options.schema,
    },
  };
}

/** Builds URL elicitation. */
export function buildUrlElicitation(
  options: UrlElicitationOptions,
): ElicitationRequest {
  return {
    method: "elicitation/create",
    params: {
      mode: "url",
      message: options.message,
      url: options.url,
      elicitationId: options.elicitationId,
    },
  };
}
