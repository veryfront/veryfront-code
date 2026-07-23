export const HttpStatus = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  MOVED_PERMANENTLY: 301,
  FOUND: 302,
  NOT_MODIFIED: 304,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const;

export type HttpStatusCode = (typeof HttpStatus)[keyof typeof HttpStatus];

interface ResponseOptions extends ResponseInit {
  headers?: HeadersInit;
  correlationId?: string;
}

function withCorrelationId(headers: Headers, options?: ResponseOptions): void {
  const correlationId = options?.correlationId;
  if (correlationId) headers.set("X-Correlation-Id", correlationId);
}

function createHeaders(
  options?: ResponseOptions,
  init?: (headers: Headers) => void,
): Headers {
  const headers = new Headers(options?.headers);
  init?.(headers);
  withCorrelationId(headers, options);
  return headers;
}

export function errorResponse(
  status: HttpStatusCode,
  message?: string,
  options?: ResponseOptions,
): Response {
  const statusText = getStatusText(status);
  const body = message ?? statusText;

  const headers = createHeaders(options, (h) => {
    h.set("Content-Type", "text/plain; charset=utf-8");
  });

  return new Response(body, {
    ...options,
    status,
    statusText,
    headers,
  });
}

/** Create a JSON response with the correct content type. */
export function jsonResponse<T>(
  data: T,
  status: HttpStatusCode = HttpStatus.OK,
  options?: ResponseOptions,
): Response {
  const headers = createHeaders(options, (h) => {
    h.set("Content-Type", "application/json; charset=utf-8");
  });

  let body: string;
  try {
    const serialized = JSON.stringify(data);
    if (serialized === undefined) throw new TypeError("JSON value has no representation");
    body = serialized;
  } catch (_) {
    /* expected: JSON.stringify may fail on circular or non-serializable data */
    return errorResponse(
      HttpStatus.INTERNAL_SERVER_ERROR,
      "Failed to serialize response data",
      options,
    );
  }

  return new Response(body, {
    ...options,
    status,
    headers,
  });
}

/** Create an HTTP redirect response. */
export function redirectResponse(
  url: string,
  permanent = false,
  options?: ResponseOptions,
): Response {
  if (!isValidRedirectUrl(url)) {
    return errorResponse(HttpStatus.BAD_REQUEST, "Invalid redirect URL", options);
  }

  const status = permanent ? HttpStatus.MOVED_PERMANENTLY : HttpStatus.FOUND;
  const headers = createHeaders(options, (h) => {
    h.set("Location", url);
  });

  return new Response(null, {
    ...options,
    status,
    headers,
  });
}

/** Create a 404 Not Found response. */
export function notFound(message?: string, options?: ResponseOptions): Response {
  return errorResponse(HttpStatus.NOT_FOUND, message, options);
}

/** Create a 400 Bad Request response. */
export function badRequest(message?: string, options?: ResponseOptions): Response {
  return errorResponse(HttpStatus.BAD_REQUEST, message, options);
}

/** Create a 401 Unauthorized response. */
export function unauthorized(message?: string, options?: ResponseOptions): Response {
  return errorResponse(HttpStatus.UNAUTHORIZED, message, options);
}

/** Create a 403 Forbidden response. */
export function forbidden(message?: string, options?: ResponseOptions): Response {
  return errorResponse(HttpStatus.FORBIDDEN, message, options);
}

/** Create a 500 Internal Server Error response. */
export function internalServerError(message?: string, options?: ResponseOptions): Response {
  return errorResponse(HttpStatus.INTERNAL_SERVER_ERROR, message, options);
}

export function badGateway(message?: string, options?: ResponseOptions): Response {
  return errorResponse(HttpStatus.BAD_GATEWAY, message, options);
}

export function serviceUnavailable(message?: string, options?: ResponseOptions): Response {
  return errorResponse(HttpStatus.SERVICE_UNAVAILABLE, message, options);
}

export function methodNotAllowed(allowed: string[], options?: ResponseOptions): Response {
  const allow = allowed.join(", ");
  const headers = createHeaders(options, (h) => {
    h.set("Allow", allow);
  });

  return errorResponse(
    HttpStatus.METHOD_NOT_ALLOWED,
    `Method not allowed. Allowed methods: ${allow}`,
    { ...options, headers },
  );
}

export function ok<T>(data?: T, options?: ResponseOptions): Response {
  if (data === undefined) {
    const headers = createHeaders(options);
    return new Response(null, { ...options, status: HttpStatus.OK, headers });
  }
  return jsonResponse(data, HttpStatus.OK, options);
}

export function created<T>(data?: T, location?: string, options?: ResponseOptions): Response {
  const headers = createHeaders(options, (h) => {
    if (location) h.set("Location", location);
  });

  if (data === undefined) {
    return new Response(null, { ...options, status: HttpStatus.CREATED, headers });
  }

  return jsonResponse(data, HttpStatus.CREATED, { ...options, headers });
}

export function noContent(options?: ResponseOptions): Response {
  const headers = createHeaders(options);
  return new Response(null, { ...options, status: HttpStatus.NO_CONTENT, headers });
}

export function jsonErrorResponse(
  status: HttpStatusCode,
  error: string,
  options?: ResponseOptions,
): Response {
  const headers = createHeaders(options, (h) => {
    h.set("Content-Type", "application/json; charset=utf-8");
  });

  return new Response(JSON.stringify({ ok: false, error }), {
    ...options,
    status,
    headers,
  });
}

function getStatusText(status: HttpStatusCode): string {
  const statusTexts: Record<HttpStatusCode, string> = {
    [HttpStatus.OK]: "OK",
    [HttpStatus.CREATED]: "Created",
    [HttpStatus.NO_CONTENT]: "No Content",
    [HttpStatus.MOVED_PERMANENTLY]: "Moved Permanently",
    [HttpStatus.FOUND]: "Found",
    [HttpStatus.NOT_MODIFIED]: "Not Modified",
    [HttpStatus.BAD_REQUEST]: "Bad Request",
    [HttpStatus.UNAUTHORIZED]: "Unauthorized",
    [HttpStatus.FORBIDDEN]: "Forbidden",
    [HttpStatus.NOT_FOUND]: "Not Found",
    [HttpStatus.METHOD_NOT_ALLOWED]: "Method Not Allowed",
    [HttpStatus.CONFLICT]: "Conflict",
    [HttpStatus.PAYLOAD_TOO_LARGE]: "Payload Too Large",
    [HttpStatus.UNPROCESSABLE_ENTITY]: "Unprocessable Entity",
    [HttpStatus.TOO_MANY_REQUESTS]: "Too Many Requests",
    [HttpStatus.INTERNAL_SERVER_ERROR]: "Internal Server Error",
    [HttpStatus.NOT_IMPLEMENTED]: "Not Implemented",
    [HttpStatus.BAD_GATEWAY]: "Bad Gateway",
    [HttpStatus.SERVICE_UNAVAILABLE]: "Service Unavailable",
    [HttpStatus.GATEWAY_TIMEOUT]: "Gateway Timeout",
  };

  return statusTexts[status] ?? "Unknown Status";
}

function isValidRedirectUrl(url: string): boolean {
  try {
    const parsed = new URL(url, "http://localhost");

    if (url.startsWith("/") || url.startsWith("./") || url.startsWith("../")) {
      return true;
    }

    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (_) {
    /* expected: URL parsing fails for malformed URLs */
    return false;
  }
}
