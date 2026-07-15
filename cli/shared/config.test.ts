import "#veryfront/schemas/_test-setup.ts";
/**
 * Unit tests for shared config
 * @module cli/shared/config.test
 */

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createApiClient, readConfigFile, resolveConfig, resolveConfigWithAuth } from "./config.ts";
import type { ResolvedConfig } from "./config.ts";
import type { EnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { join } from "veryfront/platform/path";
import { __resetEnvLoaderForTests, loadEnv } from "veryfront/utils/env-loader";
import { deleteToken, saveToken } from "../auth/token-store.ts";

function createMockEnv(overrides: Partial<EnvironmentConfig> = {}): EnvironmentConfig {
  return {
    apiUrl: overrides.apiUrl,
    apiToken: overrides.apiToken,
    projectSlug: overrides.projectSlug,
    isDev: false,
    isProduction: true,
    ...overrides,
  } as EnvironmentConfig;
}

describe("resolveConfig", () => {
  it("should throw when no token is available", async () => {
    const env = createMockEnv({ projectSlug: "test-project" });

    await assertRejects(
      () => resolveConfig("/tmp/test-dir", env),
      Error,
      "Missing API token",
    );
  });

  it("should use token from environment", async () => {
    const env = createMockEnv({
      apiToken: "env-token",
      projectSlug: "test-project",
    });

    const config = await resolveConfig("/tmp/test-dir", env);

    assertEquals(config.apiToken, "env-token");
    assertEquals(config.projectSlug, "test-project");
  });

  it("should use default API URL", async () => {
    const env = createMockEnv({
      apiToken: "env-token",
      projectSlug: "test-project",
    });

    const config = await resolveConfig("/tmp/test-dir", env);

    assertEquals(config.apiUrl, "https://api.veryfront.com");
  });

  it("should use custom API URL from environment", async () => {
    const env = createMockEnv({
      apiUrl: "https://custom.api.com",
      apiToken: "env-token",
      projectSlug: "test-project",
    });

    const config = await resolveConfig("/tmp/test-dir", env);

    assertEquals(config.apiUrl, "https://custom.api.com");
  });

  it("prefers explicit apiBaseUrl over veryfront.json apiUrl", async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({
          projectSlug: "from-json",
          apiUrl: "https://api.from-file.test",
        }),
      );

      const env = createMockEnv({
        apiBaseUrl: "https://api.from-env.test",
        apiToken: "env-token",
      });

      const config = await resolveConfig(tempDir, env);

      assertEquals(config.apiUrl, "https://api.from-env.test");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("uses veryfront.json apiUrl before the default apiBaseUrl", async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({
          projectSlug: "from-json",
          apiUrl: "https://api.from-file.test",
        }),
      );

      const env = createMockEnv({
        apiBaseUrl: "https://api.veryfront.com",
        apiToken: "env-token",
      });

      const config = await resolveConfig(tempDir, env);

      assertEquals(config.apiUrl, "https://api.from-file.test");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });
});

