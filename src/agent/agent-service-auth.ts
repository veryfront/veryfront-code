import { importSPKI, jwtVerify, type KeyLike } from "jose";

export type HostedServiceAuthErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "SERVER_ERROR";

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

export function isHostedServiceAuthError(
  error: unknown,
): error is HostedServiceAuthError {
  return error instanceof HostedServiceAuthError;
}

export const AgentServiceAuthError = HostedServiceAuthError;
export type AgentServiceAuthError = HostedServiceAuthError;
export type AgentServiceAuthErrorCode = HostedServiceAuthErrorCode;

export type HostedServiceAuthenticatedRequest = {
  authToken: string;
  userId: string;
};

export type HostedServiceJwtError = {
  statusCode: number;
  errorCode: HostedServiceAuthErrorCode;
  message: string;
};

export type HostedServiceJwtResult =
  | { success: true; userId: string; email: string; token: string }
  | { success: false; error: HostedServiceJwtError };

export type HostedServiceProjectAccessError = {
  statusCode: number;
  errorCode: HostedServiceAuthErrorCode;
  message: string;
};

export type HostedServiceProjectAccessResult =
  | { success: true; projectId: string }
  | { success: false; error: HostedServiceProjectAccessError };

export type HostedServiceAuthConfig = {
  OAUTH_PUBLIC_KEY?: string | null;
  NODE_ENV?: string | null;
  VERYFRONT_API_URL: string;
};

export type HostedServiceAuthLogger = {
  debug?: (message: string, metadata?: Record<string, unknown>) => void;
  error?: (message: string, metadata?: Record<string, unknown>) => void;
};

export type HostedServiceAuthTrace = <TResult>(
  operationName: string,
  operation: () => Promise<TResult>,
) => Promise<TResult>;

export type HostedServiceAuthFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type HostedServiceAuthOptions = {
  getConfig: () => HostedServiceAuthConfig;
  logger?: HostedServiceAuthLogger;
  trace?: HostedServiceAuthTrace;
  fetch?: HostedServiceAuthFetch;
  projectAccessTimeoutMs?: number;
};

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
export type AgentServiceAuthConfig = HostedServiceAuthConfig;
export type AgentServiceAuthLogger = HostedServiceAuthLogger;
export type AgentServiceAuthTrace = HostedServiceAuthTrace;
export type AgentServiceAuthFetch = HostedServiceAuthFetch;
export type AgentServiceAuthOptions = HostedServiceAuthOptions;
export type AgentServiceAuth = HostedServiceAuth;

let cachedPublicKeyInput: string | undefined;
let cachedPublicKeyPromise: Promise<KeyLike> | undefined;

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

function getPublicKey(publicKeyInput: string): Promise<KeyLike> {
  if (cachedPublicKeyInput !== publicKeyInput || !cachedPublicKeyPromise) {
    cachedPublicKeyInput = publicKeyInput;
    cachedPublicKeyPromise = importSPKI(publicKeyInput, "RS256");
  }

  return cachedPublicKeyPromise;
}

export function getHostedServiceTokenFromRequest(request: Request): string | null {
  const cookies = request.headers.get("cookie") || "";
  const cookieMatch = cookies.match(/(?:^|;\s*)authToken=([^;]+)/);
  if (cookieMatch?.[1]) return cookieMatch[1];

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);

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
    throw new Error("Base64URL decoding is not available in this runtime");
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
        const publicKey = await getPublicKey(config.OAUTH_PUBLIC_KEY);
        const { payload } = await jwtVerify(token, publicKey, {
          algorithms: ["RS256"],
        });

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
