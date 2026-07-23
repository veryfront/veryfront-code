import { tryResolve } from "#veryfront/extensions/contracts.ts";
import { INVALID_ARGUMENT, NOT_SUPPORTED } from "#veryfront/errors";
import { importFirstPartyExtensionModule } from "#veryfront/extensions/first-party-import.ts";
import type { AuthProvider, TokenPayload } from "#veryfront/extensions/auth/index.ts";

/** Public API contract for hosted service auth error code. */
export type HostedServiceAuthErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "SERVER_ERROR";

const DEFAULT_PROJECT_ACCESS_TIMEOUT_MS = 15_000;
const MAX_PROJECT_ACCESS_TIMEOUT_MS = 2_147_483_647;
const MAX_AUTH_TOKEN_LENGTH = 65_536;

/** Error shape for hosted service auth. */
export class HostedServiceAuthError extends Error {
  /** Status code value. */
  readonly statusCode: number;
  /** Error code value. */
  readonly errorCode: HostedServiceAuthErrorCode;

  /** Creates an instance with the supplied dependencies. */
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HostedServiceAuthError";
    this.statusCode = statusCode;
    this.errorCode = statusCode === 401
      ? "UNAUTHENTICATED"
      : statusCode === 404
      ? "NOT_FOUND"
      : statusCode >= 500
      ? "SERVER_ERROR"
      : "FORBIDDEN";
  }
}

/** Error shape for is hosted service auth. */
export function isHostedServiceAuthError(
  error: unknown,
): error is HostedServiceAuthError {
  return error instanceof HostedServiceAuthError;
}

export const AgentServiceAuthError = HostedServiceAuthError;
export type AgentServiceAuthError = HostedServiceAuthError;
export type AgentServiceAuthErrorCode = HostedServiceAuthErrorCode;

/** Request payload for hosted service authenticated. */
export type HostedServiceAuthenticatedRequest = {
  authToken: string;
  userId: string;
};

/** Error shape for hosted service jwt. */
export type HostedServiceJwtError = {
  statusCode: number;
  errorCode: HostedServiceAuthErrorCode;
  message: string;
};

/** Result returned from hosted service jwt. */
export type HostedServiceJwtResult =
  | { success: true; userId: string; email: string; token: string }
  | { success: false; error: HostedServiceJwtError };

/** Error shape for hosted service project access. */
export type HostedServiceProjectAccessError = {
  statusCode: number;
  errorCode: HostedServiceAuthErrorCode;
  message: string;
};

/** Result returned from hosted service project access. */
export type HostedServiceProjectAccessResult =
  | { success: true; projectId: string }
  | { success: false; error: HostedServiceProjectAccessError };

/** Configuration used by hosted service auth. */
export type HostedServiceAuthConfig = {
  OAUTH_PUBLIC_KEY?: string | null;
  NODE_ENV?: string | null;
  VERYFRONT_API_URL: string;
};

/** Public API contract for hosted service auth logger. */
export type HostedServiceAuthLogger = {
  debug?: (message: string, metadata?: Record<string, unknown>) => void;
  error?: (message: string, metadata?: Record<string, unknown>) => void;
};

/** Public API contract for hosted service auth trace. */
export type HostedServiceAuthTrace = <TResult>(
  operationName: string,
  operation: () => Promise<TResult>,
) => Promise<TResult>;

/** Public API contract for hosted service auth fetch. */
export type HostedServiceAuthFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** JWT verification capability required by hosted service authentication. */
export type HostedServiceJwtVerifier = Pick<AuthProvider, "verifyWithPublicKey">;

type AuthJwtExtensionModule = {
  createAuthProvider: (options?: Record<string, unknown>) => HostedServiceJwtVerifier;
};

/** Options accepted by hosted service auth. */
export type HostedServiceAuthOptions = {
  getConfig: () => HostedServiceAuthConfig;
  logger?: HostedServiceAuthLogger;
  trace?: HostedServiceAuthTrace;
  fetch?: HostedServiceAuthFetch;
  authProvider?: HostedServiceJwtVerifier;
  projectAccessTimeoutMs?: number;
};

/** Public API contract for hosted service auth. */
export type HostedServiceAuth = {
  authenticateRequest: (
    request: Request,
  ) => Promise<HostedServiceAuthenticatedRequest | Response>;
  getTokenFromRequest: typeof getHostedServiceTokenFromRequest;
  verifyJwt: (token: string) => Promise<HostedServiceJwtResult>;
  verifyProjectAccess: (
    projectId: string,
    token: string,
  ) => Promise<HostedServiceProjectAccessResult>;
};

