import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { clearConfigCache } from "#veryfront/config";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { DenoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { HMRHandler } from "../handlers/preview/hmr.handler.ts";
import { createVeryfrontHandler, type RuntimeHandlerOptions } from "./index.ts";
import { __injectDepsForTests as injectIsolationDepsForTests } from "./isolation.ts";
import { defaultDiscoveryCache } from "./local-project-discovery.ts";

const encoder = new TextEncoder();

function encodePem(label: string, der: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = base64.match(/.{1,64}/gu) ?? [base64];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

async function createFreshDispatchJws(): Promise<{
  jws: string;
  publicKeyPem: string;
}> {
  const pair = await crypto.subtle.generateKey(
    "Ed25519",
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const publicKeyPem = encodePem(
    "PUBLIC KEY",
    await crypto.subtle.exportKey("spki", pair.publicKey),
  );
  const now = Math.floor(Date.now() / 1_000);
  const encodedHeader = base64urlEncode(JSON.stringify({
    alg: "EdDSA",
    typ: "JWT",
  }));
  const encodedPayload = base64urlEncode(JSON.stringify({
    iss: "veryfront-api",
    aud: "unrelated-audience",
    sub: "unrelated-dispatch",
    project_id: "unrelated-project",
    platform: "slack",
    body_sha256: "unbound",
    iat: now,
    exp: now + 60,
  }));
  const signingInput = encoder.encode(`${encodedHeader}.${encodedPayload}`);
  const signature = await crypto.subtle.sign(
    "Ed25519",
    pair.privateKey,
    signingInput,
  );
  return {
    jws: `${encodedHeader}.${encodedPayload}.${base64urlEncodeBytes(new Uint8Array(signature))}`,
    publicKeyPem,
  };
}

async function withTrustedProxyTopology<T>(operation: () => Promise<T>): Promise<T> {
  const previousTrustSetting = Deno.env.get("VERYFRONT_TRUST_FORWARDED_HEADERS");
  Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");
  try {
    return await operation();
  } finally {
    if (previousTrustSetting === undefined) {
      Deno.env.delete("VERYFRONT_TRUST_FORWARDED_HEADERS");
    } else {
      Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", previousTrustSetting);
    }
  }
}

function createMockAdapter(
  environment: Readonly<Record<string, string>> = {},
): RuntimeAdapter {
  return {
    id: "test",
    name: "test",
    capabilities: {},
    fs: {
      exists: () => Promise.resolve(false),
    } as unknown as RuntimeAdapter["fs"],
    env: {
      get: (key: string) => environment[key],
      set: () => {},
      delete: () => {},
      has: () => false,
      toObject: () => ({}),
    },
    server: {} as RuntimeAdapter["server"],
    serve: () => Promise.resolve({ close: () => Promise.resolve() }),
  } as unknown as RuntimeAdapter;
}

function createDefaultProjectEnvFetch(): typeof globalThis.fetch {
  return async (input) => {
    const url = new URL(String(input));
    const routingPrefix = "/projects/-/proxy-routing/";
    if (url.pathname.includes(routingPrefix)) {
      const projectSlug = decodeURIComponent(
        url.pathname.slice(url.pathname.indexOf(routingPrefix) + routingPrefix.length),
      );
      return Response.json({
        id: "project_123",
        slug: projectSlug,
        name: "Test project",
        environments: [
          {
            id: "environment_production",
            name: "production",
            active_release_id: "release_123",
          },
          {
            id: "environment_123",
            name: "staging",
            active_release_id: "release_123",
          },
          {
            id: "environment_preview",
            name: "preview",
            active_release_id: null,
          },
        ],
      });
    }
    if (url.pathname.endsWith("/environment-variables")) {
      return Response.json({ data: [] });
    }
    return new Response("Not Found", { status: 404 });
  };
}

function createProxyModeHandler(
  projectEnvFetch: typeof globalThis.fetch = createDefaultProjectEnvFetch(),
) {
  injectIsolationDepsForTests({
    checkRequest: () => ({ allowed: true }),
    startRequest: () => {},
    completeRequest: () => {},
  });

  return createVeryfrontHandler("/tmp/test-project", createMockAdapter(), {
    projectDir: "/tmp/test-project",
    config: {
      fs: { veryfront: { proxyMode: true } },
    } as any,
    projectEnvFetch,
  });
}

interface ProxyRunWithContextOptions {
  productionMode?: boolean;
  releaseId?: string | null;
  branch?: string | null;
  environmentName?: string | null;
  tokenProvenance?: "project-bound" | "untrusted";
}

function createProxySecurityAdapter(
  configSource: string,
  localProjectPath?: string,
  environment: Readonly<Record<string, string>> = {},
  onRunWithContext?: (options: ProxyRunWithContextOptions) => void,
): RuntimeAdapter {
  const configPaths = new Set([
    "/veryfront.config.ts",
    ...(localProjectPath ? [`${localProjectPath}/veryfront.config.ts`] : []),
  ]);
  const fs = {
    getUnderlyingAdapter: () => fs,
    getAdapterType: () => "MultiProjectFSAdapter",
    isVeryfrontAdapter: () => true,
    isMultiProjectMode: () => true,
    isContextualMode: () => true,
    setRequestToken: () => {},
    clearRequestToken: () => {},
    setRequestBranch: () => {},
    getRequestBranch: () => null,
    clearRequestBranch: () => {},
    setProductionMode: () => {},
    createStyleConfigBinding: () =>
      Promise.resolve(Object.freeze({
        projectSlug: "test-project",
        sourceKey: "runtime-handler-test-source",
        sourceRevision: 1,
      })),
    installStyleConfig: () => Promise.resolve(true),
    runWithContext: <T>(
      projectSlug: string,
      token: string,
      fn: () => Promise<T>,
      projectId?: string,
      options: ProxyRunWithContextOptions = {},
    ): Promise<T> => {
      onRunWithContext?.(options);
      return runWithRequestContext({
        projectSlug,
        token,
        projectId,
        ...options,
      }, fn);
    },
    exists: (path: string) =>
      Promise.resolve(
        configPaths.has(path) ||
          (localProjectPath !== undefined &&
            (path === localProjectPath || path === `${localProjectPath}/app`)),
      ),
    readFile: (path: string) => {
      if (configPaths.has(path)) return Promise.resolve(configSource);
      return Promise.reject(new Deno.errors.NotFound(`Not found: ${path}`));
    },
    readFileBytes: (path: string) => {
      if (configPaths.has(path)) {
        return Promise.resolve(new TextEncoder().encode(configSource));
      }
      return Promise.reject(new Deno.errors.NotFound(`Not found: ${path}`));
    },
    readOptionalTextFile: (path: string) => {
      if (configPaths.has(path)) return Promise.resolve(configSource);
      return Promise.reject(new Deno.errors.NotFound(`Not found: ${path}`));
    },
    stat: (path: string) => {
      if (
        localProjectPath !== undefined &&
        (path === localProjectPath || path === `${localProjectPath}/app`)
      ) {
        return Promise.resolve({
          size: 0,
          isFile: false,
          isDirectory: true,
          isSymlink: false,
          mtime: null,
        });
      }
      if (configPaths.has(path)) {
        return Promise.resolve({
          size: configSource.length,
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          mtime: null,
        });
      }
      return Promise.reject(new Deno.errors.NotFound(`Not found: ${path}`));
    },
    readDir: async function* () {},
    readdir: () => Promise.resolve([]),
  };

  return {
    ...createMockAdapter(environment),
    fs,
  } as unknown as RuntimeAdapter;
}

function createProxySecurityHandler(
  configSource: string,
  projectEnvFetch: typeof globalThis.fetch = createDefaultProjectEnvFetch(),
  environment: Readonly<Record<string, string>> = {},
  defaults: Pick<
    RuntimeHandlerOptions,
    "defaultProjectSlug" | "defaultProjectId" | "defaultReleaseId" | "defaultEnvironment"
  > = {},
) {
  injectIsolationDepsForTests({
    checkRequest: () => ({ allowed: true }),
    startRequest: () => {},
    completeRequest: () => {},
  });

  return createVeryfrontHandler(
    "/tmp/test-project",
    createProxySecurityAdapter(configSource, undefined, environment),
    {
      projectDir: "/tmp/test-project",
      config: {
        fs: { veryfront: { proxyMode: true } },
      } as any,
      projectEnvFetch,
      ...defaults,
    },
  );
}

describe("server/runtime-handler/index", () => {
  afterEach(async () => {
    injectIsolationDepsForTests(null);
    clearConfigCache();
    defaultDiscoveryCache.clear();
    await HMRHandler.shutdown();
  });

  it("returns 502 when x-project-slug is missing in proxy mode", async () => {
    const handler = createProxyModeHandler();

    const response = await handler(
      new Request("http://localhost/page", {
        headers: { "x-token": "proxy-token" },
      }),
    );

    assertEquals(response.status, 502);
    assertEquals(response.headers.get("Content-Type"), "application/json");
    assertEquals(await response.json(), {
      error: "Missing project context",
      detail: "x-project-slug header is required in proxy mode",
    });
  });

  it("returns 502 when x-token is missing in proxy mode", async () => {
    const handler = createProxyModeHandler();

    const response = await withTrustedProxyTopology(() =>
      handler(
        new Request("http://localhost/page", {
          headers: { "x-project-slug": "my-project" },
        }),
      )
    );

    assertEquals(response.status, 502);
    assertEquals(response.headers.get("Content-Type"), "application/json");
    assertEquals(await response.json(), {
      error: "Missing authentication context",
      detail: "x-token header is required in proxy mode",
    });
  });

  it("accepts a coherent standard proxy tuple on the original source host", async () => {
    let routingFetches = 0;
    const defaultFetch = createDefaultProjectEnvFetch();
    const handler = createProxySecurityHandler(
      `
        export default {
          security: {
            cors: {
              origin: ["https://client.example"],
              methods: ["GET"]
            }
          }
        };
      `,
      (input, init) => {
        if (new URL(String(input)).pathname.includes("/projects/-/proxy-routing/")) {
          routingFetches += 1;
        }
        return defaultFetch(input, init);
      },
    );

    const response = await withTrustedProxyTopology(() =>
      handler(
        new Request("http://my-project.production.veryfront.com/missing.css", {
          method: "OPTIONS",
          headers: {
            "x-project-slug": "my-project",
            "x-project-id": "project_123",
            "x-token": "proxy-token",
            "x-release-id": "release_123",
            "x-environment-id": "environment_production",
            origin: "https://client.example",
            "access-control-request-method": "GET",
          },
        }),
      )
    );

    assertEquals(response.status, 204);
    assertEquals(await response.text(), "");
    assertEquals(
      response.headers.get("Access-Control-Allow-Origin"),
      "https://client.example",
    );
    assertEquals(routingFetches, 1);
  });

  it("returns 502 when trust-sensitive proxy context headers are present but untrusted", async () => {
    const handler = createProxyModeHandler();

    const response = await handler(
      new Request("http://my-project.production.veryfront.com/page", {
        headers: {
          "x-project-slug": "my-project",
          "x-token": "spoofed-token",
          "x-project-path": "/attacker/chosen/path",
        },
      }),
    );

    assertEquals(response.status, 502);
    assertEquals(response.headers.get("Content-Type"), "application/json");
    assertEquals(await response.json(), {
      error: "Untrusted proxy context",
      detail: "proxy context headers require a trusted upstream proxy",
    });
  });

  it("does not let a fresh unrelated dispatch JWS grant proxy topology authority", async () => {
    const { jws, publicKeyPem } = await createFreshDispatchJws();
    const previousTrustSetting = Deno.env.get("VERYFRONT_TRUST_FORWARDED_HEADERS");
    Deno.env.delete("VERYFRONT_TRUST_FORWARDED_HEADERS");
    try {
      const handler = createProxySecurityHandler(
        "export default { security: { cors: false } };",
        createDefaultProjectEnvFetch(),
        { CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY: publicKeyPem },
      );
      const response = await handler(
        new Request("http://secure-project.production.veryfront.com/page", {
          headers: {
            "x-project-slug": "secure-project",
            "x-project-id": "project_123",
            "x-project-path": "/attacker/chosen/path",
            "x-token": "proxy-token",
            "x-release-id": "release_123",
            "x-environment-id": "environment_production",
            "x-veryfront-dispatch-jws": jws,
          },
        }),
      );

      assertEquals(response.status, 502);
      assertEquals(await response.json(), {
        error: "Untrusted proxy context",
        detail: "proxy context headers require a trusted upstream proxy",
      });
    } finally {
      if (previousTrustSetting === undefined) {
        Deno.env.delete("VERYFRONT_TRUST_FORWARDED_HEADERS");
      } else {
        Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", previousTrustSetting);
      }
    }
  });

  it("skips the proxy header guard for server-resolved preview websocket requests", async () => {
    let controlPlaneFetches = 0;
    const handler = createProxyModeHandler(() => {
      controlPlaneFetches += 1;
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    });

    const response = await handler(
      new Request("http://test-project.preview.veryfront.com/_ws"),
    );

    assertEquals(response.status, 426);
    assertEquals(await response.text(), "WebSocket upgrade required");
    assertEquals(controlPlaneFetches, 0);
  });

  it("does not let an untrusted WebSocket query promote a production source", async () => {
    const previousTrustSetting = Deno.env.get("VERYFRONT_TRUST_FORWARDED_HEADERS");
    Deno.env.delete("VERYFRONT_TRUST_FORWARDED_HEADERS");
    try {
      const handler = createProxySecurityHandler(
        "export default { security: { cors: false } };",
        createDefaultProjectEnvFetch(),
        {},
        {
          defaultProjectSlug: "test-project",
          defaultProjectId: "project_123",
          defaultReleaseId: "release_123",
          defaultEnvironment: "production",
        },
      );

      const response = await handler(
        new Request(
          "http://test-project.production.veryfront.com/_ws?x-environment=preview",
          {
            headers: {
              "x-project-slug": "test-project",
              "x-project-id": "project_123",
              "x-token": "proxy-token",
              "x-release-id": "release_123",
              "x-environment-id": "environment_production",
            },
          },
        ),
      );

      // The untrusted project/environment metadata is discarded before the
      // preview selector can affect source resolution.
      assertEquals(response.status, 400);
      await response.body?.cancel();
    } finally {
      if (previousTrustSetting === undefined) {
        Deno.env.delete("VERYFRONT_TRUST_FORWARDED_HEADERS");
      } else {
        Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", previousTrustSetting);
      }
    }
  });

  it("keeps the native HMR upgrade request connected", async () => {
    const adapter = new DenoAdapter();
    const projectDir = Deno.cwd();
    const handler = createVeryfrontHandler(projectDir, adapter, {
      projectDir,
      config: {} as any,
      defaultProjectSlug: "test-project",
      defaultEnvironment: "preview",
      localProjects: { "test-project": projectDir },
    });
    await handler.ready;

    let port = 0;
    const server = await adapter.serve(handler, {
      hostname: "127.0.0.1",
      port: 0,
      onListen: (address) => {
        port = address.port;
      },
    });
    assertEquals(port > 0, true);
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/_ws?x-environment=preview&x-project-slug=test-project`,
    );

    try {
      const message = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Timed out waiting for the HMR connected message")),
          2_000,
        );

        socket.addEventListener("message", (event) => {
          clearTimeout(timeout);
          resolve(String(event.data));
        }, { once: true });
        socket.addEventListener("close", (event) => {
          clearTimeout(timeout);
          reject(
            new Error(
              `HMR socket closed before the connected message (code=${event.code}, clean=${event.wasClean})`,
            ),
          );
        }, { once: true });
        socket.addEventListener("error", () => {
          clearTimeout(timeout);
          reject(new Error("HMR socket failed before the connected message"));
        }, { once: true });
      });

      assertEquals(JSON.parse(message), { type: "connected" });
    } finally {
      socket.close();
      await HMRHandler.shutdown();
      await server.stop();
    }
  });

  it("skips the proxy header guard for lightweight module requests", async () => {
    let controlPlaneFetches = 0;
    const handler = createProxyModeHandler(() => {
      controlPlaneFetches += 1;
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    });

    const response = await handler(
      new Request("http://localhost/_veryfront/hydration-runtime.js", {
        headers: { "x-release-id": "rel_123" },
      }),
    );

    assertEquals(response.status === 502, false);
    const body = await response.text();
    assertEquals(body.includes("x-project-slug header is required in proxy mode"), false);
    assertEquals(body.includes("x-token header is required in proxy mode"), false);
    assertEquals(controlPlaneFetches, 0);
  });

  it("keeps an adapter-consumed hosted source authoritative for lightweight requests", async () => {
    const contexts: ProxyRunWithContextOptions[] = [];
    const adapter = createProxySecurityAdapter(
      "export default { security: { cors: false } };",
      undefined,
      {},
      (options) => contexts.push({ ...options }),
    );
    const previousTrustSetting = Deno.env.get("VERYFRONT_TRUST_FORWARDED_HEADERS");
    Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");
    try {
      const handler = createVeryfrontHandler("/tmp/test-project", adapter, {
        projectDir: "/tmp/test-project",
        config: { fs: { veryfront: { proxyMode: true } } } as any,
        projectEnvFetch: createDefaultProjectEnvFetch(),
      });
      const response = await handler(
        new Request(
          "http://coherent-project.staging.veryfront.com/_veryfront/hydration-runtime.js",
          {
            headers: {
              "x-project-slug": "coherent-project",
              "x-project-id": "project_123",
              "x-token": "proxy-token",
              "x-release-id": "release_123",
              "x-environment-id": "environment_123",
              // This legacy hint must not replace the source already bound from
              // the authoritative staging host during config evaluation.
              "x-environment": "preview",
            },
          },
        ),
      );

      assertEquals(response.status, 200);
      assertEquals(contexts.length >= 2, true);
      assertEquals(
        contexts.every(({ productionMode, releaseId, environmentName }) =>
          productionMode === true &&
          releaseId === "release_123" &&
          environmentName === "staging"
        ),
        true,
      );
    } finally {
      if (previousTrustSetting === undefined) {
        Deno.env.delete("VERYFRONT_TRUST_FORWARDED_HEADERS");
      } else {
        Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", previousTrustSetting);
      }
    }
  });

  it("keeps an adapter-consumed hosted source authoritative for WebSocket requests", async () => {
    const contexts: ProxyRunWithContextOptions[] = [];
    const adapter = createProxySecurityAdapter(
      "export default { security: { cors: false } };",
      undefined,
      {},
      (options) => contexts.push({ ...options }),
    );
    const previousTrustSetting = Deno.env.get("VERYFRONT_TRUST_FORWARDED_HEADERS");
    Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");
    try {
      const handler = createVeryfrontHandler("/tmp/test-project", adapter, {
        projectDir: "/tmp/test-project",
        config: { fs: { veryfront: { proxyMode: true } } } as any,
        projectEnvFetch: createDefaultProjectEnvFetch(),
      });
      const response = await handler(
        new Request("http://coherent-project.staging.veryfront.com/_ws", {
          headers: {
            "x-project-slug": "coherent-project",
            "x-project-id": "project_123",
            "x-token": "proxy-token",
            "x-release-id": "release_123",
            "x-environment-id": "environment_123",
            "x-environment": "preview",
          },
        }),
      );

      assertEquals(response.status, 404);
      assertEquals(contexts.length >= 2, true);
      assertEquals(
        contexts.every(({ productionMode, releaseId, environmentName }) =>
          productionMode === true &&
          releaseId === "release_123" &&
          environmentName === "staging"
        ),
        true,
      );
    } finally {
      if (previousTrustSetting === undefined) {
        Deno.env.delete("VERYFRONT_TRUST_FORWARDED_HEADERS");
      } else {
        Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", previousTrustSetting);
      }
    }
  });

  it("uses one request-scoped project security policy for proxy preflight and handlers", async () => {
    const handler = createProxySecurityHandler(`
      export default {
        security: {
          auth: {
            basic: {
              username: "alice",
              password: "secret",
              realm: "Project Area"
            }
          },
          cors: {
            origin: ["https://client.example"],
            credentials: true,
            methods: ["GET", "POST"],
            allowedHeaders: ["authorization", "x-csrf-token"]
          },
          csp: {
            "default-src": ["'none'"]
          }
        }
      };
    `);
    const proxyHeaders = {
      "x-project-slug": "secure-project",
      "x-project-id": "project_123",
      "x-token": "proxy-token",
      "x-release-id": "release_123",
      "x-environment-id": "environment_production",
      origin: "https://client.example",
    };

    const preflight = await withTrustedProxyTopology(() =>
      handler(
        new Request("http://secure-project.production.veryfront.com/missing.css", {
          method: "OPTIONS",
          headers: {
            ...proxyHeaders,
            "access-control-request-method": "GET",
            "access-control-request-headers": "authorization",
          },
        }),
      )
    );

    assertEquals(preflight.status, 204);
    assertEquals(
      preflight.headers.get("Access-Control-Allow-Origin"),
      "https://client.example",
    );
    assertEquals(preflight.headers.get("Access-Control-Allow-Credentials"), "true");

    const unauthorized = await withTrustedProxyTopology(() =>
      handler(
        new Request("http://secure-project.production.veryfront.com/missing.css", {
          headers: proxyHeaders,
        }),
      )
    );

    assertEquals(unauthorized.status, 401);
    assertEquals(unauthorized.headers.get("WWW-Authenticate"), 'Basic realm="Project Area"');
    assertEquals(
      unauthorized.headers.get("Access-Control-Allow-Origin"),
      "https://client.example",
    );
    assertEquals(unauthorized.headers.get("Access-Control-Allow-Credentials"), "true");

    const authorization = `Basic ${btoa("alice:secret")}`;
    const actual = await withTrustedProxyTopology(() =>
      handler(
        new Request("http://secure-project.production.veryfront.com/missing.css", {
          headers: { ...proxyHeaders, authorization },
        }),
      )
    );

    assertEquals(actual.status, 404);
    assertEquals(
      actual.headers.get("Access-Control-Allow-Origin"),
      "https://client.example",
    );
    assertEquals(actual.headers.get("Access-Control-Allow-Credentials"), "true");
    assertEquals(actual.headers.get("Content-Security-Policy"), "default-src 'none'");

    const csrfRejected = await withTrustedProxyTopology(() =>
      handler(
        new Request("http://secure-project.production.veryfront.com/missing.css", {
          method: "POST",
          headers: { ...proxyHeaders, authorization },
        }),
      )
    );

    assertEquals(csrfRejected.status, 403);
    assertEquals(
      csrfRejected.headers.get("Access-Control-Allow-Origin"),
      "https://client.example",
    );
    assertEquals(csrfRejected.headers.get("Access-Control-Allow-Credentials"), "true");
    assertEquals(await csrfRejected.text(), "Forbidden – invalid or missing CSRF token");
  });

  it("loads tenant env before hosted config and reuses the snapshot for the route", async () => {
    let managementFetches = 0;
    const previousTrustSetting = Deno.env.get("VERYFRONT_TRUST_FORWARDED_HEADERS");
    Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");
    try {
      await withMockFetch(
        async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const url = new URL(request.url);
          if (
            url.pathname.endsWith(
              "/projects/-/proxy-routing/env-config-project",
            )
          ) {
            return Response.json({
              id: "project_123",
              slug: "env-config-project",
              name: "Environment config project",
              environments: [{
                id: "environment_123",
                name: "staging",
                active_release_id: "release_123",
              }],
            });
          }
          if (url.pathname.endsWith("/projects/env-config-project/environment-variables")) {
            managementFetches += 1;
            assertEquals(url.searchParams.get("environment_id"), "environment_123");
            assertEquals(request.headers.get("authorization"), "Bearer proxy-token");
            return Response.json({
              data: [{ key: "CONFIG_PASSWORD", value: "tenant-secret" }],
            });
          }
          if (url.pathname.endsWith("/internal/project-environment-variables")) {
            return Response.json({
              data: [{ key: "CONFIG_PASSWORD", value: "tenant-secret" }],
            });
          }
          return new Response("Not Found", { status: 404 });
        },
        async () => {
          const handler = createProxySecurityHandler(
            `
          import { getEnv } from "veryfront";
          export default {
            security: {
              auth: {
                basic: {
                  username: "alice",
                  password: getEnv("CONFIG_PASSWORD") ?? "missing",
                  realm: "Environment Config"
                }
              },
              cors: false
            }
          };
        `,
            globalThis.fetch,
          );
          const response = await handler(
            new Request("http://env-config-project.staging.veryfront.com/missing.css", {
              headers: {
                "x-project-slug": "env-config-project",
                "x-project-id": "project_123",
                "x-release-id": "release_123",
                "x-environment": "production",
                "x-environment-id": "environment_123",
                "x-token": "proxy-token",
                authorization: `Basic ${btoa("alice:tenant-secret")}`,
              },
            }),
          );

          assertEquals(response.status, 404);
        },
      );
    } finally {
      if (previousTrustSetting === undefined) {
        Deno.env.delete("VERYFRONT_TRUST_FORWARDED_HEADERS");
      } else {
        Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", previousTrustSetting);
      }
    }

    assertEquals(managementFetches, 1);
  });

  it("fails before env or config evaluation when the environment ID is not source-bound", async () => {
    let routingFetches = 0;
    let environmentFetches = 0;
    const projectEnvFetch: typeof globalThis.fetch = (input) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/projects/-/proxy-routing/")) {
        routingFetches += 1;
        return Promise.resolve(Response.json({
          id: "project_123",
          slug: "secure-project",
          name: "Secure project",
          environments: [{
            id: "environment_staging",
            name: "staging",
            active_release_id: "release_123",
          }],
        }));
      }
      if (url.pathname.endsWith("/environment-variables")) {
        environmentFetches += 1;
        return Promise.resolve(Response.json({ data: [] }));
      }
      return Promise.resolve(new Response("Not Found", { status: 404 }));
    };
    const handler = createProxySecurityHandler(
      "export default { security: { cors: false } };",
      projectEnvFetch,
    );

    const previousTrustSetting = Deno.env.get("VERYFRONT_TRUST_FORWARDED_HEADERS");
    Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");
    let response: Response;
    try {
      response = await handler(
        new Request("http://renderer.internal/missing.css", {
          headers: {
            "x-forwarded-host": "secure-project.staging.veryfront.com",
            "x-project-slug": "secure-project",
            "x-project-id": "project_123",
            "x-release-id": "release_123",
            "x-environment-id": "environment_from_another_source",
            "x-token": "proxy-token",
          },
        }),
      );
    } finally {
      if (previousTrustSetting === undefined) {
        Deno.env.delete("VERYFRONT_TRUST_FORWARDED_HEADERS");
      } else {
        Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", previousTrustSetting);
      }
    }

    assertEquals(response.status, 502);
    assertEquals(routingFetches, 2);
    assertEquals(environmentFetches, 0);
  });

  it("rejects a missing remote environment ID before routing discovery", async () => {
    let fetches = 0;
    const handler = createProxySecurityHandler(
      "export default { security: { cors: false } };",
      () => {
        fetches += 1;
        return Promise.resolve(new Response("unexpected"));
      },
    );

    const response = await withTrustedProxyTopology(() =>
      handler(
        new Request("http://secure-project.production.veryfront.com/missing.css", {
          headers: {
            "x-project-slug": "secure-project",
            "x-project-id": "project_123",
            "x-release-id": "release_123",
            "x-token": "proxy-token",
          },
        }),
      )
    );

    assertEquals(response.status, 400);
    assertEquals(fetches, 0);
  });

  it("does not let a fresh unrelated dispatch JWS rebind the ordinary source host", async () => {
    const { jws, publicKeyPem } = await createFreshDispatchJws();
    let environmentFetches = 0;
    const projectEnvFetch: typeof globalThis.fetch = (input) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/projects/-/proxy-routing/")) {
        return Promise.resolve(Response.json({
          id: "project_123",
          slug: "secure-project",
          name: "Secure project",
          environments: [
            {
              id: "environment_production",
              name: "production",
              active_release_id: "release_123",
            },
            {
              id: "environment_staging",
              name: "staging",
              active_release_id: "release_123",
            },
          ],
        }));
      }
      if (url.pathname.endsWith("/environment-variables")) {
        environmentFetches += 1;
        return Promise.resolve(Response.json({ data: [] }));
      }
      return Promise.resolve(new Response("Not Found", { status: 404 }));
    };
    const handler = createProxySecurityHandler(
      "export default { security: { cors: false } };",
      projectEnvFetch,
      { CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY: publicKeyPem },
      {
        defaultProjectSlug: "secure-project",
        defaultProjectId: "project_123",
        defaultReleaseId: "release_123",
        defaultEnvironment: "production",
      },
    );

    const response = await handler(
      new Request("http://secure-project.production.veryfront.com/missing.css", {
        headers: {
          "x-project-slug": "secure-project",
          "x-project-id": "project_123",
          "x-forwarded-host": "secure-project.staging.veryfront.com",
          "x-release-id": "release_123",
          "x-environment-id": "environment_staging",
          "x-token": "proxy-token",
          "x-veryfront-dispatch-jws": jws,
        },
      }),
    );

    // A dispatch signature that is not bound to the routing tuple cannot make
    // its project/source metadata authoritative; resolution fails closed
    // before any tenant environment is loaded.
    assertEquals(response.status, 400);
    assertEquals(environmentFetches, 0);
    await response.body?.cancel();
  });

  it("binds a custom domain through authoritative domain metadata", async () => {
    let environmentFetches = 0;
    const projectEnvFetch: typeof globalThis.fetch = (input) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/projects/-/proxy-routing/")) {
        return Promise.resolve(Response.json({
          id: "project_123",
          slug: "secure-project",
          name: "Secure project",
          environments: [{
            id: "environment_customer",
            name: "customer-production",
            domains: ["customer.example"],
            active_release_id: "release_customer",
          }],
        }));
      }
      if (url.pathname.endsWith("/environment-variables")) {
        environmentFetches += 1;
        return Promise.resolve(Response.json({ data: [] }));
      }
      return Promise.resolve(new Response("Not Found", { status: 404 }));
    };
    const handler = createProxySecurityHandler(
      "export default { security: { cors: false } };",
      projectEnvFetch,
    );

    const response = await withTrustedProxyTopology(() =>
      handler(
        new Request("https://customer.example/missing.css", {
          headers: {
            "x-project-slug": "secure-project",
            "x-project-id": "project_123",
            "x-release-id": "release_customer",
            "x-environment-id": "environment_customer",
            "x-token": "proxy-token",
          },
        }),
      )
    );

    assertEquals(response.status, 404);
    assertEquals(environmentFetches, 1);
  });

  it("applies the hosted CSRF default to remote preview projects", async () => {
    const handler = createProxySecurityHandler(`
      export default {
        security: {
          cors: false
        }
      };
    `);

    const response = await withTrustedProxyTopology(() =>
      handler(
        new Request("http://secure-project.preview.veryfront.com/missing.css", {
          method: "POST",
          headers: {
            "x-project-slug": "secure-project",
            "x-project-id": "project_123",
            "x-environment-id": "environment_preview",
            "x-token": "proxy-token",
          },
        }),
      )
    );

    assertEquals(response.status, 403);
    assertEquals(await response.text(), "Forbidden – invalid or missing CSRF token");
  });

  it("keeps development CSRF defaults for an actually local proxy project", async () => {
    const projectDir = "/local/security-project";
    const projectSlug = "local-security-project";
    const configSource = `
      import { getEnv } from "veryfront";
      export default {
        security: {
          auth: {
            basic: {
              username: "alice",
              password: getEnv("LOCAL_CONFIG_SECRET") ?? "empty-context",
              realm: "Host Leak"
            }
          },
          cors: false
        }
      };
    `;
    const adapter = createProxySecurityAdapter(configSource, projectDir);
    const localFs = {
      ...(adapter.fs as unknown as Record<string, unknown>),
    };
    for (
      const property of [
        "getUnderlyingAdapter",
        "getAdapterType",
        "isVeryfrontAdapter",
        "isMultiProjectMode",
        "isContextualMode",
        "runWithContext",
      ]
    ) {
      Reflect.deleteProperty(localFs, property);
    }
    const localAdapter = {
      ...adapter,
      fs: localFs,
    } as unknown as RuntimeAdapter;
    defaultDiscoveryCache.projects.set(projectSlug, projectDir);
    defaultDiscoveryCache.adapters.set(projectDir, localAdapter);

    const previousTrustSetting = Deno.env.get("VERYFRONT_TRUST_FORWARDED_HEADERS");
    const previousConfigSecret = Deno.env.get("LOCAL_CONFIG_SECRET");
    Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");
    Deno.env.set("LOCAL_CONFIG_SECRET", "host-secret");
    let environmentFetches = 0;

    try {
      const response = await withMockFetch(
        async () => {
          environmentFetches += 1;
          return Response.json({ data: [] });
        },
        async () => {
          const handler = createVeryfrontHandler("/tmp/test-project", adapter, {
            projectDir: "/tmp/test-project",
            config: {
              fs: { veryfront: { proxyMode: true } },
            } as any,
          });
          return await handler(
            new Request(`http://${projectSlug}.production.veryfront.com/missing.css`, {
              method: "POST",
              headers: {
                "x-project-slug": projectSlug,
                "x-project-id": "project_local",
                "x-project-path": projectDir,
                "x-release-id": "release_local",
                "x-environment-id": "environment_local",
                "x-token": "proxy-token",
                authorization: `Basic ${btoa("alice:empty-context")}`,
              },
            }),
          );
        },
      );

      assertEquals(response.status, 404);
      assertEquals(environmentFetches, 0);
    } finally {
      if (previousTrustSetting === undefined) {
        Deno.env.delete("VERYFRONT_TRUST_FORWARDED_HEADERS");
      } else {
        Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", previousTrustSetting);
      }
      if (previousConfigSecret === undefined) {
        Deno.env.delete("LOCAL_CONFIG_SECRET");
      } else {
        Deno.env.set("LOCAL_CONFIG_SECRET", previousConfigSecret);
      }
    }
  });

  it("does not invent a CSRF policy when exact-source control-plane config is deferred", async () => {
    const handler = createProxyModeHandler();
    const response = await withTrustedProxyTopology(() =>
      handler(
        new Request(
          "http://localhost/api/control-plane/runs/run_123/resume",
          {
            method: "POST",
            headers: {
              "x-project-slug": "secure-project",
              "x-project-id": "project_123",
              "x-token": "proxy-token",
              "content-type": "application/json",
            },
            body: "{}",
          },
        ),
      )
    );

    assertEquals(response.status, 500);
    assertEquals(await response.json(), {
      error: "Control-plane verification is not configured",
    });
  });
});
