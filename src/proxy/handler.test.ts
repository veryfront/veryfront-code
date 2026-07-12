import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { createMockServer } from "../../tests/_helpers/utils.ts";
import {
  __resetCachedAuthProviderForTests,
  createProxyHandler,
  injectContextHeaders,
  type ProxyContext,
} from "./handler.ts";
import { register, reset } from "../extensions/contracts.ts";
import type { AuthProvider, TokenHeader, TokenPayload } from "../extensions/auth/index.ts";

const TEST_JWT_SECRET = "test-jwt-secret-for-proxy-handler-tests";

// Set JWT_SECRET so extractUserIdFromToken can verify tokens
Deno.env.set("JWT_SECRET", TEST_JWT_SECRET);

/**
 * In-memory AuthProvider used by the proxy tests.
 *
 * Implements a minimum surface: HS256 sign/verify via a registered secret,
 * `verifyWithJwks` that dispatches to an in-memory JWKS-URL -> payload map,
 * and a tolerant `decode` that returns `undefined` on malformed input.
 *
 * The fakeness of the tokens is deliberate: they're base64url-encoded JSON
 * with a trivial HMAC stand-in, which keeps the tests fast and independent
 * of `jose`.
 */
interface MockAuthOptions {
  /** Map from jwksUrl -> (token -> payload) for verifyWithJwks. */
  jwksVerifiers?: Map<string, Map<string, TokenPayload>>;
  /** Override the expected HMAC secret for HS256 verify. */
  secret?: string;
}

function base64url(data: string): string {
  return btoa(data).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str: string): string {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (str.length % 4)) % 4);
  return atob(padded);
}

async function hmacSha(alg: "HS256" | "HS384", secret: string, data: string): Promise<string> {
  const hashName = alg === "HS256" ? "SHA-256" : "SHA-384";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: hashName },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return base64url(String.fromCharCode(...new Uint8Array(sig)));
}

/**
 * Sign a minimal JWT using HS256/HS384 for tests. Matches the shape produced
 * by `jose` closely enough that the mock AuthProvider's `verify` can round-trip.
 */
export async function signTestJwt(
  payload: Record<string, unknown>,
  alg: "HS256" | "HS384" = "HS256",
  secret: string = TEST_JWT_SECRET,
  kid?: string,
): Promise<string> {
  const header: Record<string, unknown> = { alg, typ: "JWT" };
  if (kid) header.kid = kid;
  const now = Math.floor(Date.now() / 1000);
  const body = { iat: now, exp: now + 3600, ...payload };
  const h = base64url(JSON.stringify(header));
  const b = base64url(JSON.stringify(body));
  const sig = await hmacSha(alg, secret, `${h}.${b}`);
  return `${h}.${b}.${sig}`;
}

function encodePem(label: string, der: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

function base64urlBytes(bytes: Uint8Array): string {
  return base64url(String.fromCharCode(...bytes));
}

/**
 * Mint a valid, freshly-signed control-plane JWS and export the matching
 * public key PEM. Used to exercise the proxy's cryptographic verification of
 * internal control-plane requests (isVerifiedInternalControlPlaneRequest).
 */
async function mintControlPlaneJws(
  overrides: Partial<{ iss: string; iat: number; exp: number }> = {},
): Promise<{ jws: string; publicKeyPem: string }> {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]) as CryptoKeyPair;
  const der = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const publicKeyPem = encodePem("PUBLIC KEY", der);

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "EdDSA", typ: "JWT" };
  const claims = {
    iss: overrides.iss ?? "veryfront-api",
    aud: "protected-project",
    sub: "control-plane",
    surface: "channels",
    project_id: "proj-123",
    request_hash: "n/a",
    iat: overrides.iat ?? now,
    exp: overrides.exp ?? now + 60,
  };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(claims));
  const signingInput = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const signature = await crypto.subtle.sign("Ed25519", keyPair.privateKey, signingInput);
  return {
    publicKeyPem,
    jws: `${encodedHeader}.${encodedPayload}.${base64urlBytes(new Uint8Array(signature))}`,
  };
}

function createMockAuthProvider(options: MockAuthOptions = {}): AuthProvider {
  const secret = options.secret ?? TEST_JWT_SECRET;
  const jwksVerifiers = options.jwksVerifiers ?? new Map();

  return {
    sign(payload: TokenPayload): Promise<string> {
      return signTestJwt(payload as Record<string, unknown>, "HS256", secret);
    },
    async verify(token: string, opts): Promise<TokenPayload> {
      const parts = token.split(".");
      if (parts.length !== 3) throw new Error("Malformed token");
      const header = JSON.parse(base64urlDecode(parts[0]!)) as { alg?: string };
      const body = JSON.parse(base64urlDecode(parts[1]!)) as TokenPayload;
      const alg = header.alg ?? "";
      const allowed = opts?.algorithms ?? ["HS256"];
      if (!allowed.includes(alg)) throw new Error(`Unexpected alg: ${alg}`);

      // Attempt to verify against the env secret as well as the configured
      // one. When the handler calls verify() during tests that deleted
      // JWT_SECRET, we must still reject on mismatch.
      const envSecret = Deno.env.get("JWT_SECRET");
      const expected = await hmacSha(
        alg as "HS256" | "HS384",
        envSecret ?? secret,
        `${parts[0]}.${parts[1]}`,
      );
      if (parts[2] !== expected) throw new Error("Invalid signature");

      if (typeof body.exp === "number" && body.exp < Math.floor(Date.now() / 1000)) {
        throw new Error("Token expired");
      }
      return body;
    },
    async verifyWithJwks(token, jwksUrl): Promise<TokenPayload> {
      const forUrl = jwksVerifiers.get(jwksUrl);
      if (!forUrl) throw new Error(`No JWKS registered for ${jwksUrl}`);
      const payload = forUrl.get(token);
      if (!payload) throw new Error("Token not recognized by JWKS");
      return payload;
    },
    verifyWithPublicKey(): Promise<TokenPayload> {
      return Promise.reject(new Error("Public key verification not configured"));
    },
    decode(token: string): TokenHeader | undefined {
      const parts = token.split(".");
      if (parts.length !== 3) return undefined;
      try {
        return JSON.parse(base64urlDecode(parts[0]!)) as TokenHeader;
      } catch {
        return undefined;
      }
    },
  };
}

function createTokenResponse(): Response {
  return Response.json({
    access_token: "test-token",
    token_type: "Bearer",
    expires_in: 3600,
  });
}