export type AgentServiceAuthenticatedRequest = HostedServiceAuthenticatedRequest;
export type AgentServiceJwtError = HostedServiceJwtError;
export type AgentServiceJwtResult = HostedServiceJwtResult;
export type AgentServiceProjectAccessError = HostedServiceProjectAccessError;
export type AgentServiceProjectAccessResult = HostedServiceProjectAccessResult;
/** Authentication configuration used by an agent service. */
export type AgentServiceAuthConfig = HostedServiceAuthConfig;
export type AgentServiceAuthLogger = HostedServiceAuthLogger;
export type AgentServiceAuthTrace = HostedServiceAuthTrace;
export type AgentServiceAuthFetch = HostedServiceAuthFetch;
export type AgentServiceAuthOptions = HostedServiceAuthOptions;
/** Authentication operations exposed by an agent service. */
export type AgentServiceAuth = HostedServiceAuth;

function defaultTrace<TResult>(
  _operationName: string,
  operation: () => Promise<TResult>,
): Promise<TResult> {
  return operation();
}

function getFetch(options: HostedServiceAuthOptions): HostedServiceAuthFetch {
  return options.fetch ?? fetch;
}

function getProjectAccessTimeoutMs(options: HostedServiceAuthOptions): number {
  const timeoutMs = options.projectAccessTimeoutMs ?? DEFAULT_PROJECT_ACCESS_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
    timeoutMs > MAX_PROJECT_ACCESS_TIMEOUT_MS
  ) {
    throw INVALID_ARGUMENT.create({
      detail:
        `projectAccessTimeoutMs must be a positive safe integer no greater than ${MAX_PROJECT_ACCESS_TIMEOUT_MS}`,
    });
  }
  return timeoutMs;
}

let defaultAuthProviderPromise: Promise<HostedServiceJwtVerifier> | undefined;

async function getDefaultAuthProvider(): Promise<HostedServiceJwtVerifier> {
  defaultAuthProviderPromise ??= importFirstPartyExtensionModule<AuthJwtExtensionModule>(
    "ext-auth-jwt",
    "@veryfront/ext-auth-jwt",
  ).then(({ createAuthProvider }) => createAuthProvider({}));
  return await defaultAuthProviderPromise;
}

async function getAuthProvider(
  options: HostedServiceAuthOptions,
): Promise<HostedServiceJwtVerifier | undefined> {
  return options.authProvider ??
    tryResolve<HostedServiceJwtVerifier>("AuthProvider") ??
    await getDefaultAuthProvider();
}

/** Request payload for get hosted service token from. */
export function getHostedServiceTokenFromRequest(request: Request): string | null {
  const cookies = request.headers.get("cookie") || "";
  const cookieMatch = cookies.match(/(?:^|;\s*)authToken=([^;]+)/);
  if (cookieMatch?.[1]) return cookieMatch[1];

  const authHeader = request.headers.get("authorization");
  const bearerMatch = authHeader?.match(/^Bearer[\t ]+([^\s]+)$/i);
  if (bearerMatch?.[1]) return bearerMatch[1];

  return null;
}

export const getAgentServiceTokenFromRequest = getHostedServiceTokenFromRequest;

function makeUnauthenticatedError(message: string): HostedServiceJwtError {
  return {
    statusCode: 401,
    errorCode: "UNAUTHENTICATED",
    message,
  };
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  const padded = `${normalized}${"=".repeat(paddingLength)}`;

  if (typeof atob !== "function") {
    throw NOT_SUPPORTED.create({ detail: "Base64URL decoding is not available in this runtime" });
  }

  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new TextDecoder().decode(bytes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(json: string): Record<string, unknown> | null {
  const parsed: unknown = JSON.parse(json);
  return isRecord(parsed) ? parsed : null;
}

function decodeHostedServiceJwtWithoutVerify(
  token: string,
): HostedServiceJwtResult {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return {
        success: false,
        error: makeUnauthenticatedError("Invalid token format"),
      };
    }

    const payloadPart = parts[1];
    if (!payloadPart) {
      return {
        success: false,
        error: makeUnauthenticatedError("Invalid token format"),
      };
    }

    const payload = parseJsonObject(decodeBase64Url(payloadPart));
    if (!payload) {
      return {
        success: false,
        error: makeUnauthenticatedError("Invalid token"),
      };
    }

    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) {
      return {
        success: false,
        error: makeUnauthenticatedError("Token expired"),
      };
    }

    const userId = typeof payload.userId === "string" ? payload.userId : null;
    if (!userId) {
      return {
        success: false,
        error: makeUnauthenticatedError("Invalid token: missing userId"),
      };
    }

    return {
      success: true,
      userId,
      email: typeof payload.email === "string" ? payload.email : "",
      token,
    };
  } catch {
    return {
      success: false,
      error: makeUnauthenticatedError("Invalid token"),
    };
  }
}

