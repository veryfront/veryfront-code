
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

export type HttpStatusCode = typeof HttpStatus[keyof typeof HttpStatus];

interface ResponseOptions extends ResponseInit {
  headers?: HeadersInit;
  correlationId?: string;
}

export function errorResponse(
  status: HttpStatusCode,
  message?: string,
  options?: ResponseOptions,
): Response {
  const statusText = getStatusText(status);
  const body = message || statusText;

  const headers = new Headers(options?.headers);
  headers.set("Content-Type", "text/plain; charset=utf-8");

  if (options?.correlationId) {
    headers.set("X-Correlation-Id", options.correlationId);
  }

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
  const headers = new Headers(options?.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");

  try {
    const body = JSON.stringify(data);
    return new Response(body, {
      ...options,
      status,
      headers,
    });
  } catch {
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
    return errorResponse(
      HttpStatus.BAD_REQUEST,
      "Invalid redirect URL",
    );
  }

  const status = permanent ? HttpStatus.MOVED_PERMANENTLY : HttpStatus.FOUND;
  const headers = new Headers(options?.headers);
  headers.set("Location", url);

  return new Response(null, {
    ...options,
    status,
    headers,
  });
}

export const notFound = (message?: string, options?: ResponseOptions) =>
  errorResponse(HttpStatus.NOT_FOUND, message, options);

export const badRequest = (message?: string, options?: ResponseOptions) =>
  errorResponse(HttpStatus.BAD_REQUEST, message, options);

export const unauthorized = (message?: string, options?: ResponseOptions) =>
  errorResponse(HttpStatus.UNAUTHORIZED, message, options);

export const forbidden = (message?: string, options?: ResponseOptions) =>
  errorResponse(HttpStatus.FORBIDDEN, message, options);

export const internalServerError = (message?: string, options?: ResponseOptions) =>
  errorResponse(HttpStatus.INTERNAL_SERVER_ERROR, message, options);

export const badGateway = (message?: string, options?: ResponseOptions) =>
  errorResponse(HttpStatus.BAD_GATEWAY, message, options);

export const serviceUnavailable = (message?: string, options?: ResponseOptions) =>
  errorResponse(HttpStatus.SERVICE_UNAVAILABLE, message, options);

export const methodNotAllowed = (allowed: string[], options?: ResponseOptions) => {
  const headers = new Headers(options?.headers);
  headers.set("Allow", allowed.join(", "));
  return errorResponse(
    HttpStatus.METHOD_NOT_ALLOWED,
    `Method not allowed. Allowed methods: ${allowed.join(", ")}`,
    { ...options, headers },
  );
};

export const ok = <T>(data?: T, options?: ResponseOptions) =>
  data === undefined
    ? new Response(null, { status: HttpStatus.OK, ...options })
    : jsonResponse(data, HttpStatus.OK, options);

export const created = <T>(data?: T, location?: string, options?: ResponseOptions) => {
  const headers = new Headers(options?.headers);
  if (location) {
    headers.set("Location", location);
  }
  return data === undefined
    ? new Response(null, { status: HttpStatus.CREATED, headers, ...options })
    : jsonResponse(data, HttpStatus.CREATED, { ...options, headers });
};

export const noContent = (options?: ResponseOptions) =>
  new Response(null, { status: HttpStatus.NO_CONTENT, ...options });

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

  return statusTexts[status] || "Unknown Status";
}

/**
 * Validates redirect URLs to prevent open redirect vulnerabilities.
 * Allows:
 * - Absolute paths starting with "/" (but not "//" which could be protocol-relative)
 * - Relative paths starting with "./"
 * - HTTP and HTTPS URLs
 * Blocks:
 * - Protocol-relative URLs (//example.com)
 * - Parent directory traversal (../)
 * - JavaScript URLs and other dangerous protocols
 */
function isValidRedirectUrl(url: string): boolean {
  try {
    // Block protocol-relative URLs (//example.com) which could redirect to external sites
    if (url.startsWith("//")) {
      return false;
    }

    // Block parent directory traversal to prevent path manipulation
    if (url.startsWith("../") || url.includes("/../")) {
      return false;
    }

    // Allow absolute paths (starting with single /)
    if (url.startsWith("/") && !url.startsWith("//")) {
      return true;
    }

    // Allow relative paths starting with ./
    if (url.startsWith("./")) {
      return true;
    }

    // For full URLs, only allow http and https protocols
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
