import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_CACHE_TTL_MILLISECONDS } from "#veryfront/cache/backends/ttl.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { findUnknownTopLevelKeys, validateVeryfrontConfig } from "./config.schema.ts";

describe("configSchema", () => {
  it("validates valid config and finds unknown keys", () => {
    const cfg = validateVeryfrontConfig({
      router: "app",
      security: { cors: true, remoteHosts: ["https://esm.sh"] },
    });

    assertEquals(cfg.router, "app");
    assertEquals(findUnknownTopLevelKeys({ foo: 1, router: "pages" }), ["foo"]);
  });

  it("rejects unknown top-level keys through the public validator", () => {
    const error = assertThrows(() =>
      validateVeryfrontConfig({
        title: "Typo",
        buid: { outDir: "dist" },
      })
    );

    assertEquals(error instanceof VeryfrontError, true);
    assertEquals((error as VeryfrontError).slug, "config-validation-failed");
    assertEquals(
      (error as Error).message,
      "Unknown config keys: buid. Check for typos in veryfront.config.",
    );
  });

  it("rejects unknown keys in closed nested configuration objects", () => {
    const github = { token: "token", owner: "owner", repo: "repo" };
    for (
      const [config, path] of [
        [{ dev: { potr: 4444 } }, "dev"],
        [{ build: { outDri: "dist" } }, "build"],
        [{ fs: { type: "github", github: { ...github, cach: {} } } }, "fs.github"],
        [{ ai: { tools: { discovery: { pahts: [] } } } }, "ai.tools.discovery"],
      ] as const
    ) {
      assertThrows(
        () => validateVeryfrontConfig(config),
        Error,
        `Invalid veryfront.config at ${path}:`,
      );
    }
  });

  it("preserves values in intentional dynamic extension points", () => {
    const config = validateVeryfrontConfig({
      theme: { colors: { brand: "#123456" } },
      resolve: {
        importMap: {
          imports: { package: "https://example.com/package.ts" },
          scopes: { "/feature/": { package: "https://example.com/scoped.ts" } },
        },
      },
      ai: {
        providers: {
          custom: {
            apiKey: "key",
            providerSpecificOption: { mode: "strict" },
          },
        },
      },
      tailwind: {
        theme: {
          extend: { spacing: { wide: "42rem" } },
        },
      },
    });

    assertEquals(config.theme?.colors?.brand, "#123456");
    assertEquals(
      config.resolve?.importMap?.scopes?.["/feature/"]?.package,
      "https://example.com/scoped.ts",
    );
    assertEquals(
      config.ai?.providers?.custom?.providerSpecificOption,
      { mode: "strict" },
    );
    assertEquals(config.tailwind?.theme?.extend?.spacing, { wide: "42rem" });
  });

  it("rejects empty configured authentication credentials", () => {
    for (
      const auth of [
        { basic: { username: "", password: "password" } },
        { basic: { username: "user", password: "" } },
        { bearer: { token: "" } },
      ]
    ) {
      assertThrows(
        () => validateVeryfrontConfig({ security: { auth } }),
        Error,
        "Invalid veryfront.config at security.auth",
      );
    }
  });

  it("rejects ambiguous authentication modes", () => {
    assertThrows(
      () =>
        validateVeryfrontConfig({
          security: {
            auth: {
              basic: { username: "user", password: "password" },
              bearer: { token: "token" },
            },
          },
        }),
      Error,
      "Configure either basic or bearer authentication, not both",
    );
  });

  it("rejects filesystem options that do not match the selected backend", () => {
    const github = { token: "token", owner: "owner", repo: "repo" };
    const veryfront = { apiBaseUrl: "https://api.veryfront.com" };

    for (
      const fs of [
        { github },
        { type: "local", github },
        { type: "github" },
        { type: "github", github, local: { baseDir: "/tmp" } },
        { type: "veryfront-api" },
        { type: "veryfront-api", veryfront, memory: { files: {} } },
        { type: "memory", veryfront },
      ]
    ) {
      assertThrows(
        () => validateVeryfrontConfig({ fs }),
        Error,
        "Filesystem options must belong to the selected backend type",
      );
    }

    assertEquals(
      validateVeryfrontConfig({ fs: { type: "github", github } }).fs?.type,
      "github",
    );
    assertEquals(
      validateVeryfrontConfig({ fs: { type: "veryfront-api", veryfront } }).fs?.type,
      "veryfront-api",
    );
  });

  it("accepts build.ssg as a boolean", () => {
    const enabled = validateVeryfrontConfig({ build: { ssg: true } });
    assertEquals(enabled.build?.ssg, true);

    const disabled = validateVeryfrontConfig({ build: { ssg: false } });
    assertEquals(disabled.build?.ssg, false);

    const omitted = validateVeryfrontConfig({ build: {} });
    assertEquals(omitted.build?.ssg, undefined);
  });

  it("rejects non-boolean build.ssg", () => {
    assertThrows(
      () => validateVeryfrontConfig({ build: { ssg: "yes" } }),
      Error,
      "Invalid veryfront.config at build.ssg:",
    );
  });

  it("returns registered validation errors without retaining the full config", () => {
    const input = {
      dev: { port: "invalid" },
      security: { auth: { bearer: { token: "secret-token" } } },
    };

    const error = assertThrows(() => validateVeryfrontConfig(input));

    assertEquals(error instanceof VeryfrontError, true);
    assertEquals((error as VeryfrontError).slug, "config-validation-failed");
    assertEquals((error as VeryfrontError).context, {
      field: "dev.port",
      expected: "Invalid input: expected number, received string",
    });
  });

  it("bounds every configured server port", () => {
    for (
      const input of [
        { dev: { port: 0 } },
        { dev: { port: 65536 } },
        { dev: { hmrPort: 1.5 } },
        { dev: { hmrPort: 65536 } },
        { ai: { mcp: { port: 0 } } },
        { ai: { mcp: { port: 65536 } } },
      ]
    ) {
      assertThrows(
        () => validateVeryfrontConfig(input),
        Error,
        "Invalid veryfront.config at",
      );
    }

    const config = validateVeryfrontConfig({
      dev: { port: 1, hmrPort: 65535 },
      ai: { mcp: { port: 3001 } },
    });
    assertEquals(config.dev?.port, 1);
    assertEquals(config.dev?.hmrPort, 65535);
    assertEquals(config.ai?.mcp?.port, 3001);
  });

  it("gives helpful error for invalid cors", () => {
    const error = assertThrows(
      () => validateVeryfrontConfig({ security: { cors: { origin: 123 } } }),
      Error,
      "Invalid veryfront.config at security.cors:",
    );
    assertStringIncludes(
      error.message,
      "Expected boolean or a CORS object with origin, credentials, methods, allowedHeaders, exposedHeaders, or maxAge.",
    );
  });

  it("accepts the complete runtime CORS configuration contract", () => {
    const origin = (requestOrigin: string) => requestOrigin === "https://example.com";
    const cors = {
      origin,
      credentials: true,
      methods: ["GET", "POST"],
      allowedHeaders: ["Authorization"],
      exposedHeaders: ["X-Request-Id"],
      maxAge: 3600,
    };

    assertEquals(validateVeryfrontConfig({ security: { cors } }).security?.cors, cors);
    assertEquals(
      validateVeryfrontConfig({
        security: { cors: { origin: ["https://example.com"] } },
      }).security?.cors,
      { origin: ["https://example.com"] },
    );
  });

  it("rejects unsafe or malformed CORS configuration", () => {
    for (
      const cors of [
        { origin: "*", credentials: true },
        { origin: [] },
        { origin: [""] },
        { methods: [] },
        { methods: [""] },
        { methods: ["GET, POST"] },
        { methods: ["GET\nInjected"] },
        { allowedHeaders: [] },
        { allowedHeaders: ["X Invalid"] },
        { exposedHeaders: [] },
        { exposedHeaders: ["X-Valid\r\nInjected"] },
        { maxAge: -1 },
        { maxAge: 1.5 },
        { maxAge: Number.MAX_SAFE_INTEGER + 1 },
        { headers: ["Authorization"] },
      ]
    ) {
      assertThrows(
        () => validateVeryfrontConfig({ security: { cors } }),
        Error,
        "Invalid veryfront.config at security.cors",
      );
    }
  });

  it("rejects unsupported bundle manifest backends during validation", () => {
    for (const type of ["redis", "kv"] as const) {
      assertThrows(
        () => validateVeryfrontConfig({ cache: { bundleManifest: { type } } }),
        Error,
        "Invalid veryfront.config at cache.bundleManifest.type:",
      );
    }

    const config = validateVeryfrontConfig({
      cache: { bundleManifest: { type: "memory" } },
    });
    assertEquals(config.cache?.bundleManifest?.type, "memory");
  });

  it("preserves legacy render Redis prefixes and rejects unsafe values", () => {
    const config = validateVeryfrontConfig({
      cache: { render: { type: "redis", redisKeyPrefix: "custom" } },
    });
    assertEquals(config.cache?.render?.redisKeyPrefix, "custom");

    for (
      const redisKeyPrefix of [
        "",
        "   ",
        "unsafe\nprefix",
        "x".repeat(512),
        "vf:workflow",
        "vf:transform",
        "vf:render",
        "vf",
      ]
    ) {
      assertThrows(
        () =>
          validateVeryfrontConfig({
            cache: { render: { type: "redis", redisKeyPrefix } },
          }),
        Error,
        "Invalid veryfront.config at cache.render.redisKeyPrefix:",
      );
    }

    for (const maxEntries of [-1, 0, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      assertThrows(
        () => validateVeryfrontConfig({ cache: { render: { maxEntries } } }),
        Error,
        "Invalid veryfront.config at cache.render.maxEntries:",
      );
    }
  });

  it("rejects unknown and cross-backend render cache options", () => {
    for (
      const render of [
        { type: "memory", redisUrl: "redis://cache" },
        { type: "filesystem", kvPath: "/tmp/cache.sqlite" },
        { type: "kv", redisKeyPrefix: "custom" },
        { type: "redis", maxEntries: 100 },
        { type: "memory", typoMaxEntry: 100 },
      ]
    ) {
      assertThrows(
        () => validateVeryfrontConfig({ cache: { render } }),
        Error,
        "Invalid veryfront.config at cache.render",
      );
    }

    assertEquals(
      validateVeryfrontConfig({ cache: { render: { type: "memory", maxEntries: 100 } } })
        .cache?.render?.type,
      "memory",
    );
    assertEquals(
      validateVeryfrontConfig({ cache: { render: { type: "kv", kvPath: "/cache.sqlite" } } })
        .cache?.render?.type,
      "kv",
    );
    assertEquals(
      validateVeryfrontConfig({
        cache: { render: { type: "redis", redisUrl: "redis://cache", redisKeyPrefix: "custom" } },
      }).cache?.render?.type,
      "redis",
    );
  });

  it("enforces query parameter policy-specific configuration", () => {
    for (
      const queryParams of [
        { policy: "ignore-all", params: ["page"] },
        { policy: "include-all", params: ["page"] },
        { policy: "include-list" },
        { policy: "include-list", params: [] },
        { policy: "exclude-list", params: [""] },
        { policy: "exclude-list", unknown: true },
      ]
    ) {
      assertThrows(
        () => validateVeryfrontConfig({ cache: { queryParams } }),
        Error,
        "Invalid veryfront.config at cache.queryParams",
      );
    }

    for (
      const queryParams of [
        {},
        { policy: "ignore-all" },
        { policy: "include-all" },
        { policy: "include-list", params: ["page", "sort"] },
        { policy: "exclude-list", params: ["utm_source"] },
        { params: ["utm_source"] },
      ]
    ) {
      assertEquals(
        validateVeryfrontConfig({ cache: { queryParams } }).cache?.queryParams !== undefined,
        true,
      );
    }
  });

  it("aligns cache TTL validation with each runtime contract", () => {
    const valid = validateVeryfrontConfig({
      cache: {
        bundleManifest: { ttl: 0 },
        render: { ttl: 0.5 },
      },
      fs: {
        type: "veryfront-api",
        veryfront: { cache: { ttl: 1, maxSize: 2, maxMemory: 3 } },
      },
    });
    const validGithub = validateVeryfrontConfig({
      fs: {
        type: "github",
        github: {
          token: "token",
          owner: "owner",
          repo: "repo",
          cache: { ttl: 1 },
        },
      },
    });
    assertEquals(valid.cache?.bundleManifest?.ttl, 0);
    assertEquals(valid.cache?.render?.ttl, 0.5);
    assertEquals(valid.fs?.veryfront?.cache?.maxMemory, 3);
    assertEquals(validGithub.fs?.github?.cache?.ttl, 1);

    for (const ttl of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      assertThrows(
        () => validateVeryfrontConfig({ cache: { bundleManifest: { ttl } } }),
        Error,
        "Invalid veryfront.config at cache.bundleManifest.ttl:",
      );
    }

    for (
      const ttl of [
        0,
        -1,
        Number.POSITIVE_INFINITY,
        MAX_CACHE_TTL_MILLISECONDS + 1,
      ]
    ) {
      assertThrows(
        () => validateVeryfrontConfig({ cache: { render: { ttl } } }),
        Error,
        "Invalid veryfront.config at cache.render.ttl:",
      );
    }

    for (const ttl of [0, -1, 0.5, MAX_CACHE_TTL_MILLISECONDS + 1]) {
      assertThrows(
        () =>
          validateVeryfrontConfig({
            fs: { type: "veryfront-api", veryfront: { cache: { ttl } } },
          }),
        Error,
        "Invalid veryfront.config at fs.veryfront.cache.ttl:",
      );
      assertThrows(
        () =>
          validateVeryfrontConfig({
            fs: {
              type: "github",
              github: { token: "token", owner: "owner", repo: "repo", cache: { ttl } },
            },
          }),
        Error,
        "Invalid veryfront.config at fs.github.cache.ttl:",
      );
    }

    for (
      const cache of [
        { maxSize: Number.MAX_SAFE_INTEGER + 1 },
        { maxMemory: Number.MAX_SAFE_INTEGER + 1 },
      ]
    ) {
      assertThrows(
        () =>
          validateVeryfrontConfig({
            fs: { type: "veryfront-api", veryfront: { cache } },
          }),
        Error,
        "Invalid veryfront.config at fs.veryfront.cache.",
      );
      assertThrows(
        () =>
          validateVeryfrontConfig({
            fs: {
              type: "github",
              github: { token: "token", owner: "owner", repo: "repo", cache },
            },
          }),
        Error,
        "Invalid veryfront.config at fs.github.cache.",
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