/** Create hosted service auth. */
export function createHostedServiceAuth(
  options: HostedServiceAuthOptions,
): HostedServiceAuth {
  const trace = options.trace ?? defaultTrace;
  const projectAccessTimeoutMs = getProjectAccessTimeoutMs(options);

  async function verifyJwt(token: string): Promise<HostedServiceJwtResult> {
    return await trace("auth.verifyJwt", async () => {
      if (!token) {
        return {
          success: false,
          error: makeUnauthenticatedError("Authentication token required"),
        };
      }
      if (token.length > MAX_AUTH_TOKEN_LENGTH) {
        return {
          success: false,
          error: makeUnauthenticatedError("Authentication token is too large"),
        };
      }

      const config = options.getConfig();

      if (!config.OAUTH_PUBLIC_KEY) {
        if (config.NODE_ENV === "production") {
          return {
            success: false,
            error: {
              statusCode: 500,
              errorCode: "SERVER_ERROR",
              message: "JWT public key not configured",
            },
          };
        }
        return decodeHostedServiceJwtWithoutVerify(token);
      }

      try {
        const authProvider = await getAuthProvider(options);
        if (!authProvider) {
          return {
            success: false,
            error: {
              statusCode: 500,
              errorCode: "SERVER_ERROR",
              message: "JWT auth provider not configured",
            },
          };
        }

        const payload = await authProvider.verifyWithPublicKey(token, config.OAUTH_PUBLIC_KEY, {
          algorithms: ["RS256"],
        }) as TokenPayload;

        const userId = typeof payload.userId === "string" ? payload.userId : null;
        if (!userId) {
          return {
            success: false,
            error: makeUnauthenticatedError("Invalid token: missing userId"),
          };
        }

        return {
          success: true,
          userId,
          email: typeof payload.email === "string" ? payload.email : "",
          token,
        };
      } catch (error) {
        options.logger?.debug?.("JWT verification failed", {
          errorName: error instanceof Error ? error.name : typeof error,
        });

        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes("expired")) {
          return {
            success: false,
            error: makeUnauthenticatedError("Token expired"),
          };
        }

        return {
          success: false,
          error: makeUnauthenticatedError("Invalid token"),
        };
      }
    });
  }

  async function authenticateRequest(
    request: Request,
  ): Promise<HostedServiceAuthenticatedRequest | Response> {
    const token = getHostedServiceTokenFromRequest(request);
    if (!token) {
      return Response.json({ errorCode: "UNAUTHENTICATED" }, { status: 401 });
    }

    const auth = await verifyJwt(token);
    if (!auth.success) {
      return Response.json(
        { errorCode: auth.error.errorCode },
        { status: auth.error.statusCode },
      );
    }

    return {
      authToken: auth.token,
      userId: auth.userId,
    };
  }

  async function verifyProjectAccess(
    projectId: string,
    token: string,
  ): Promise<HostedServiceProjectAccessResult> {
    return await trace("auth.verifyProjectAccess", async () => {
      const config = options.getConfig();

      try {
        const apiUrl = new URL(config.VERYFRONT_API_URL);
        const restUrl = new URL(`/projects/${encodeURIComponent(projectId)}`, apiUrl.origin);

        const headers = new Headers({ "Content-Type": "application/json" });
        if (token) {
          headers.set("Authorization", `Bearer ${token}`);
        }

        const response = await getFetch(options)(restUrl.toString(), {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(projectAccessTimeoutMs),
        });

        if (response.status === 404) {
          return {
            success: false,
            error: {
              statusCode: 404,
              errorCode: "NOT_FOUND",
              message: "Project not found",
            },
          };
        }

        if (response.status === 401 || response.status === 403) {
          return {
            success: false,
            error: {
              statusCode: 403,
              errorCode: "FORBIDDEN",
              message: "No access to project",
            },
          };
        }

        if (!response.ok) {
          options.logger?.error?.("Project access check failed", {
            status: response.status,
            projectIdLength: projectId.length,
          });
          return {
            success: false,
            error: {
              statusCode: 403,
              errorCode: "FORBIDDEN",
              message: "No access to project",
            },
          };
        }

        return {
          success: true,
          projectId,
        };
      } catch (error) {
        options.logger?.error?.("Project access check failed", { error, projectId });
        return {
          success: false,
          error: {
            statusCode: 403,
            errorCode: "FORBIDDEN",
            message: "No access to project",
          },
        };
      }
    });
  }

  return {
    authenticateRequest,
    getTokenFromRequest: getHostedServiceTokenFromRequest,
    verifyJwt,
    verifyProjectAccess,
  };
}

export const createAgentServiceAuth = createHostedServiceAuth;
export const isAgentServiceAuthError = isHostedServiceAuthError;
