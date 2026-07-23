import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { findUnknownTopLevelKeys, validateVeryfrontConfig } from "./config.schema.ts";

describe("configSchema", () => {
  it("validates valid config and finds unknown keys", () => {
    const cfg = validateVeryfrontConfig({
      router: "app",
      security: { cors: true, remoteHosts: ["https://esm.sh"] },
    });

    assertEquals(cfg.router, "app");
    assertEquals(findUnknownTopLevelKeys({ foo: 1, router: "pages" }), ["foo"]);
    assertThrows(
      () => validateVeryfrontConfig({ router: "app", typo: true }),
      Error,
      "Unknown config keys",
    );
  });

  it("gives helpful error for invalid cors", () => {
    assertThrows(
      () => validateVeryfrontConfig({ security: { cors: { origin: 123 } } }),
      Error,
      "security.cors.origin must be a string",
    );
  });

  it("validates GitHub filesystem retry timeouts", () => {
    const cfg = validateVeryfrontConfig({
      fs: {
        type: "github",
        github: {
          token: "<TOKEN>",
          owner: "owner",
          repo: "repo",
          retry: {
            maxRetries: 0,
            initialDelay: 0,
            maxDelay: 0,
            requestTimeout: 30_000,
            totalTimeout: 120_000,
            maxResponseBytes: 64 * 1024 * 1024,
          },
        },
      },
    });

    assertEquals(cfg.fs?.github?.retry?.requestTimeout, 30_000);
    assertEquals(cfg.fs?.github?.retry?.totalTimeout, 120_000);
    assertEquals(cfg.fs?.github?.retry?.maxResponseBytes, 64 * 1024 * 1024);
    assertThrows(
      () =>
        validateVeryfrontConfig({
          fs: {
            type: "github",
            github: {
              token: "<TOKEN>",
              owner: "owner",
              repo: "repo",
              retry: { requestTimeout: 0 },
            },
          },
        }),
      Error,
      "requestTimeout",
    );
  });

  it("accepts zero-delay retry policies for Veryfront filesystems", () => {
    const cfg = validateVeryfrontConfig({
      fs: {
        type: "veryfront-api",
        veryfront: {
          apiBaseUrl: "https://api.example.test",
          retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
        },
      },
    });

    assertEquals(cfg.fs?.veryfront?.retry, {
      maxRetries: 0,
      initialDelay: 0,
      maxDelay: 0,
    });
  });

  it("rejects GitHub filesystem selection without GitHub configuration", () => {
    assertThrows(
      () => validateVeryfrontConfig({ fs: { type: "github" } }),
      Error,
      "fs.github",
    );
  });

  it("allows GitHub credentials and repository identity to resolve from environment", () => {
    const cfg = validateVeryfrontConfig({
      fs: {
        type: "github",
        github: {},
      },
    });

    assertEquals(cfg.fs?.github, {});
  });

  it("validates ports and render cache bounds at the config boundary", () => {
    for (
      const input of [
        { dev: { port: 65_536 } },
        { dev: { hmrPort: 1.5 } },
        { ai: { mcp: { port: 0 } } },
        { cache: { render: { ttl: -1 } } },
        { cache: { render: { maxEntries: 1.5 } } },
      ]
    ) {
      assertThrows(() => validateVeryfrontConfig(input), Error, "Invalid veryfront.config");
    }
  });

  it("does not retain the full config object in validation errors", () => {
    const marker = "CONFIG_VALUE_MUST_NOT_APPEAR_IN_ERROR_CONTEXT";
    let error: unknown;
    try {
      validateVeryfrontConfig({
        description: marker,
        dev: { port: "invalid" },
      });
    } catch (caught) {
      error = caught;
    }

    assert(error instanceof Error);
    assertEquals((error as Error & { slug?: string }).slug, "config-validation-failed");
    const serializedContext = JSON.stringify(
      (error as Error & { context?: unknown }).context ?? null,
    );
    assert(!serializedContext.includes(marker));
  });

  it("preserves the complete supported HTTP security configuration", () => {
    const cfg = validateVeryfrontConfig({
      security: {
        auth: {
          basic: { username: "admin", password: "<PASSWORD>", realm: "Example" },
          bearer: { token: "<TOKEN>" },
        },
        cors: {
          origin: ["https://app.example.test"],
          credentials: true,
          methods: ["GET", "POST"],
          allowedHeaders: ["Content-Type"],
          exposedHeaders: ["X-Request-Id"],
          maxAge: 0,
        },
        csp: {
          "default-src": "'self'",
          "script-src": ["'self'", "https://cdn.example.test"],
        },
        hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: false },
        headers: { "X-Content-Type-Options": "nosniff" },
        remoteHosts: ["https://cdn.example.test"],
      },
    });

    assertEquals(cfg.security?.cors, {
      origin: ["https://app.example.test"],
      credentials: true,
      methods: ["GET", "POST"],
      allowedHeaders: ["Content-Type"],
      exposedHeaders: ["X-Request-Id"],
      maxAge: 0,
    });
    assertEquals(cfg.security?.csp, {
      "default-src": "'self'",
      "script-src": ["'self'", "https://cdn.example.test"],
    });
    assertEquals(cfg.security?.hsts, {
      maxAge: 31_536_000,
      includeSubDomains: true,
      preload: false,
    });
    assertEquals(cfg.security?.headers, { "X-Content-Type-Options": "nosniff" });
  });

  it("accepts a CORS origin validator without invoking it during config parsing", () => {
    let calls = 0;
    const origin = (value: string): boolean => {
      calls++;
      return value === "https://app.example.test";
    };

    const cfg = validateVeryfrontConfig({ security: { cors: { origin } } });

    assert(cfg.security?.cors !== undefined && typeof cfg.security.cors !== "boolean");
    assertEquals(cfg.security.cors.origin, origin);
    assertEquals(calls, 0);
  });

  it("rejects unsafe HTTP security values at the config boundary", () => {
    for (
      const security of [
        { cors: { origin: "*", credentials: true } },
        { remoteHosts: ["javascript:alert(1)"] },
        { remoteHosts: ["https://cdn.example.test/project-only"] },
        { remoteHosts: ["https://user:password@cdn.example.test"] },
        {
          auth: {
            basic: { username: "user", password: "password", realm: "unsafe\r\nrealm" },
          },
        },
        {
          auth: {
            basic: { username: "user", password: "password", realm: 'unsafe"realm' },
          },
        },
        { headers: { "Invalid Header": "value" } },
        { headers: { "X-Test": "safe\r\nInjected: true" } },
        { hsts: { maxAge: -1 } },
      ]
    ) {
      assertThrows(
        () => validateVeryfrontConfig({ security }),
        Error,
        "Invalid veryfront.config",
      );
    }
  });

  it("accepts only the canonical source integration narrowing policy", () => {
    const cfg = validateVeryfrontConfig({
      integrations: {
        allow: {
          confluence: {},
          github: { allowedTools: ["list_repos"] },
        },
      },
    });

    assertEquals(cfg.integrations, {
      allow: {
        confluence: {},
        github: { allowedTools: ["list_repos"] },
      },
    });
    assertThrows(
      () =>
        validateVeryfrontConfig({
          integrations: {
            github: { tools: ["list_repos"], scope: "user" },
          },
        }),
      Error,
      "Invalid veryfront.config at integrations.allow:",
    );
    assertThrows(
      () =>
        validateVeryfrontConfig({
          integrations: {
            allow: {
              github: { allowedTools: ["list_repos"], scope: "user" },
            },
          },
        }),
      Error,
      "Invalid veryfront.config at integrations.allow.github:",
    );
    assertThrows(
      () =>
        validateVeryfrontConfig({
          integrations: {
            allow: { GitHub: {} },
          },
        }),
      Error,
      "Invalid veryfront.config at integrations.allow.GitHub: Invalid key in record.",
    );
    assertThrows(
      () =>
        validateVeryfrontConfig({
          integrations: {
            allow: { github: { allowedTools: ["github__list_repos"] } },
          },
        }),
      Error,
      "Expected a canonical connector-local tool ID",
    );
  });
});