function createNotFoundResponse(): Response {
  return new Response("Not found", { status: 404 });
}

function createHandler(port: number, apiBasePath = "") {
  return createProxyHandler({
    config: {
      apiBaseUrl: `http://127.0.0.1:${port}${apiBasePath}`,
      apiClientId: "test-client",
      apiClientSecret: "test-secret",
      previewApiClientId: "test-client",
      previewApiClientSecret: "test-secret",
    },
  });
}

function createRecordingLogger() {
  const entries: Array<{
    level: "debug" | "info" | "warn" | "error";
    message: string;
    extra?: Record<string, unknown>;
  }> = [];

  return {
    entries,
    logger: {
      debug(message: string, extra?: Record<string, unknown>) {
        entries.push({ level: "debug", message, extra });
      },
      info(message: string, extra?: Record<string, unknown>) {
        entries.push({ level: "info", message, extra });
      },
      warn(message: string, extra?: Record<string, unknown>) {
        entries.push({ level: "warn", message, extra });
      },
      error(message: string, _error?: Error, extra?: Record<string, unknown>) {
        entries.push({ level: "error", message, extra });
      },
    },
  };
}

/** Per-test JWKS store so tests can register RS256 tokens by URL. */
const jwksVerifiers = new Map<string, Map<string, TokenPayload>>();

function registerRs256Token(jwksUrl: string, token: string, payload: TokenPayload): void {
  let byToken = jwksVerifiers.get(jwksUrl);
  if (!byToken) {
    byToken = new Map();
    jwksVerifiers.set(jwksUrl, byToken);
  }
  byToken.set(token, payload);
}

