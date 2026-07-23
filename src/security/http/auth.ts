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
  // deno-lint-ignore no-control-regex -- intentional: strips control chars and special chars from HTTP realm header
  return String(realm).replace(/[\x00-\x1f\x7f"\\]/g, "");
}

export class AuthHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "AuthHandler",
    priority: 0 as HandlerPriority, // CRITICAL priority - runs first
    patterns: [], // Checks all requests
  };

  private basicUser: string | null = null;
  private basicPass: string | null = null;
  private basicRealm = "Secure Area";
  private bearerToken: string | null = null;

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    this.loadAuthConfig(ctx);

    if (req.method.toUpperCase() === "OPTIONS") return Promise.resolve(this.continue());

    const basicResult = this.shouldUseBasic() ? this.checkBasicAuth(req) : null;
    if (basicResult) return Promise.resolve(basicResult);

    const bearerResult = this.shouldUseBearer() ? this.checkBearerAuth(req) : null;
    if (bearerResult) return Promise.resolve(bearerResult);

    return Promise.resolve(this.continue());
  }

  private loadAuthConfig(ctx: HandlerContext): void {
    // Reset per-request auth state to avoid leaking config across requests.
    this.basicUser = null;
    this.basicPass = null;
    this.basicRealm = "Secure Area";
    this.bearerToken = null;

    const authConfig = ctx.securityConfig?.auth as AuthConfig | undefined;

    if (authConfig?.basic) {
      this.basicUser = authConfig.basic.username;
      this.basicPass = authConfig.basic.password;
      this.basicRealm = sanitizeRealm(authConfig.basic.realm || "Secure Area");
      return;
    }

    if (authConfig?.bearer) {
      this.bearerToken = authConfig.bearer.token;
      return;
    }

    // `__vfTestEnv` lets the test harness skip env-var credential loading so
    // tests run without auth. It must NEVER short-circuit auth in production:
    // guard it behind the environment check so a stray/injected global can't
    // silently disable authentication on a live deployment.
    if (!isProduction() && (globalThis as Record<string, unknown>).__vfTestEnv === true) return;

    this.basicUser = ctx.adapter.env.get("VERYFRONT_BASIC_USER") ?? "";
    this.basicPass = ctx.adapter.env.get("VERYFRONT_BASIC_PASS") ?? "";
    this.bearerToken = ctx.adapter.env.get("VERYFRONT_BEARER_TOKEN") ?? "";
  }

  private shouldUseBasic(): boolean {
    return Boolean(this.basicUser && this.basicPass);
  }

  private shouldUseBearer(): boolean {
    return Boolean(this.bearerToken);
  }

  private checkBasicAuth(req: Request): HandlerResult | null {
    const expected = `Basic ${encodeBase64(`${this.basicUser}:${this.basicPass}`)}`;
    const auth = req.headers.get("authorization") ?? "";

    if (constantTimeEqual(auth, expected)) return null;

    return this.respond(
      new Response("Unauthorized", {
        status: 401,
        headers: { "WWW-Authenticate": `Basic realm="${this.basicRealm}"` },
      }),
    );
  }

  private checkBearerAuth(req: Request): HandlerResult | null {
    const auth = req.headers.get("authorization") ?? "";

    if (auth.startsWith("Bearer ") && constantTimeEqual(auth.slice(7), this.bearerToken ?? "")) {
      return null;
    }

    return this.respond(new Response("Unauthorized", { status: 401 }));
  }
}
