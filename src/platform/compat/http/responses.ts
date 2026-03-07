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

export function jsonResponse<T>(
  data: T,
  status: HttpStatusCode = HttpStatus.OK,
  options?: ResponseOptions,
): Response {
  const headers = createHeaders(options, (h) => {
    h.set("Content-Type", "application/json; charset=utf-8");
  });

  try {
    return new Response(JSON.stringify(data), {
      ...options,
      status,
      headers,
    });
  } catch (_) {
    /* expected: JSON.stringify may fail on circular or non-serializable data */
    return errorResponse(
      HttpStatus.INTERNAL_SERVER_ERROR,
      "Failed to serialize response data",
    );
  }
}

export function redirectResponse(
  url: string,
  permanent = false,
  options?: ResponseOptions,
): Response {
  if (!isValidRedirectUrl(url)) {
    return errorResponse(HttpStatus.BAD_REQUEST, "Invalid redirect URL");
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

export function notFound(message?: string, options?: ResponseOptions): Response {
  return errorResponse(HttpStatus.NOT_FOUND, message, options);
}

export function badRequest(message?: string, options?: ResponseOptions): Response {
  return errorResponse(HttpStatus.BAD_REQUEST, message, options);
}

export function unauthorized(message?: string, options?: ResponseOptions): Response {
  return errorResponse(HttpStatus.UNAUTHORIZED, message, options);
}

export function forbidden(message?: string, options?: ResponseOptions): Response {
  return errorResponse(HttpStatus.FORBIDDEN, message, options);
}

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
  if (data === undefined) return new Response(null, { status: HttpStatus.OK, ...options });
  return jsonResponse(data, HttpStatus.OK, options);
}

export function created<T>(data?: T, location?: string, options?: ResponseOptions): Response {
  const headers = createHeaders(options, (h) => {
    if (location) h.set("Location", location);
  });

  if (data === undefined) {
    return new Response(null, { status: HttpStatus.CREATED, headers, ...options });
  }

  return jsonResponse(data, HttpStatus.CREATED, { ...options, headers });
}

export function noContent(options?: ResponseOptions): Response {
  return new Response(null, { status: HttpStatus.NO_CONTENT, ...options });
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
