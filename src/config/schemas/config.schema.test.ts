import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_CACHE_TTL_MILLISECONDS } from "#veryfront/cache/backends/ttl.ts";
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

  it("gives helpful error for invalid cors", () => {
    assertThrows(
      () => validateVeryfrontConfig({ security: { cors: { origin: 123 } } }),
      Error,
      "Invalid veryfront.config at security.cors:",
    );
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
        veryfront: { cache: { ttl: 1, maxSize: 2, maxMemory: 3 } },
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
        () => validateVeryfrontConfig({ fs: { veryfront: { cache: { ttl } } } }),
        Error,
        "Invalid veryfront.config at fs.veryfront.cache.ttl:",
      );
      assertThrows(
        () =>
          validateVeryfrontConfig({
            fs: {
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
        () => validateVeryfrontConfig({ fs: { veryfront: { cache } } }),
        Error,
        "Invalid veryfront.config at fs.veryfront.cache.",
      );
      assertThrows(
        () =>
          validateVeryfrontConfig({
            fs: { github: { token: "token", owner: "owner", repo: "repo", cache } },
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
