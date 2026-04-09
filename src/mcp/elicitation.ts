interface FormElicitationOptions {
  message: string;
  schema: Record<string, unknown>;
}

interface UrlElicitationOptions {
  message: string;
  url: string;
  elicitationId: string;
}

interface ElicitationRequest {
  method: "elicitation/create";
  params: Record<string, unknown>;
}

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
