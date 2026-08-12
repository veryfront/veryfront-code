import { isCspReportRequest } from "#veryfront/security/http/csp-report-endpoint.ts";
import { isSignedControlPlaneDispatch } from "#veryfront/channels/control-plane.ts";
import { BaseHandler } from "./base-handler.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "#veryfront/types";
import { encodeBase64 } from "#veryfront/utils";
import { constantTimeEqual } from "../utils/constant-time.ts";

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

function snapshotOwnDataRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
): Readonly<Record<string, unknown>> | null {
  if (!isRecord(value)) return null;

  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;

    const keys = Reflect.ownKeys(value);
    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      if (typeof key !== "string" || !allowedKeys.has(key)) return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) return null;
      Object.defineProperty(snapshot, key, {
        enumerable: true,
        value: descriptor.value,
      });
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

type ExplicitAuth =
  | Readonly<{ state: "absent" }>
  | Readonly<{ state: "present"; value: unknown }>
  | Readonly<{ state: "invalid" }>;

const ABSENT_AUTH = Object.freeze({ state: "absent" } as const);
const INVALID_EXPLICIT_AUTH = Object.freeze({ state: "invalid" } as const);

function readExplicitAuth(securityConfig: unknown): ExplicitAuth {
  if (securityConfig === null || securityConfig === undefined) return ABSENT_AUTH;
  if (!isRecord(securityConfig)) return INVALID_EXPLICIT_AUTH;

  try {
    const descriptor = Object.getOwnPropertyDescriptor(securityConfig, "auth");
    if (descriptor) {
      return "value" in descriptor
        ? Object.freeze({ state: "present", value: descriptor.value })
        : INVALID_EXPLICIT_AUTH;
    }

    const visited = new Set<object>();
    let prototype = Object.getPrototypeOf(securityConfig);
    for (let depth = 0; prototype !== null && depth < 64; depth++) {
      if (visited.has(prototype)) return INVALID_EXPLICIT_AUTH;
      visited.add(prototype);
      if (Object.getOwnPropertyDescriptor(prototype, "auth")) {
        return INVALID_EXPLICIT_AUTH;
      }
      prototype = Object.getPrototypeOf(prototype);
    }
    return prototype === null ? ABSENT_AUTH : INVALID_EXPLICIT_AUTH;
  } catch {
    return INVALID_EXPLICIT_AUTH;
  }
}

function resolveConfiguredAuth(value: unknown): ResolvedAuth {
  const auth = snapshotOwnDataRecord(value, AUTH_CONFIG_KEYS);
  if (!auth) return INVALID_AUTH;

  const hasBasic = Object.hasOwn(auth, "basic");
  const hasBearer = Object.hasOwn(auth, "bearer");
  if (hasBasic === hasBearer) return INVALID_AUTH;

  if (hasBasic) {
    const basic = snapshotOwnDataRecord(auth.basic, BASIC_AUTH_CONFIG_KEYS);
    if (
      !basic ||
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

  const bearer = snapshotOwnDataRecord(auth.bearer, BEARER_AUTH_CONFIG_KEYS);
  if (
    !bearer ||
    !Object.hasOwn(bearer, "token") ||
    typeof bearer.token !== "string" ||
    bearer.token.length === 0
  ) {
    return INVALID_AUTH;
  }

  return Object.freeze({ kind: "bearer", token: bearer.token });
}

export class AuthHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "AuthHandler",
    priority: 0 as HandlerPriority, // CRITICAL priority - runs first
    patterns: [], // Checks all requests
  };

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (req.method.toUpperCase() === "OPTIONS") return Promise.resolve(this.continue());

    // Same reasoning as the CSRF gate: a browser reports a violation without
    // credentials, so a protected project would collect nothing. See
    // `isCspReportRequest` for why exempting it discloses nothing.
    if (isCspReportRequest(req.method, new URL(req.url).pathname)) {
      return Promise.resolve(this.continue());
    }

    // A control-plane dispatch is not a site visitor. Run execute/stream/resume
    // /cancel and agent listing arrive from the platform carrying a signed
    // operation envelope, verified before the receiving handler acts on it. The
    // platform cannot hold the credential this gate demands: it sends a
    // per-run service `Bearer` JWT the Basic branch can never match, and the
    // Bearer branch compares against a secret the project authored. Challenging
    // it protects nothing and instead kills the run — 401 is not retryable, so
    // the release asset manifest row is never created and `deploy` fails at its
    // 120s deadline naming neither auth nor config. Studio's agent listing 401s
    // the same way, on a call that sends no `Authorization` header at all.
    //
    // The exemption is keyed on the request being a real dispatch, not on it
    // being path-shaped like one: `isSignedControlPlaneDispatch` requires both a
    // method/path pair that a control-plane handler owns and the signature
    // header that handler verifies. The `/api/control-plane/` namespace is
    // reserved but not exclusively routed, so a project App or Pages API route
    // can sit under it in a custom runtime; such a route is not a registered
    // surface and keeps its auth gate.
    //
    // This sits ahead of `resolveAuth` for the same reason the CSP report
    // exemption does: an auth config the runtime cannot resolve still fails
    // closed for every browser request, but a project's config typo must not
    // brick the platform's own dispatch, which authenticates itself downstream.
    if (isSignedControlPlaneDispatch(req)) return Promise.resolve(this.continue());

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
    const explicitAuth = readExplicitAuth(ctx.securityConfig);
    if (explicitAuth.state === "invalid") return INVALID_AUTH;
    if (explicitAuth.state === "present") return resolveConfiguredAuth(explicitAuth.value);

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
