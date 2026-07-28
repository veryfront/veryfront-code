import { BaseHandler } from "./base-handler.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "#veryfront/types";
import type { AuthConfig } from "./middleware/types.ts";
import { encodeBase64 } from "#veryfront/utils";
import { constantTimeEqual } from "../utils/constant-time.ts";
import { isProduction } from "#veryfront/platform/environment.ts";

function sanitizeRealm(realm: unknown): string {
  const type = typeof realm;
  const value = type === "string" ||
      type === "number" ||
      type === "bigint" ||
      type === "boolean" ||
      type === "symbol"
    ? String(realm)
    : "Secure Area";

  // deno-lint-ignore no-control-regex -- intentional: strips control chars and special chars from HTTP realm header
  return value.replace(/[\x00-\x1f\x7f"\\]/g, "");
}

type ResolvedAuth =
  | Readonly<{
    kind: "basic";
    username: string;
    password: string;
    realm: string;
  }>
  | Readonly<{
    kind: "bearer";
    token: string;
  }>
  | Readonly<{
    kind: "invalid";
  }>;

const INVALID_AUTH = Object.freeze({ kind: "invalid" } as const);
const AUTH_CONFIG_KEYS = new Set(["basic", "bearer"]);
const BASIC_AUTH_CONFIG_KEYS = new Set(["username", "password", "realm"]);
const BEARER_AUTH_CONFIG_KEYS = new Set(["token"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function resolveConfiguredAuth(value: unknown): ResolvedAuth {
  try {
    if (!isRecord(value) || !hasOnlyKeys(value, AUTH_CONFIG_KEYS)) {
      return INVALID_AUTH;
    }

    const hasBasic = Object.hasOwn(value, "basic");
    const hasBearer = Object.hasOwn(value, "bearer");
    if (hasBasic === hasBearer) return INVALID_AUTH;

    if (hasBasic) {
      const basic = value.basic;
      if (
        !isRecord(basic) ||
        !hasOnlyKeys(basic, BASIC_AUTH_CONFIG_KEYS) ||
        !Object.hasOwn(basic, "username") ||
        !Object.hasOwn(basic, "password") ||
        typeof basic.username !== "string" ||
        basic.username.length === 0 ||
        typeof basic.password !== "string" ||
        basic.password.length === 0
      ) {
        return INVALID_AUTH;
      }

      return Object.freeze({
        kind: "basic",
        username: basic.username,
        password: basic.password,
        realm: sanitizeRealm(basic.realm || "Secure Area"),
      });
    }

    const bearer = value.bearer;
    if (
      !isRecord(bearer) ||
      !hasOnlyKeys(bearer, BEARER_AUTH_CONFIG_KEYS) ||
      !Object.hasOwn(bearer, "token") ||
      typeof bearer.token !== "string" ||
      bearer.token.length === 0
    ) {
      return INVALID_AUTH;
    }

    return Object.freeze({ kind: "bearer", token: bearer.token });
  } catch {
    // Treat hostile accessors and proxies as malformed configuration. The
    // rejection path is intentionally generic so credentials never leak.
    return INVALID_AUTH;
  }
}

export class AuthHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "AuthHandler",
    priority: 0 as HandlerPriority, // CRITICAL priority - runs first
    patterns: [], // Checks all requests
  };

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (req.method.toUpperCase() === "OPTIONS") return Promise.resolve(this.continue());

    const auth = this.resolveAuth(ctx);
    if (!auth) return Promise.resolve(this.continue());

    if (auth.kind === "basic") {
      return Promise.resolve(this.checkBasicAuth(req, ctx, auth));
    }
    if (auth.kind === "bearer") {
      return Promise.resolve(this.checkBearerAuth(req, ctx, auth));
    }
    return Promise.resolve(this.rejectInvalidAuth(req, ctx));
  }

  private resolveAuth(ctx: HandlerContext): ResolvedAuth | null {
    try {
      if (
        ctx.securityConfig &&
        (
          Object.hasOwn(ctx.securityConfig, "auth") ||
          (ctx.securityConfig.auth as AuthConfig | undefined) !== undefined
        )
      ) {
        return resolveConfiguredAuth(ctx.securityConfig.auth);
      }
    } catch {
      return INVALID_AUTH;
    }

    // `__vfTestEnv` lets the test harness skip env-var credential loading so
    // tests run without auth. It must NEVER short-circuit auth in production:
    // guard it behind the environment check so a stray/injected global can't
    // silently disable authentication on a live deployment.
    if (!isProduction() && (globalThis as Record<string, unknown>).__vfTestEnv === true) {
      return null;
    }

    const username: unknown = ctx.adapter.env.get("VERYFRONT_BASIC_USER");
    const password: unknown = ctx.adapter.env.get("VERYFRONT_BASIC_PASS");
    const token: unknown = ctx.adapter.env.get("VERYFRONT_BEARER_TOKEN");
    const hasUsername = username !== undefined;
    const hasPassword = password !== undefined;
    const hasToken = token !== undefined;

    if (!hasUsername && !hasPassword && !hasToken) return null;

    if (
      hasUsername &&
      hasPassword &&
      !hasToken &&
      typeof username === "string" &&
      username.length > 0 &&
      typeof password === "string" &&
      password.length > 0
    ) {
      return Object.freeze({
        kind: "basic",
        username,
        password,
        realm: "Secure Area",
      });
    }

    if (
      !hasUsername &&
      !hasPassword &&
      hasToken &&
      typeof token === "string" &&
      token.length > 0
    ) {
      return Object.freeze({ kind: "bearer", token });
    }

    return INVALID_AUTH;
  }

  private checkBasicAuth(
    req: Request,
    ctx: HandlerContext,
    authConfig: Extract<ResolvedAuth, { kind: "basic" }>,
  ): HandlerResult {
    const expected = `Basic ${encodeBase64(`${authConfig.username}:${authConfig.password}`)}`;
    const auth = req.headers.get("authorization") ?? "";

    if (constantTimeEqual(auth, expected)) return this.continue();

    return this.respond(
      this.createResponseBuilder(ctx)
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined, req)
        .withCache("no-store")
        .withHeaders({ "WWW-Authenticate": `Basic realm="${authConfig.realm}"` })
        .text("Unauthorized", 401),
    );
  }

  private checkBearerAuth(
    req: Request,
    ctx: HandlerContext,
    authConfig: Extract<ResolvedAuth, { kind: "bearer" }>,
  ): HandlerResult {
    const auth = req.headers.get("authorization") ?? "";

    if (auth.startsWith("Bearer ") && constantTimeEqual(auth.slice(7), authConfig.token)) {
      return this.continue();
    }

    return this.respond(
      this.createResponseBuilder(ctx)
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined, req)
        .withCache("no-store")
        .withHeaders({ "WWW-Authenticate": "Bearer" })
        .text("Unauthorized", 401),
    );
  }

  private rejectInvalidAuth(req: Request, ctx: HandlerContext): HandlerResult {
    return this.respond(
      this.createResponseBuilder(ctx)
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined, req)
        .withCache("no-store")
        .withHeaders({
          "WWW-Authenticate": 'Basic realm="Secure Area", Bearer',
        })
        .text("Unauthorized", 401),
    );
  }
}