describe("resolveConfigWithAuth", () => {
  it("should use token from environment without prompting", async () => {
    const env = createMockEnv({
      apiToken: "env-token",
      projectSlug: "test-project",
    });

    const config = await resolveConfigWithAuth("/tmp/test-dir", env);

    assertEquals(config.apiToken, "env-token");
    assertEquals(config.projectSlug, "test-project");
  });

  it("should throw when auth fails in non-TTY", async () => {
    // In non-TTY mode without a token, ensureAuthenticated returns null
    const env = createMockEnv({ projectSlug: "test-project" });

    await assertRejects(
      () => resolveConfigWithAuth("/tmp/test-dir", env),
      Error,
      "Authentication required",
    );
  });

  it("should use default API URL", async () => {
    const env = createMockEnv({
      apiToken: "env-token",
      projectSlug: "test-project",
    });

    const config = await resolveConfigWithAuth("/tmp/test-dir", env);

    assertEquals(config.apiUrl, "https://api.veryfront.com");
  });

  it("prefers the token store over a project .env API token for management commands", async () => {
    const tempDir = await Deno.makeTempDir();
    const configHome = await Deno.makeTempDir();
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");

    try {
      __resetEnvLoaderForTests();
      Deno.env.delete("VERYFRONT_API_TOKEN");
      await Deno.writeTextFile(join(tempDir, ".env"), "VERYFRONT_API_TOKEN=runtime-token\n");
      await loadEnv({ cwd: tempDir });

      const env = createMockEnv({
        apiToken: "runtime-token",
        projectSlug: "test-project",
        xdgConfigHome: configHome,
      });
      await saveToken("stored-user-token", env);

      const config = await resolveConfigWithAuth(tempDir, env);

      assertEquals(config.apiToken, "stored-user-token");
    } finally {
      await deleteToken(createMockEnv({ xdgConfigHome: configHome }));
      await Deno.remove(tempDir, { recursive: true });
      await Deno.remove(configHome, { recursive: true });
      __resetEnvLoaderForTests();

      if (originalApiToken === undefined) {
        Deno.env.delete("VERYFRONT_API_TOKEN");
      } else {
        Deno.env.set("VERYFRONT_API_TOKEN", originalApiToken);
      }
    }
  });

  it("prefers veryfront.json token over project .env and token store for management commands", async () => {
    const tempDir = await Deno.makeTempDir();
    const configHome = await Deno.makeTempDir();
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");

    try {
      __resetEnvLoaderForTests();
      Deno.env.delete("VERYFRONT_API_TOKEN");
      await Deno.writeTextFile(join(tempDir, ".env"), "VERYFRONT_API_TOKEN=runtime-token\n");
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({ apiToken: "config-token", projectSlug: "test-project" }),
      );
      await loadEnv({ cwd: tempDir });

      const env = createMockEnv({
        apiToken: "runtime-token",
        projectSlug: "test-project",
        xdgConfigHome: configHome,
      });
      await saveToken("stored-user-token", env);

      const config = await resolveConfigWithAuth(tempDir, env);

      assertEquals(config.apiToken, "config-token");
      assertEquals(config.apiTokenSource, "config-file");
    } finally {
      await deleteToken(createMockEnv({ xdgConfigHome: configHome }));
      await Deno.remove(tempDir, { recursive: true });
      await Deno.remove(configHome, { recursive: true });
      __resetEnvLoaderForTests();

      if (originalApiToken === undefined) {
        Deno.env.delete("VERYFRONT_API_TOKEN");
      } else {
        Deno.env.set("VERYFRONT_API_TOKEN", originalApiToken);
      }
    }
  });

  it("uses tenant project context when explicit project slug is absent", async () => {
    const env = createMockEnv({
      apiToken: "env-token",
      projectSlug: undefined,
    });
    const previousTenantProjectSlug = Deno.env.get("TENANT_PROJECT_SLUG");
    const previousTenantProjectId = Deno.env.get("TENANT_PROJECT_ID");

    try {
      Deno.env.set("TENANT_PROJECT_SLUG", "tenant-project");
      Deno.env.set("TENANT_PROJECT_ID", "tenant-project-id");

      const config = await resolveConfigWithAuth("/tmp/test-dir", env);

      assertEquals(config.projectSlug, "tenant-project");
    } finally {
      if (previousTenantProjectSlug === undefined) {
        Deno.env.delete("TENANT_PROJECT_SLUG");
      } else {
        Deno.env.set("TENANT_PROJECT_SLUG", previousTenantProjectSlug);
      }

      if (previousTenantProjectId === undefined) {
        Deno.env.delete("TENANT_PROJECT_ID");
      } else {
        Deno.env.set("TENANT_PROJECT_ID", previousTenantProjectId);
      }
    }
  });

  it("prefers repo config projectSlug over tenant fallback", async () => {
    const env = createMockEnv({
      apiToken: "env-token",
      projectSlug: undefined,
    });
    const previousTenantProjectSlug = Deno.env.get("TENANT_PROJECT_SLUG");
    const previousTenantProjectId = Deno.env.get("TENANT_PROJECT_ID");
    const tempDir = await Deno.makeTempDir();

    try {
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({ projectSlug: "repo-config-project" }),
      );
      Deno.env.set("TENANT_PROJECT_SLUG", "tenant-project");
      Deno.env.set("TENANT_PROJECT_ID", "tenant-project-id");

      const config = await resolveConfigWithAuth(tempDir, env);

      assertEquals(config.projectSlug, "repo-config-project");
    } finally {
      await Deno.remove(tempDir, { recursive: true });

      if (previousTenantProjectSlug === undefined) {
        Deno.env.delete("TENANT_PROJECT_SLUG");
      } else {
        Deno.env.set("TENANT_PROJECT_SLUG", previousTenantProjectSlug);
      }

      if (previousTenantProjectId === undefined) {
        Deno.env.delete("TENANT_PROJECT_ID");
      } else {
        Deno.env.set("TENANT_PROJECT_ID", previousTenantProjectId);
      }
    }
  });

  it("uses tenant project id when no project slug is available", async () => {
    const env = createMockEnv({
      apiToken: "env-token",
      projectSlug: undefined,
    });
    const previousTenantProjectSlug = Deno.env.get("TENANT_PROJECT_SLUG");
    const previousTenantProjectId = Deno.env.get("TENANT_PROJECT_ID");

    try {
      Deno.env.delete("TENANT_PROJECT_SLUG");
      Deno.env.set("TENANT_PROJECT_ID", "tenant-project-id");

      const config = await resolveConfigWithAuth("/tmp/test-dir", env);

      assertEquals(config.projectSlug, "tenant-project-id");
    } finally {
      if (previousTenantProjectSlug === undefined) {
        Deno.env.delete("TENANT_PROJECT_SLUG");
      } else {
        Deno.env.set("TENANT_PROJECT_SLUG", previousTenantProjectSlug);
      }

      if (previousTenantProjectId === undefined) {
        Deno.env.delete("TENANT_PROJECT_ID");
      } else {
        Deno.env.set("TENANT_PROJECT_ID", previousTenantProjectId);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// createApiClient tests
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    apiUrl: "https://api.veryfront.com",
    apiToken: "test-token",
    projectSlug: "test-project",
    ...overrides,
  };
}

describe("createApiClient", () => {
  describe("x-veryfront-client-version header", () => {
    it("sends x-veryfront-client-version on GET requests", async () => {
      let capturedHeaders: Headers | undefined;

      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers as HeadersInit);
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }) as typeof fetch;

      try {
        const client = createApiClient(makeConfig());
        await client.get("/test");
        const version = capturedHeaders?.get("x-veryfront-client-version");
        assertEquals(typeof version, "string");
        assertEquals(version!.length > 0, true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("sends x-veryfront-client-version on POST requests", async () => {
      let capturedHeaders: Headers | undefined;

      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers as HeadersInit);
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }) as typeof fetch;

      try {
        const client = createApiClient(makeConfig());
        await client.post("/test", { foo: "bar" });
        const version = capturedHeaders?.get("x-veryfront-client-version");
        assertEquals(typeof version, "string");
        assertEquals(version!.length > 0, true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it("explains project .env token shadowing on auth-like management API failures", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((_input: unknown, _init?: RequestInit) => {
      return Promise.resolve(
        new Response(JSON.stringify({ message: "API request failed: 403 Forbidden" }), {
          status: 403,
          statusText: "Forbidden",
          headers: { "content-type": "application/json" },
        }),
      );
    }) as typeof fetch;

    try {
      const client = createApiClient(makeConfig({
        apiToken: "runtime-token",
        apiTokenSource: "env-file",
      }));

      await assertRejects(
        () => client.get("/projects/test/files"),
        Error,
        "VERYFRONT_API_TOKEN was loaded from a project .env file",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  describe("retry on transient failures for idempotent requests", () => {
    it("retries GET on 502 and succeeds on second attempt", async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((_input: unknown, _init?: RequestInit) => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(new Response("bad gateway", { status: 502 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ data: "ok" }), { status: 200 }));
      }) as typeof fetch;

      try {
        const client = createApiClient(makeConfig());
        const result = await client.get<{ data: string }>("/test");
        assertEquals(result.data, "ok");
        assertEquals(callCount, 2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("retries GET on 503 and succeeds on second attempt", async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((_input: unknown, _init?: RequestInit) => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(new Response("service unavailable", { status: 503 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ data: "ok" }), { status: 200 }));
      }) as typeof fetch;

      try {
        const client = createApiClient(makeConfig());
        const result = await client.get<{ data: string }>("/test");
        assertEquals(result.data, "ok");
        assertEquals(callCount, 2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("retries GET on connection error and succeeds on second attempt", async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((_input: unknown, _init?: RequestInit) => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error("connection reset by peer"));
        }
        return Promise.resolve(new Response(JSON.stringify({ data: "ok" }), { status: 200 }));
      }) as typeof fetch;

      try {
        const client = createApiClient(makeConfig());
        const result = await client.get<{ data: string }>("/test");
        assertEquals(result.data, "ok");
        assertEquals(callCount, 2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("exhausts retries and throws after 3 consecutive 502 responses", async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((_input: unknown, _init?: RequestInit) => {
        callCount++;
        return Promise.resolve(new Response("bad gateway", { status: 502 }));
      }) as typeof fetch;

      try {
        const client = createApiClient(makeConfig());
        await assertRejects(
          () => client.get("/test"),
          Error,
          "502",
        );
        assertEquals(callCount, 3);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("retries PUT after a nested ECONNRESET and preserves the request body", async () => {
      let callCount = 0;
      const requestBodies: string[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
        callCount++;
        requestBodies.push(String(init?.body));
        if (callCount === 1) {
          const cause = Object.assign(new Error("read failed"), { code: "ECONNRESET" });
          return Promise.reject(new TypeError("fetch failed", { cause }));
        }
        return Promise.resolve(new Response(JSON.stringify({ updated: true }), { status: 200 }));
      }) as typeof fetch;

      try {
        const client = createApiClient(makeConfig());
        const result = await client.put<{ updated: boolean }>("/test", { content: "same" });
        assertEquals(result.updated, true);
        assertEquals(callCount, 2);
        assertEquals(requestBodies, [
          JSON.stringify({ content: "same" }),
          JSON.stringify({ content: "same" }),
        ]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("retries PUT on 502 and succeeds on the second attempt", async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((_input: unknown, _init?: RequestInit) => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(new Response("bad gateway", { status: 502 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ updated: true }), { status: 200 }));
      }) as typeof fetch;

      try {
        const client = createApiClient(makeConfig());
        const result = await client.put<{ updated: boolean }>("/test", { content: "same" });
        assertEquals(result.updated, true);
        assertEquals(callCount, 2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("retry behavior for non-idempotent requests", () => {
    it("does NOT retry POST on 502", async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((_input: unknown, _init?: RequestInit) => {
        callCount++;
        return Promise.resolve(new Response("bad gateway", { status: 502 }));
      }) as typeof fetch;

      try {
        const client = createApiClient(makeConfig());
        await assertRejects(
          () => client.post("/test", {}),
          Error,
          "502",
        );
        assertEquals(callCount, 1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("retries POST on connection-refused error (request never reached server)", async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((_input: unknown, _init?: RequestInit) => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error("connection refused (os error 111)"));
        }
        return Promise.resolve(new Response(JSON.stringify({ created: true }), { status: 200 }));
      }) as typeof fetch;

      try {
        const client = createApiClient(makeConfig());
        const result = await client.post<{ created: boolean }>("/test", {});
        assertEquals(result.created, true);
        assertEquals(callCount, 2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("does NOT retry POST on connection-reset (request may have reached server)", async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((_input: unknown, _init?: RequestInit) => {
        callCount++;
        return Promise.reject(new Error("connection reset by peer"));
      }) as typeof fetch;

      try {
        const client = createApiClient(makeConfig());
        await assertRejects(
          () => client.post("/test", {}),
          Error,
          "connection reset",
        );
        assertEquals(callCount, 1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("does NOT retry POST when fetch wraps ECONNRESET in a cause", async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((_input: unknown, _init?: RequestInit) => {
        callCount++;
        const cause = Object.assign(new Error("read failed"), { code: "ECONNRESET" });
        return Promise.reject(new TypeError("fetch failed", { cause }));
      }) as typeof fetch;

      try {
        const client = createApiClient(makeConfig());
        await assertRejects(
          () => client.post("/test", {}),
          TypeError,
          "fetch failed",
        );
        assertEquals(callCount, 1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});

describe("readConfigFile", () => {
  it("merges veryfront.json apiUrl with the module config projectSlug", async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "veryfront.config.js"),
        'export default { projectSlug: "from-module" };\n',
      );
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({ projectSlug: "from-json", apiUrl: "https://api.veryfront.org" }),
      );

      const config = await readConfigFile(tempDir);

      assertEquals(config?.projectSlug, "from-module");
      assertEquals(config?.apiUrl, "https://api.veryfront.org");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("reads veryfront.json alone when no module config exists", async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({ projectSlug: "json-only", apiUrl: "https://api.veryfront.org" }),
      );

      const config = await readConfigFile(tempDir);

      assertEquals(config?.projectSlug, "json-only");
      assertEquals(config?.apiUrl, "https://api.veryfront.org");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });
});
