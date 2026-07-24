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
    kind: "ambiguous";
  }>;

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
    return Promise.resolve(this.rejectAmbiguousAuth(req, ctx));
  }

  private resolveAuth(ctx: HandlerContext): ResolvedAuth | null {
    const authConfig = ctx.securityConfig?.auth as AuthConfig | undefined;

    if (authConfig?.basic) {
      const { username, password } = authConfig.basic;
      if (!username || !password) return null;
      return Object.freeze({
        kind: "basic",
        username,
        password,
        realm: sanitizeRealm(authConfig.basic.realm || "Secure Area"),
      });
    }

    if (authConfig?.bearer) {
      return authConfig.bearer.token
        ? Object.freeze({ kind: "bearer", token: authConfig.bearer.token })
        : null;
    }

    // `__vfTestEnv` lets the test harness skip env-var credential loading so
    // tests run without auth. It must NEVER short-circuit auth in production:
    // guard it behind the environment check so a stray/injected global can't
    // silently disable authentication on a live deployment.
    if (!isProduction() && (globalThis as Record<string, unknown>).__vfTestEnv === true) {
      return null;
    }

    const username = ctx.adapter.env.get("VERYFRONT_BASIC_USER") ?? "";
    const password = ctx.adapter.env.get("VERYFRONT_BASIC_PASS") ?? "";
    const token = ctx.adapter.env.get("VERYFRONT_BEARER_TOKEN") ?? "";
    if (username && password && token) {
      return Object.freeze({ kind: "ambiguous" });
    }
    if (username && password) {
      return Object.freeze({
        kind: "basic",
        username,
        password,
        realm: "Secure Area",
      });
    }

    return token ? Object.freeze({ kind: "bearer", token }) : null;
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

  private rejectAmbiguousAuth(req: Request, ctx: HandlerContext): HandlerResult {
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