function forgeRs256Token(kid: string, userId: string): string {
  const header = base64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const body = base64url(JSON.stringify({
    userId,
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  // Signature intentionally opaque — the mock verifier looks up (url, token)
  // pairs, so the bytes here just need to be unique per token.
  const sig = base64url(`sig-${kid}-${userId}-${Math.random()}`);
  return `${header}.${body}.${sig}`;
}

beforeEach(() => {
  reset();
  __resetCachedAuthProviderForTests();
  jwksVerifiers.clear();
  register<AuthProvider>("AuthProvider", createMockAuthProvider({ jwksVerifiers }));
});

afterEach(() => {
  reset();
  __resetCachedAuthProviderForTests();
});

describe("Proxy Handler", () => {
  it("uses a pre-parsed request URL when provided", async () => {
    const handler = createProxyHandler({
      config: {
        apiBaseUrl: "http://127.0.0.1:9",
        apiClientId: "",
        apiClientSecret: "",
        previewApiClientId: "",
        previewApiClientSecret: "",
      },
    });
    const req = new Request("http://test-project.preview.veryfront.com/blog", {
      headers: { host: "test-project.preview.veryfront.com" },
    });
    const url = new URL(req.url);
    const originalUrl = globalThis.URL;

    try {
      Object.defineProperty(globalThis, "URL", {
        configurable: true,
        value: class URLShouldNotBeCalled {
          constructor() {
            throw new Error("processRequest reparsed req.url");
          }
        },
      });

      const ctx = await handler.processRequest(req, { url });

      assertEquals(ctx.host, "test-project.preview.veryfront.com");
      assertEquals(ctx.error?.status, 502);
    } finally {
      Object.defineProperty(globalThis, "URL", {
        configurable: true,
        value: originalUrl,
      });
      await handler.close();
    }
  });

  describe("processRequest with custom domains", () => {
    it("resolves project slug for custom domain via domain lookup", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "my-project",
            name: "My Project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["example.com"],
              active_release_id: "rel-123",
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://example.com/page", {
          headers: { host: "example.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.projectSlug, "my-project");
        assertEquals(ctx.error, undefined);
        assertEquals(ctx.token, "test-token");

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("caches custom domain routing metadata but fetches access metadata on each request", async () => {
      let routingLookups = 0;
      let accessLookups = 0;
      let fullProjectLookups = 0;
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/-/proxy-routing/")) {
          routingLookups++;
          return Response.json({
            id: "proj-123",
            slug: "my-project",
            name: "My Project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["example.com"],
              active_release_id: "rel-123",
            }],
          });
        }

        if (pathname.startsWith("/projects/-/proxy-access/")) {
          accessLookups++;
          return Response.json({
            id: "proj-123",
            slug: "my-project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["example.com"],
              protected: false,
            }],
          });
        }

        if (pathname.startsWith("/projects/")) {
          fullProjectLookups++;
          return Response.json({
            id: "proj-123",
            slug: "my-project",
            name: "My Project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["example.com"],
              active_release_id: "rel-123",
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);
        const req = () =>
          new Request("http://example.com/page", {
            headers: { host: "example.com" },
          });

        const first = await handler.processRequest(req());
        const second = await handler.processRequest(req());

        assertEquals(first.error, undefined);
        assertEquals(second.error, undefined);
        assertEquals(first.projectSlug, "my-project");
        assertEquals(second.projectSlug, "my-project");
        assertEquals(routingLookups, 1);
        assertEquals(accessLookups, 2);
        assertEquals(fullProjectLookups, 0);

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("refreshes cached service token and retries when proxy metadata rejects it", async () => {
      const { entries, logger } = createRecordingLogger();
      let tokenRequests = 0;
      let routingLookups = 0;
      let accessLookups = 0;
      let fullProjectLookups = 0;
      const authorizationHeaders: string[] = [];

      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") {
          tokenRequests++;
          return Response.json({
            access_token: tokenRequests === 1 ? "stale-token" : "fresh-token",
            token_type: "Bearer",
            expires_in: 3600,
          });
        }

        if (pathname.startsWith("/projects/-/proxy-routing/")) {
          routingLookups++;
          authorizationHeaders.push(req.headers.get("authorization") ?? "");
          if (req.headers.get("authorization") === "Bearer stale-token") {
            return new Response("Unauthorized", { status: 401 });
          }

          return Response.json({
            id: "proj-123",
            slug: "my-project",
            name: "My Project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["example.com"],
              active_release_id: "rel-123",
            }],
          });
        }

        if (pathname.startsWith("/projects/-/proxy-access/")) {
          accessLookups++;
          authorizationHeaders.push(req.headers.get("authorization") ?? "");
          if (req.headers.get("authorization") === "Bearer stale-token") {
            return new Response("Unauthorized", { status: 401 });
          }

          return Response.json({
            id: "proj-123",
            slug: "my-project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["example.com"],
              protected: false,
            }],
          });
        }

        if (pathname.startsWith("/projects/")) {
          fullProjectLookups++;
          authorizationHeaders.push(req.headers.get("authorization") ?? "");
          if (req.headers.get("authorization") === "Bearer stale-token") {
            return new Response("Unauthorized", { status: 401 });
          }

          return Response.json({
            id: "proj-123",
            slug: "my-project",
            name: "My Project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["example.com"],
              active_release_id: "rel-123",
              protected: false,
            }],
          });
        }

        return createNotFoundResponse();
      });

      let handler: ReturnType<typeof createProxyHandler> | undefined;
      try {
        handler = createProxyHandler({
          config: {
            apiBaseUrl: `http://127.0.0.1:${port}`,
            apiClientId: "test-client",
            apiClientSecret: "test-secret",
            previewApiClientId: "test-client",
            previewApiClientSecret: "test-secret",
          },
          logger,
        });

        const ctx = await handler.processRequest(
          new Request("http://example.com/page", {
            headers: { host: "example.com" },
          }),
        );

        assertEquals(ctx.error, undefined);
        assertEquals(ctx.projectSlug, "my-project");
        assertEquals(ctx.releaseId, "rel-123");
        assertEquals(ctx.token, "fresh-token");
        assertEquals(tokenRequests, 2);
        assertEquals(routingLookups, 2);
        assertEquals(accessLookups, 1);
        assertEquals(fullProjectLookups, 0);
        assertEquals(authorizationHeaders, [
          "Bearer stale-token",
          "Bearer fresh-token",
          "Bearer fresh-token",
        ]);
        assertEquals(
          entries.some((entry) =>
            entry.level === "warn" &&
            entry.message === "Proxy API token rejected during metadata lookup; refreshing token"
          ),
          true,
        );
      } finally {
        await handler?.close();
        await server.shutdown();
      }
    });

    it("refreshes cached service token when proxy access metadata rejects it", async () => {
      let tokenRequests = 0;
      let routingLookups = 0;
      let accessLookups = 0;

      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") {
          tokenRequests++;
          return Response.json({
            access_token: tokenRequests === 1 ? "stale-token" : "fresh-token",
            token_type: "Bearer",
            expires_in: 3600,
          });
        }

        if (pathname.startsWith("/projects/-/proxy-routing/")) {
          routingLookups++;
          return Response.json({
            id: "proj-123",
            slug: "my-project",
            name: "My Project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["example.com"],
              active_release_id: "rel-123",
            }],
          });
        }

        if (pathname.startsWith("/projects/-/proxy-access/")) {
          accessLookups++;
          if (req.headers.get("authorization") === "Bearer stale-token") {
            return new Response("Unauthorized", { status: 401 });
          }

          return Response.json({
            id: "proj-123",
            slug: "my-project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["example.com"],
              protected: false,
            }],
          });
        }

        return createNotFoundResponse();
      });

      let handler: ReturnType<typeof createProxyHandler> | undefined;
      try {
        handler = createHandler(port);

        const ctx = await handler.processRequest(
          new Request("http://example.com/page", {
            headers: { host: "example.com" },
          }),
        );

        assertEquals(ctx.error, undefined);
        assertEquals(ctx.projectSlug, "my-project");
        assertEquals(ctx.releaseId, "rel-123");
        assertEquals(ctx.token, "fresh-token");
        assertEquals(tokenRequests, 2);
        assertEquals(routingLookups, 2);
        assertEquals(accessLookups, 2);
      } finally {
        await handler?.close();
        await server.shutdown();
      }
    });

    it("refreshes cached service token when fallback domain lookup rejects it", async () => {
      let tokenRequests = 0;
      let routingLookups = 0;
      let fullProjectLookups = 0;

      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") {
          tokenRequests++;
          return Response.json({
            access_token: tokenRequests === 1 ? "stale-token" : "fresh-token",
            token_type: "Bearer",
            expires_in: 3600,
          });
        }

        if (pathname.startsWith("/projects/-/proxy-routing/")) {
          routingLookups++;
          return createNotFoundResponse();
        }

        if (pathname.startsWith("/projects/")) {
          fullProjectLookups++;
          if (req.headers.get("authorization") === "Bearer stale-token") {
            return new Response("Unauthorized", { status: 401 });
          }

          return Response.json({
            id: "proj-123",
            slug: "my-project",
            name: "My Project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["example.com"],
              active_release_id: "rel-123",
              protected: false,
            }],
          });
        }

        return createNotFoundResponse();
      });

      let handler: ReturnType<typeof createProxyHandler> | undefined;
      try {
        handler = createHandler(port);

        const ctx = await handler.processRequest(
          new Request("http://example.com/page", {
            headers: { host: "example.com" },
          }),
        );

        assertEquals(ctx.error, undefined);
        assertEquals(ctx.projectSlug, "my-project");
        assertEquals(ctx.releaseId, "rel-123");
        assertEquals(ctx.token, "fresh-token");
        assertEquals(tokenRequests, 2);
        assertEquals(routingLookups, 2);
        assertEquals(fullProjectLookups, 2);
      } finally {
        await handler?.close();
        await server.shutdown();
      }
    });

    it("returns 502 when refreshed service token is still rejected by metadata", async () => {
      let tokenRequests = 0;
      let routingLookups = 0;

      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") {
          tokenRequests++;
          return Response.json({
            access_token: tokenRequests === 1 ? "stale-token" : "fresh-token",
            token_type: "Bearer",
            expires_in: 3600,
          });
        }

        if (pathname.startsWith("/projects/-/proxy-routing/")) {
          routingLookups++;
          return new Response("Unauthorized", { status: 401 });
        }

        return createNotFoundResponse();
      });

      let handler: ReturnType<typeof createProxyHandler> | undefined;
      try {
        handler = createHandler(port);

        const ctx = await handler.processRequest(
          new Request("http://example.com/page", {
            headers: { host: "example.com" },
          }),
        );

        assertEquals(ctx.error?.status, 502);
        assertEquals(ctx.error?.message, "Proxy API token rejected by API");
        assertEquals(ctx.token, "fresh-token");
        assertEquals(tokenRequests, 2);
        assertEquals(routingLookups, 2);
      } finally {
        await handler?.close();
        await server.shutdown();
      }
    });

    it("returns 404 error when custom domain not found", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();
        if (pathname.startsWith("/projects/")) return createNotFoundResponse();

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://unknown-domain.com/page", {
          headers: { host: "unknown-domain.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.projectSlug, undefined);
        assertEquals(ctx.error?.status, 404);
        assertEquals(
          ctx.error?.message,
          "No project configured for domain: unknown-domain.com",
        );

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("returns 502 error when no token available for custom domain", async () => {
      const handler = createProxyHandler({
        config: {
          apiBaseUrl: "http://localhost:9999",
          apiClientId: "",
          apiClientSecret: "",
          previewApiClientId: "",
          previewApiClientSecret: "",
        },
      });

      const req = new Request("http://custom-domain.com/page", {
        headers: { host: "custom-domain.com" },
      });

      const ctx = await handler.processRequest(req);

      assertEquals(ctx.projectSlug, undefined);
      assertEquals(ctx.error?.status, 502);
      assertEquals(
        ctx.error?.message,
        "Failed to authenticate for domain: custom-domain.com",
      );

      await handler.close();
    });

    // Regression test for the ai-chatbot.veryfront.com incident (#1054): bare
    // {slug}.veryfront.com is intentionally unsupported, so the handler treats it as a
    // custom domain, the token mint returns "Project not found for domain", and the
    // user previously saw a misleading 502. Must resolve to a clean 404.
    it("returns 404 when custom domain token mint reports no project for domain", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") {
          return new Response('{"error":"Project not found for domain"}', {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://ai-chatbot.veryfront.com/robots.txt", {
          headers: { host: "ai-chatbot.veryfront.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.projectSlug, undefined);
        assertEquals(ctx.error?.status, 404);
        assertEquals(
          ctx.error?.message,
          "No project configured for domain: ai-chatbot.veryfront.com",
        );

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    // Regression: studio.veryfront.com is an infra subdomain that doesn't map to a
    // project. The token mint returns 400 "Project not found for domain" — the proxy
    // must return a clean 404, not a misleading 502. (#1110)
    it("returns 404 for studio.veryfront.com when token mint rejects the domain", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") {
          return new Response('{"error":"Project not found for domain"}', {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        return createNotFoundResponse();
      });

      let handler: ReturnType<typeof createHandler> | undefined;
      try {
        handler = createHandler(port);

        const req = new Request("http://studio.veryfront.com/", {
          headers: { host: "studio.veryfront.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.projectSlug, undefined);
        assertEquals(ctx.error?.status, 404);
        assertEquals(
          ctx.error?.message,
          "No project configured for domain: studio.veryfront.com",
        );
      } finally {
        await handler?.close();
        await server.shutdown();
      }
    });

    it("returns 404 for managed production hosts when token mint reports no project for domain", async () => {
      const { entries, logger } = createRecordingLogger();
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") {
          return new Response('{"error":"Project not found for domain"}', {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        return createNotFoundResponse();
      });

      let handler: ReturnType<typeof createProxyHandler> | undefined;
      try {
        handler = createProxyHandler({
          config: {
            apiBaseUrl: `http://127.0.0.1:${port}`,
            apiClientId: "test-client",
            apiClientSecret: "test-secret",
            previewApiClientId: "test-client",
            previewApiClientSecret: "test-secret",
          },
          logger,
        });

        const req = new Request("http://stripe.production.veryfront.com/", {
          headers: { host: "stripe.production.veryfront.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.projectSlug, undefined);
        assertEquals(ctx.error?.status, 404);
        assertEquals(ctx.error?.message, "Project not found");
        assertEquals(
          entries.filter((entry) => entry.level === "error").map((entry) => entry.message),
          [],
        );
      } finally {
        await handler?.close();
        await server.shutdown();
      }
    });

    it("logs expected custom domain token-mint misses below error level", async () => {
      const { entries, logger } = createRecordingLogger();
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") {
          return new Response('{"error":"Project not found for domain"}', {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createProxyHandler({
          config: {
            apiBaseUrl: `http://127.0.0.1:${port}`,
            apiClientId: "test-client",
            apiClientSecret: "test-secret",
            previewApiClientId: "test-client",
            previewApiClientSecret: "test-secret",
          },
          logger,
        });

        const req = new Request("http://unknown-domain.com/page", {
          headers: { host: "unknown-domain.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 404);
        assertEquals(
          entries.filter((entry) => entry.level === "error").map((entry) => entry.message),
          [],
        );
        assertEquals(
          entries.some((entry) =>
            entry.level === "info" &&
            entry.message === "Custom domain project not found during token fetch"
          ),
          true,
        );

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("logs custom domains missing after lookup below error level", async () => {
      const { entries, logger } = createRecordingLogger();
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();
        if (pathname.startsWith("/projects/")) return createNotFoundResponse();

        return createNotFoundResponse();
      });

      try {
        const handler = createProxyHandler({
          config: {
            apiBaseUrl: `http://127.0.0.1:${port}`,
            apiClientId: "test-client",
            apiClientSecret: "test-secret",
            previewApiClientId: "test-client",
            previewApiClientSecret: "test-secret",
          },
          logger,
        });

        const req = new Request("http://unknown-domain.com/page", {
          headers: { host: "unknown-domain.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 404);
        assertEquals(
          entries.filter((entry) => entry.level === "error").map((entry) => entry.message),
          [],
        );
        assertEquals(
          entries.some((entry) =>
            entry.level === "info" && entry.message === "Custom domain not found"
          ),
          true,
        );

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("strips port from custom domain host before token fetch", async () => {
      const tokenRequests: string[] = [];
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") {
          const body = req.text().then((t) => JSON.parse(t));
          body.then((b) => {
            if (b.custom_domain) tokenRequests.push(b.custom_domain);
          });
          return createTokenResponse();
        }

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "fin-ops",
            name: "Fin Ops",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["fin-ops.ai"],
              active_release_id: "rel-123",
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://fin-ops.ai:443/page", {
          headers: { host: "fin-ops.ai:443" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.projectSlug, "fin-ops");
        assertEquals(ctx.error, undefined);
        assertEquals(tokenRequests.length > 0, true);
        assertEquals(tokenRequests[0], "fin-ops.ai");

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("extracts project slug from veryfront subdomain with static API token fallback", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "my-project",
            name: "My Project",
            environments: [{
              id: "env-1",
              name: "preview",
              active_release_id: null,
              protected: false,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createProxyHandler({
          config: {
            apiBaseUrl: `http://127.0.0.1:${port}`,
            apiClientId: "",
            apiClientSecret: "",
            previewApiClientId: "",
            previewApiClientSecret: "",
            apiToken: "fallback-token",
          },
        });

        const req = new Request("http://my-project.preview.veryfront.com/page", {
          headers: { host: "my-project.preview.veryfront.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.projectSlug, "my-project");
        assertEquals(ctx.projectId, "proj-123");
        assertEquals(ctx.error, undefined);
        assertEquals(ctx.token, "fallback-token");
        assertEquals(ctx.environment, "preview");

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("falls back to the request URL host when the Host header is absent", async () => {
      const handler = createProxyHandler({
        config: {
          apiBaseUrl: "http://localhost:9999",
          apiClientId: "",
          apiClientSecret: "",
          previewApiClientId: "",
          previewApiClientSecret: "",
          localProjects: {
            "my-project": ".",
          },
        },
      });

      const req = new Request("http://my-project.preview.lvh.me:3001/page");

      const ctx = await handler.processRequest(req);

      assertEquals(ctx.projectSlug, "my-project");
      assertEquals(ctx.environment, "preview");
      assertEquals(ctx.localPath, ".");
      assertEquals(ctx.error, undefined);

      await handler.close();
    });
  });

  describe("protected environments", () => {
    it("uses a service token for preview metadata when the request has a user cookie", async () => {
      let tokenRequests = 0;
      const metadataAuthorizationHeaders: string[] = [];

      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") {
          tokenRequests++;
          return Response.json({
            access_token: "preview-service-token",
            token_type: "Bearer",
            expires_in: 3600,
          });
        }

        if (pathname.startsWith("/projects/-/proxy-routing/")) {
          metadataAuthorizationHeaders.push(req.headers.get("authorization") ?? "");
          if (req.headers.get("authorization") === "Bearer user-cookie-token") {
            return new Response("Unauthorized", { status: 401 });
          }

          return Response.json({
            id: "proj-123",
            slug: "my-project",
            name: "My Project",
            environments: [{
              id: "env-1",
              name: "preview",
              active_release_id: null,
            }],
          });
        }

        if (pathname.startsWith("/projects/-/proxy-access/")) {
          metadataAuthorizationHeaders.push(req.headers.get("authorization") ?? "");
          if (req.headers.get("authorization") === "Bearer user-cookie-token") {
            return new Response("Unauthorized", { status: 401 });
          }

          return Response.json({
            id: "proj-123",
            slug: "my-project",
            environments: [{
              id: "env-1",
              name: "preview",
              protected: false,
            }],
          });
        }

        return createNotFoundResponse();
      });

      let handler: ReturnType<typeof createProxyHandler> | undefined;
      try {
        handler = createHandler(port);

        const ctx = await handler.processRequest(
          new Request("http://my-project.preview.veryfront.com/page", {
            headers: {
              host: "my-project.preview.veryfront.com",
              cookie: "authToken=user-cookie-token",
            },
          }),
        );

        assertEquals(ctx.error, undefined);
        assertEquals(ctx.projectSlug, "my-project");
        assertEquals(ctx.projectId, "proj-123");
        assertEquals(ctx.token, "user-cookie-token");
        assertEquals(tokenRequests, 1);
        assertEquals(metadataAuthorizationHeaders, [
          "Bearer preview-service-token",
          "Bearer preview-service-token",
        ]);
      } finally {
        await handler?.close();
        await server.shutdown();
      }
    });

    it("does not use a preview user cookie for metadata when service token minting fails", async () => {
      let metadataRequests = 0;

      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") {
          return new Response("service token unavailable", { status: 500 });
        }

        if (pathname.startsWith("/projects/")) {
          metadataRequests++;
          if (req.headers.get("authorization") === "Bearer user-cookie-token") {
            return new Response("Unauthorized", { status: 401 });
          }
        }

        return createNotFoundResponse();
      });

      let handler: ReturnType<typeof createProxyHandler> | undefined;
      try {
        handler = createHandler(port);

        const ctx = await handler.processRequest(
          new Request("http://my-project.preview.veryfront.com/page", {
            headers: {
              host: "my-project.preview.veryfront.com",
              cookie: "authToken=user-cookie-token",
            },
          }),
        );

        assertEquals(ctx.error?.status, 502);
        assertEquals(ctx.error?.message, "Proxy API token unavailable");
        assertEquals(ctx.token, "user-cookie-token");
        assertEquals(metadataRequests, 0);
      } finally {
        await handler?.close();
        await server.shutdown();
      }
    });

    it("redirects to sign-in for protected custom domain without auth token", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["protected.example.com"],
              active_release_id: "rel-123",
              protected: true,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://protected.example.com/page", {
          headers: { host: "protected.example.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 302);
        assertEquals(ctx.error?.message, "Authentication required");
        assertEquals(
          ctx.error?.redirectUrl,
          "https://veryfront.com/sign-in?from=%2Fpage",
        );

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("allows access to protected custom domain with auth token for project member", async () => {
      const memberToken = await signTestJwt({ userId: "user-123", sub: "user-123" });
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            users: [{ id: "user-123" }],
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["protected.example.com"],
              active_release_id: "rel-123",
              protected: true,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://protected.example.com/page", {
          headers: {
            host: "protected.example.com",
            cookie: `authToken=${memberToken}`,
          },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error, undefined);
        assertEquals(ctx.projectSlug, "protected-project");
        assertEquals(ctx.releaseId, "rel-123");

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("uses fresh custom domain protection metadata on each request", async () => {
      let routingLookups = 0;
      let accessLookups = 0;
      let fullProjectLookups = 0;
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/-/proxy-routing/")) {
          routingLookups++;
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["protected.example.com"],
              active_release_id: "rel-123",
            }],
          });
        }

        if (pathname.startsWith("/projects/-/proxy-access/")) {
          accessLookups++;
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["protected.example.com"],
              protected: accessLookups >= 2,
            }],
          });
        }

        if (pathname.startsWith("/projects/")) {
          fullProjectLookups++;
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["protected.example.com"],
              active_release_id: "rel-123",
              protected: fullProjectLookups >= 2,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);
        const req = () =>
          new Request("http://protected.example.com/page", {
            headers: { host: "protected.example.com" },
          });

        const publicAccess = await handler.processRequest(req());
        const protectedAccess = await handler.processRequest(req());

        assertEquals(publicAccess.error, undefined);
        assertEquals(protectedAccess.error?.status, 302);
        assertEquals(protectedAccess.error?.message, "Authentication required");
        assertEquals(routingLookups, 1);
        assertEquals(accessLookups, 2);
        assertEquals(fullProjectLookups, 0);

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("uses fresh custom domain project membership on each request", async () => {
      const memberToken = await signTestJwt({ userId: "user-123", sub: "user-123" });
      let routingLookups = 0;
      let accessLookups = 0;
      let fullProjectLookups = 0;
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/-/proxy-routing/")) {
          routingLookups++;
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["protected.example.com"],
              active_release_id: "rel-123",
            }],
          });
        }

        if (pathname.startsWith("/projects/-/proxy-access/")) {
          accessLookups++;
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            users: accessLookups === 1 ? [{ id: "user-123" }] : [],
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["protected.example.com"],
              protected: true,
            }],
          });
        }

        if (pathname.startsWith("/projects/")) {
          fullProjectLookups++;
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            users: fullProjectLookups === 1 ? [{ id: "user-123" }] : [],
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["protected.example.com"],
              active_release_id: "rel-123",
              protected: true,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const allowed = await handler.processRequest(
          new Request("http://protected.example.com/page", {
            headers: {
              host: "protected.example.com",
              cookie: `authToken=${memberToken}`,
            },
          }),
        );
        const rejected = await handler.processRequest(
          new Request("http://protected.example.com/page", {
            headers: {
              host: "protected.example.com",
              cookie: `authToken=${memberToken}`,
            },
          }),
        );

        assertEquals(allowed.error, undefined);
        assertEquals(rejected.error?.status, 403);
        assertEquals(rejected.error?.message, "Access denied");
        assertEquals(routingLookups, 1);
        assertEquals(accessLookups, 2);
        assertEquals(fullProjectLookups, 0);

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("returns 403 for protected custom domain when authenticated user is not a member", async () => {
      const nonMemberToken = await signTestJwt({ userId: "other-user", sub: "other-user" });
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            users: [{ id: "user-123" }],
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["protected.example.com"],
              active_release_id: "rel-123",
              protected: true,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://protected.example.com/page", {
          headers: {
            host: "protected.example.com",
            cookie: `authToken=${nonMemberToken}`,
          },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 403);
        assertEquals(ctx.error?.message, "Access denied");

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("redirects to sign-in for protected veryfront domain without auth token", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            environments: [{
              id: "env-1",
              name: "staging",
              active_release_id: "rel-123",
              protected: true,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request(
          "http://protected-project.staging.veryfront.com/page",
          {
            headers: { host: "protected-project.staging.veryfront.com" },
          },
        );

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 302);
        assertEquals(ctx.error?.message, "Authentication required");
        assertEquals(
          ctx.error?.redirectUrl,
          "https://veryfront.com/sign-in?from=%2Fpage",
        );

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("allows access to protected veryfront domain with auth token for project member", async () => {
      const memberToken = await signTestJwt({ userId: "user-123", sub: "user-123" });
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            users: [{ id: "user-123" }],
            environments: [{
              id: "env-1",
              name: "staging",
              active_release_id: "rel-123",
              protected: true,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request(
          "http://protected-project.staging.veryfront.com/page",
          {
            headers: {
              host: "protected-project.staging.veryfront.com",
              cookie: `authToken=${memberToken}`,
            },
          },
        );

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error, undefined);
        assertEquals(ctx.projectSlug, "protected-project");
        assertEquals(ctx.releaseId, "rel-123");

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("returns 403 for protected veryfront domain when authenticated user is not a member", async () => {
      const nonMemberToken = await signTestJwt({ userId: "other-user", sub: "other-user" });
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            users: [{ id: "user-123" }],
            environments: [{
              id: "env-1",
              name: "staging",
              active_release_id: "rel-123",
              protected: true,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request(
          "http://protected-project.staging.veryfront.com/page",
          {
            headers: {
              host: "protected-project.staging.veryfront.com",
              cookie: `authToken=${nonMemberToken}`,
            },
          },
        );

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 403);
        assertEquals(ctx.error?.message, "Access denied");

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("strips origin from redirect URL to prevent open redirect", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["protected.example.com"],
              active_release_id: "rel-123",
              protected: true,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://protected.example.com/dashboard?tab=settings", {
          headers: { host: "protected.example.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 302);
        // Must contain only pathname + search, never the full origin
        assertEquals(
          ctx.error?.redirectUrl,
          "https://veryfront.com/sign-in?from=%2Fdashboard%3Ftab%3Dsettings",
        );

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("collapses protocol-relative redirect to prevent open redirect via //evil.com", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["protected.example.com"],
              active_release_id: "rel-123",
              protected: true,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        // An attacker might craft a URL with //evil.com to get a protocol-relative redirect
        const req = new Request("http://protected.example.com//evil.com/callback", {
          headers: { host: "protected.example.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 302);
        // Leading double slashes must be collapsed to a single slash
        assertEquals(
          ctx.error?.redirectUrl,
          "https://veryfront.com/sign-in?from=%2Fevil.com%2Fcallback",
        );

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("uses only root path for redirect when request is to /", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["protected.example.com"],
              active_release_id: "rel-123",
              protected: true,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://protected.example.com/", {
          headers: { host: "protected.example.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 302);
        assertEquals(
          ctx.error?.redirectUrl,
          "https://veryfront.com/sign-in?from=%2F",
        );

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("redirects to sign-in for protected preview domain without auth token", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            environments: [{
              id: "env-1",
              name: "preview",
              active_release_id: "rel-123",
              protected: true,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request(
          "http://protected-project.preview.veryfront.com/page",
          {
            headers: { host: "protected-project.preview.veryfront.com" },
          },
        );

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 302);
        assertEquals(ctx.error?.message, "Authentication required");
        assertEquals(
          ctx.error?.redirectUrl,
          "https://veryfront.com/sign-in?from=%2Fpage",
        );

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("preserves the full protected deployment URL for hosted production sign-in redirects", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "landing-page-6ec5f6e3",
            name: "Landing Page",
            environments: [{
              id: "env-1",
              name: "production",
              active_release_id: "rel-123",
              protected: true,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);
        const deploymentUrl = "https://landing-page-6ec5f6e3.production.veryfront.org/";
        const req = new Request(deploymentUrl, {
          headers: { host: "landing-page-6ec5f6e3.production.veryfront.org" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 302);
        assertEquals(ctx.error?.message, "Authentication required");
        assertEquals(
          ctx.error?.redirectUrl,
          `https://veryfront.com/sign-in?from=${encodeURIComponent(deploymentUrl)}`,
        );

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("returns 404 for missing preview project without auth token", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createNotFoundResponse();

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://missing-project.preview.veryfront.com/page", {
          headers: { host: "missing-project.preview.veryfront.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 404);
        assertEquals(ctx.error?.message, "Preview project not found");
        assertEquals(ctx.error?.slug, "project-not-found");

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("allows access to protected preview domain with auth token for project member", async () => {
      const memberToken = await signTestJwt({ userId: "user-123", sub: "user-123" });
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            users: [{ id: "user-123" }],
            environments: [{
              id: "env-1",
              name: "preview",
              active_release_id: "rel-123",
              protected: true,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request(
          "http://protected-project.preview.veryfront.com/page",
          {
            headers: {
              host: "protected-project.preview.veryfront.com",
              cookie: `authToken=${memberToken}`,
            },
          },
        );

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error, undefined);
        assertEquals(ctx.projectSlug, "protected-project");
        assertEquals(ctx.environmentId, "env-1");

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("allows cryptographically signed control-plane run stream requests through protected preview using inbound token", async () => {
      let tokenEndpointHits = 0;
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") {
          tokenEndpointHits += 1;
          return createTokenResponse();
        }

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            environments: [{
              id: "env-1",
              name: "preview",
              active_release_id: "rel-123",
              protected: true,
            }],
          });
        }

        return createNotFoundResponse();
      });

      const previousKey = Deno.env.get("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");
      try {
        const { jws, publicKeyPem } = await mintControlPlaneJws();
        Deno.env.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", publicKeyPem);
        const handler = createHandler(port);

        const req = new Request(
          "http://protected-project.preview.veryfront.com/api/control-plane/runs/run_1/stream",
          {
            headers: {
              host: "protected-project.preview.veryfront.com",
              "x-token": "project-agent-token",
              "x-veryfront-control-plane-jws": jws,
            },
          },
        );

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error, undefined);
        assertEquals(ctx.projectSlug, "protected-project");
        assertEquals(ctx.environmentId, "env-1");
        assertEquals(ctx.token, "project-agent-token");
        assertEquals(tokenEndpointHits, 0);

        await handler.close();
      } finally {
        if (previousKey === undefined) {
          Deno.env.delete("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");
        } else {
          Deno.env.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", previousKey);
        }
        await server.shutdown();
      }
    });

    it("rejects control-plane requests with a forged (unverifiable) signature on a protected environment", async () => {
      let tokenEndpointHits = 0;
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") {
          tokenEndpointHits += 1;
          return createTokenResponse();
        }

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            environments: [{
              id: "env-1",
              name: "preview",
              active_release_id: "rel-123",
              protected: true,
            }],
          });
        }

        return createNotFoundResponse();
      });

      // Configure a real key, then present a JWS whose signature was NOT minted
      // by the corresponding private key. Header presence must no longer grant
      // the internal bypass.
      const { publicKeyPem } = await mintControlPlaneJws();
      const forged = await mintControlPlaneJws(); // different, unrelated keypair
      const previousKey = Deno.env.get("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");
      try {
        Deno.env.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", publicKeyPem);
        const handler = createHandler(port);

        const req = new Request(
          "http://protected-project.preview.veryfront.com/api/control-plane/runs/run_1/stream",
          {
            headers: {
              host: "protected-project.preview.veryfront.com",
              "x-token": "attacker-supplied-token",
              "x-veryfront-control-plane-jws": forged.jws,
            },
          },
        );

        const ctx = await handler.processRequest(req);

        // Protected environment with no user cookie and an unverifiable
        // signature must be redirected to auth, not allowed through, and the
        // attacker-supplied x-token must not be adopted as the upstream bearer.
        assertEquals(ctx.error?.status, 302);
        assertNotEquals(ctx.token, "attacker-supplied-token");

        await handler.close();
      } finally {
        if (previousKey === undefined) {
          Deno.env.delete("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");
        } else {
          Deno.env.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", previousKey);
        }
        await server.shutdown();
      }
    });

    it("returns 404 for missing preview project with auth token", async () => {
      const memberToken = await signTestJwt({ userId: "user-123", sub: "user-123" });
      const { server, port } = createMockServer((_req: Request) => {
        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://missing-project.preview.veryfront.com/page", {
          headers: {
            host: "missing-project.preview.veryfront.com",
            cookie: `authToken=${memberToken}`,
          },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 404);
        assertEquals(ctx.error?.message, "Preview project not found");
        assertEquals(ctx.error?.slug, "project-not-found");

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("returns 404 for missing production project when token mint returns 404", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createNotFoundResponse();

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://missing-project.production.veryfront.com/page", {
          headers: { host: "missing-project.production.veryfront.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 404);
        assertEquals(ctx.error?.message, "Project not found");
        assertEquals(ctx.error?.slug, "project-not-found");

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("returns 404 for missing production project after lookup with a valid token", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();
        if (pathname.startsWith("/projects/")) return createNotFoundResponse();

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://missing-project.production.veryfront.com/page", {
          headers: { host: "missing-project.production.veryfront.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 404);
        assertEquals(ctx.error?.message, "Project not found");
        assertEquals(ctx.error?.slug, "project-not-found");
        assertEquals(ctx.token, "test-token");

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("allows access to protected preview domain with RS256 auth token verified via JWKS", async () => {
      const kid = "test-rs256-key";
      const memberToken = forgeRs256Token(kid, "user-123");
      const jwksUrl = (port: number) => `http://127.0.0.1:${port}/.well-known/jwks.json`;

      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            users: [{ id: "user-123" }],
            environments: [{
              id: "env-1",
              name: "preview",
              active_release_id: "rel-123",
              protected: true,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        // Register the token with the URL the proxy will compute for this port.
        registerRs256Token(jwksUrl(port), memberToken, {
          sub: "user-123",
          userId: "user-123",
        });

        const handler = createHandler(port);

        const req = new Request(
          "http://protected-project.preview.veryfront.com/page",
          {
            headers: {
              host: "protected-project.preview.veryfront.com",
              cookie: `authToken=${memberToken}`,
            },
          },
        );

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error, undefined);
        assertEquals(ctx.projectSlug, "protected-project");
        assertEquals(ctx.environmentId, "env-1");

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("preserves a path-prefixed API base when resolving JWKS", async () => {
      const kid = "test-rs256-key";
      const memberToken = forgeRs256Token(kid, "user-123");
      const prefixedJwksUrl = (port: number) =>
        `http://127.0.0.1:${port}/api/.well-known/jwks.json`;

      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/api/auth/token") return createTokenResponse();

        if (pathname.startsWith("/api/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            users: [{ id: "user-123" }],
            environments: [{
              id: "env-1",
              name: "preview",
              active_release_id: "rel-123",
              protected: true,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        registerRs256Token(prefixedJwksUrl(port), memberToken, {
          sub: "user-123",
          userId: "user-123",
        });

        const handler = createHandler(port, "/api");

        const req = new Request(
          "http://protected-project.preview.veryfront.com/page",
          {
            headers: {
              host: "protected-project.preview.veryfront.com",
              cookie: `authToken=${memberToken}`,
            },
          },
        );

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error, undefined);
        assertEquals(ctx.projectSlug, "protected-project");
        assertEquals(ctx.environmentId, "env-1");

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("returns 403 for protected preview domain when authenticated user is not a member", async () => {
      const nonMemberToken = await signTestJwt({ userId: "other-user", sub: "other-user" });
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            users: [{ id: "user-123" }],
            environments: [{
              id: "env-1",
              name: "preview",
              active_release_id: "rel-123",
              protected: true,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request(
          "http://protected-project.preview.veryfront.com/page",
          {
            headers: {
              host: "protected-project.preview.veryfront.com",
              cookie: `authToken=${nonMemberToken}`,
            },
          },
        );

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 403);
        assertEquals(ctx.error?.message, "Access denied");

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("redirects to sign-in for protected domain when JWT token is forged", async () => {
      const forgedToken =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1c2VyLTEyMyJ9.invalid-signature";
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            users: [{ id: "user-123" }],
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["protected.example.com"],
              active_release_id: "rel-123",
              protected: true,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://protected.example.com/page", {
          headers: {
            host: "protected.example.com",
            cookie: `authToken=${forgedToken}`,
          },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 302);
        assertEquals(ctx.error?.message, "Authentication required");
        assertEquals(
          ctx.error?.redirectUrl,
          "https://veryfront.com/sign-in?from=%2Fpage",
        );

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("redirects to sign-in for protected domain when JWT_SECRET is not configured", async () => {
      const savedSecret = Deno.env.get("JWT_SECRET");
      Deno.env.delete("JWT_SECRET");

      try {
        const memberToken = await signTestJwt(
          { userId: "user-123", sub: "user-123" },
          "HS256",
          "some-other-secret",
        );

        const { server, port } = createMockServer((req: Request) => {
          const { pathname } = new URL(req.url);

          if (pathname === "/auth/token") return createTokenResponse();

          if (pathname.startsWith("/projects/")) {
            return Response.json({
              id: "proj-123",
              slug: "protected-project",
              name: "Protected Project",
              users: [{ id: "user-123" }],
              environments: [{
                id: "env-1",
                name: "production",
                domains: ["protected.example.com"],
                active_release_id: "rel-123",
                protected: true,
              }],
            });
          }

          return createNotFoundResponse();
        });

        try {
          const handler = createHandler(port);

          const req = new Request("http://protected.example.com/page", {
            headers: {
              host: "protected.example.com",
              cookie: `authToken=${memberToken}`,
            },
          });

          const ctx = await handler.processRequest(req);

          assertEquals(ctx.error?.status, 302);
          assertEquals(ctx.error?.message, "Authentication required");

          await handler.close();
        } finally {
          await server.shutdown();
        }
      } finally {
        if (savedSecret !== undefined) {
          Deno.env.set("JWT_SECRET", savedSecret);
        } else {
          Deno.env.delete("JWT_SECRET");
        }
      }
    });

    it("rejects JWT signed with a different algorithm", async () => {
      // Sign with HS384 instead of the expected HS256
      const wrongAlgToken = await signTestJwt(
        { userId: "user-123", sub: "user-123" },
        "HS384",
      );

      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            users: [{ id: "user-123" }],
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["protected.example.com"],
              active_release_id: "rel-123",
              protected: true,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://protected.example.com/page", {
          headers: {
            host: "protected.example.com",
            cookie: `authToken=${wrongAlgToken}`,
          },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 302);
        assertEquals(ctx.error?.message, "Authentication required");

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("allows access to non-protected environment without auth token", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "public-project",
            name: "Public Project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["public.example.com"],
              active_release_id: "rel-123",
              protected: false,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://public.example.com/page", {
          headers: { host: "public.example.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error, undefined);
        assertEquals(ctx.projectSlug, "public-project");

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });
  });

  describe("injectContextHeaders", () => {
    it("includes x-environment-id when environmentId is present", () => {
      const req = new Request("http://example.com/api/test");
      const ctx: ProxyContext = {
        token: "test-token",
        projectSlug: "my-project",
        projectId: "proj-123",
        releaseId: "rel-456",
        environmentId: "env-789",
        environment: "production",
        contentSourceId: "cs-123",
        host: "example.com",
        parsedDomain: {
          slug: "my-project",
          branch: null,
          environment: "production",
          isVeryfrontDomain: false,
          isDraft: false,
          allowIframeEmbed: false,
        },
        isLocalProject: false,
      };

      const injected = injectContextHeaders(req, ctx);
      assertEquals(injected.headers.get("x-environment-id"), "env-789");
      assertEquals(injected.headers.get("x-project-id"), "proj-123");
      assertEquals(injected.headers.get("x-release-id"), "rel-456");
    });

    it("does not include x-environment-id when environmentId is absent", () => {
      const req = new Request("http://example.com/api/test");
      const ctx: ProxyContext = {
        token: "test-token",
        projectSlug: "my-project",
        environment: "preview",
        contentSourceId: "cs-123",
        host: "example.com",
        parsedDomain: {
          slug: "my-project",
          branch: null,
          environment: "preview",
          isVeryfrontDomain: true,
          isDraft: true,
          allowIframeEmbed: true,
        },
        isLocalProject: false,
      };

      const injected = injectContextHeaders(req, ctx);
      assertEquals(injected.headers.get("x-environment-id"), null);
    });
  });
});
