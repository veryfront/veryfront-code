import { tryResolve } from "#veryfront/extensions/contracts.ts";
import { NOT_SUPPORTED } from "#veryfront/errors";
import { importFirstPartyExtensionModule } from "#veryfront/extensions/first-party-import.ts";
import type { AuthProvider, TokenPayload } from "#veryfront/extensions/auth/index.ts";

const ReflectApply = Reflect.apply;
const RequestHeadersGetter = Object.getOwnPropertyDescriptor(Request.prototype, "headers")?.get;
const HeadersGet = Headers.prototype.get;
const RegExpExec = RegExp.prototype.exec;
const StringStartsWith = String.prototype.startsWith;
const StringSlice = String.prototype.slice;

function readRequestHeader(request: Request, name: string): string | null {
  if (!RequestHeadersGetter) return null;
  const headers = ReflectApply(RequestHeadersGetter, request, []) as Headers;
  return ReflectApply(HeadersGet, headers, [name]) as string | null;
}

/** Public API contract for hosted service auth error code. */
export type HostedServiceAuthErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "SERVER_ERROR";

/** Error shape for hosted service auth. */
export class HostedServiceAuthError extends Error {
  readonly statusCode: number;
  readonly errorCode: HostedServiceAuthErrorCode;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HostedServiceAuthError";
    this.statusCode = statusCode;
    this.errorCode = statusCode === 401 ? "UNAUTHENTICATED" : "FORBIDDEN";
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

/** Claims that bind an internal run-event append token to one durable run. */
export type HostedServiceRunEventAppendTokenInput = {
  token: string;
  projectId: string;
  runId: string;
};

/**
 * Outcome of verifying an internal run-event append token.
 *
 * `integrationTools` carries the server-resolved integration tool grant. It is
 * read from the signed token rather than the request body, so a caller cannot
 * widen its own grant by editing what it posts.
 */
export type HostedServiceRunEventAppendTokenResult = {
  verified: boolean;
  integrationTools?: readonly string[];
};

/**
 * Verifiers may return a bare boolean; the richer result is optional so existing
 * host implementations keep working unchanged.
 */
export type HostedServiceRunEventAppendTokenVerification =
  | boolean
  | HostedServiceRunEventAppendTokenResult;

/** Normalize either verifier shape into the richer result. */
export function toRunEventAppendTokenResult(
  verification: HostedServiceRunEventAppendTokenVerification,
): HostedServiceRunEventAppendTokenResult {
  return typeof verification === "boolean" ? { verified: verification } : verification;
}

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
  | { success: true; projectId: string; projectSlug?: string }
  | { success: false; error: HostedServiceProjectAccessError };

/** Configuration used by hosted service auth. */
export type HostedServiceAuthConfig = {
  OAUTH_PUBLIC_KEY?: string | null;
  SERVICE_ACCOUNT_VERYFRONT_SERVER_ID?: string | null;
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

export type HostedServiceJwtVerifier = Pick<AuthProvider, "verifyWithPublicKey">;

type AuthJwtExtensionModule = {
  createAuthProvider: (options?: Record<string, unknown>) => HostedServiceJwtVerifier;
};

const RUN_EVENT_WRITER_TOKEN_USE = "run_event_writer";
// veryfront-issue-inbox#353: remove V1 only after API, Framework, and Agent all
// emit and accept the V2 `scopes` contract in every deployed environment.
const RUN_EVENT_WRITER_V1_SCOPES = ["projects:read", "runs:write"] as const;
const RUN_EVENT_WRITER_V2_SCOPES = ["agent-runs:events:append"] as const;

function hasExactScopes(scopes: unknown, expected: readonly string[]): boolean {
  return Array.isArray(scopes) &&
    scopes.length === expected.length &&
    scopes.every((value): value is string => typeof value === "string") &&
    new Set(scopes).size === scopes.length &&
    expected.every((requiredScope) => scopes.includes(requiredScope));
}

function hasExactRunEventWriterScopes(payload: TokenPayload): boolean {
  const claims = payload as TokenPayload & { scope?: unknown; scopes?: unknown };
  const isLegacy = claims.scopes === undefined &&
    hasExactScopes(claims.scope, RUN_EVENT_WRITER_V1_SCOPES);
  const isCurrent = claims.scope === undefined &&
    hasExactScopes(claims.scopes, RUN_EVENT_WRITER_V2_SCOPES);
  return isLegacy || isCurrent;
}

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
  /**
   * Always reports the richer result. The permissive
   * {@link HostedServiceRunEventAppendTokenVerification} union is for callers
   * that accept a host-supplied verifier, not for this implementation's own
   * output — narrowing it here keeps `.verified` readable without a cast.
   */
  verifyRunEventAppendToken: (
    input: HostedServiceRunEventAppendTokenInput,
  ) => Promise<HostedServiceRunEventAppendTokenResult>;
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
export type AgentServiceAuthConfig = HostedServiceAuthConfig;
export type AgentServiceAuthLogger = HostedServiceAuthLogger;
export type AgentServiceAuthTrace = HostedServiceAuthTrace;
export type AgentServiceAuthFetch = HostedServiceAuthFetch;
export type AgentServiceAuthOptions = HostedServiceAuthOptions;
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
  return options.projectAccessTimeoutMs ?? 15_000;
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
  const cookies = readRequestHeader(request, "cookie") || "";
  const cookieMatch = ReflectApply(RegExpExec, /(?:^|;\s*)authToken=([^;]+)/, [cookies]) as
    | RegExpExecArray
    | null;
  if (cookieMatch?.[1]) return cookieMatch[1];

  const authHeader = readRequestHeader(request, "authorization");
  if (authHeader && ReflectApply(StringStartsWith, authHeader, ["Bearer "])) {
    return ReflectApply(StringSlice, authHeader, [7]) as string;
  }

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

async function readProjectSlugFromAccessResponse(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (!isRecord(body)) return undefined;
    const slug = typeof body.slug === "string" ? body.slug.trim() : "";
    return slug || undefined;
  } catch {
    return undefined;
  }
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

  async function verifyJwt(token: string): Promise<HostedServiceJwtResult> {
    return await trace("auth.verifyJwt", async () => {
      if (!token) {
        return {
          success: false,
          error: makeUnauthenticatedError("Authentication token required"),
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
          error: error instanceof Error ? error.message : String(error),
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
      return Response.json({ errorCode: auth.error.errorCode }, { status: 401 });
    }

    return {
      authToken: auth.token,
      userId: auth.userId,
    };
  }

  async function verifyRunEventAppendToken(
    input: HostedServiceRunEventAppendTokenInput,
  ): Promise<HostedServiceRunEventAppendTokenResult> {
    return await trace("auth.verifyRunEventAppendToken", async () => {
      const config = options.getConfig();
      if (!config.OAUTH_PUBLIC_KEY || !config.SERVICE_ACCOUNT_VERYFRONT_SERVER_ID) {
        return { verified: false };
      }

      try {
        const authProvider = await getAuthProvider(options);
        if (!authProvider) {
          return { verified: false };
        }

        const payload = await authProvider.verifyWithPublicKey(
          input.token,
          config.OAUTH_PUBLIC_KEY,
          { algorithms: ["RS256"] },
        ) as TokenPayload;

        const verified = payload.actorType === "service_account" &&
          payload.tokenUse === RUN_EVENT_WRITER_TOKEN_USE &&
          typeof payload.serviceAccountId === "string" &&
          payload.userId === payload.serviceAccountId &&
          payload.serviceAccountId === config.SERVICE_ACCOUNT_VERYFRONT_SERVER_ID &&
          payload.projectId === input.projectId &&
          payload.runId === input.runId &&
          hasExactRunEventWriterScopes(payload);

        if (!verified) {
          return { verified: false };
        }

        const integrationTools = (payload as { integrationTools?: unknown }).integrationTools;
        return {
          verified: true,
          ...(Array.isArray(integrationTools) ? { integrationTools } : {}),
        } as HostedServiceRunEventAppendTokenResult;
      } catch (error) {
        options.logger?.debug?.("Run-event append token verification failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return { verified: false };
      }
    });
  }

  async function verifyProjectAccess(
    projectId: string,
    token: string,
  ): Promise<HostedServiceProjectAccessResult> {
    return await trace("auth.verifyProjectAccess", async () => {
      const config = options.getConfig();

      try {
        const apiUrl = new URL(config.VERYFRONT_API_URL);
        const restUrl = new URL(`/projects/${projectId}`, apiUrl.origin);

        const headers = new Headers({ "Content-Type": "application/json" });
        if (token) {
          headers.set("Authorization", `Bearer ${token}`);
        }

        const response = await getFetch(options)(restUrl.toString(), {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(getProjectAccessTimeoutMs(options)),
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
          const errorText = await response.text();
          options.logger?.error?.("Project access check failed", {
            error: errorText,
            projectId,
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

        const projectSlug = await readProjectSlugFromAccessResponse(response);
        return {
          success: true,
          projectId,
          ...(projectSlug ? { projectSlug } : {}),
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
    verifyRunEventAppendToken,
    verifyProjectAccess,
  };
}

export const createAgentServiceAuth = createHostedServiceAuth;
export const isAgentServiceAuthError = isHostedServiceAuthError;
