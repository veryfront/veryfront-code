import "#veryfront/schemas/_test-setup.ts";
import { DEPENDENCY_ARTIFACT_BUILD_CAPABILITY } from "#veryfront/release-assets/dependency-artifact-contracts.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "../types.ts";
import { HealthHandler, isServerInitialized, setServerInitialized } from "./health.handler.ts";

function createReadinessCtx(overrides: {
  stat?: () => Promise<unknown>;
  proxyMode?: boolean;
}): HandlerContext {
  return {
    adapter: { fs: { stat: overrides.stat ?? (async () => ({ isDirectory: true })) } },
    projectDir: "/project",
    securityConfig: undefined,
    config: overrides.proxyMode === undefined
      ? undefined
      : { fs: { veryfront: { proxyMode: overrides.proxyMode } } },
  } as unknown as HandlerContext;
}

describe("server/handlers/monitoring/health", () => {
  describe("setServerInitialized / isServerInitialized", () => {
    // This test must run first: it observes the untouched module default, so nothing
    // before it may call setServerInitialized.
    it("should default to false", () => {
      assertEquals(
        isServerInitialized(),
        false,
        "readiness must start false so /readyz fails closed before initialization",
      );
    });

    it("should set to true", () => {
      setServerInitialized(true);
      assertEquals(isServerInitialized(), true);
      setServerInitialized(false);
    });

    it("should toggle back to false", () => {
      setServerInitialized(true);
      setServerInitialized(false);
      assertEquals(isServerInitialized(), false);
    });
  });

  describe("HealthHandler", () => {
    it("should have correct metadata name", () => {
      const handler = new HealthHandler();
      assertEquals(handler.metadata.name, "HealthHandler");
    });

    it("should have patterns for healthz, readyz, and _health", () => {
      const handler = new HealthHandler();
      const handlerPatterns = handler.metadata.patterns;
      assertExists(handlerPatterns);

      const patterns = handlerPatterns.map((p) => (typeof p === "string" ? p : p.pattern));
      assertEquals(patterns.includes("/healthz"), true);
      assertEquals(patterns.includes("/readyz"), true);
      assertEquals(patterns.includes("/_health"), true);
    });

    it("should have all patterns marked as exact", () => {
      const handler = new HealthHandler();
      const handlerPatterns = handler.metadata.patterns;
      assertExists(handlerPatterns);
      assertEquals(
        handlerPatterns.length,
        3,
        "health handler must declare exactly three probe patterns",
      );

      for (const pattern of handlerPatterns) {
        assertEquals(
          typeof pattern === "string",
          false,
          "health patterns must be exact-match objects, not bare strings",
        );
        assertEquals(
          (pattern as { exact?: boolean }).exact,
          true,
          "health probe patterns must be exact so /healthz/<suffix> does not match",
        );
      }
    });

    it("answers /healthz with the liveness document", async () => {
      const handler = new HealthHandler();
      const result = await handler.handle(
        new Request("https://example.com/healthz"),
        createReadinessCtx({}),
      );

      assertExists(result.response);
      assertEquals(result.response.status, 200, "liveness must answer 200");
      assertEquals(
        await result.response.json(),
        { service: "veryfront-server", status: "ok" },
        "liveness body must identify the service",
      );
    });

    it("fails /readyz closed before the server is initialized", async () => {
      const handler = new HealthHandler();
      setServerInitialized(false);
      const result = await handler.handle(
        new Request("https://example.com/readyz"),
        createReadinessCtx({}),
      );

      assertExists(result.response);
      assertEquals(
        result.response.status,
        503,
        "readiness must fail closed before the server is initialized",
      );
      assertEquals(
        await result.response.text(),
        "not-ready",
        "readiness body must say not-ready before init",
      );
    });

    it("reports /readyz ready once initialized and the project directory exists", async () => {
      const handler = new HealthHandler();
      setServerInitialized(true);
      try {
        const result = await handler.handle(
          new Request("https://example.com/readyz"),
          createReadinessCtx({ stat: async () => ({ isDirectory: true }) }),
        );

        assertExists(result.response);
        assertEquals(
          result.response.status,
          200,
          "an initialized server with a project dir is ready",
        );
        assertEquals(await result.response.text(), "ready", "readiness body must say ready");
      } finally {
        setServerInitialized(false);
      }
    });

    it("fails /readyz closed when the project directory is missing", async () => {
      const handler = new HealthHandler();
      setServerInitialized(true);
      try {
        const result = await handler.handle(
          new Request("https://example.com/readyz"),
          createReadinessCtx({ stat: () => Promise.reject(new Error("missing")) }),
        );

        assertExists(result.response);
        assertEquals(
          result.response.status,
          503,
          "a missing project directory must not report ready",
        );
        assertEquals(
          await result.response.text(),
          "not-ready",
          "readiness body must say not-ready",
        );
      } finally {
        setServerInitialized(false);
      }
    });

    it("skips the project directory check in proxy mode", async () => {
      const handler = new HealthHandler();
      setServerInitialized(true);
      let statCalls = 0;
      try {
        const result = await handler.handle(
          new Request("https://example.com/readyz"),
          createReadinessCtx({
            proxyMode: true,
            stat: () => {
              statCalls++;
              throw new Error("stat must not be called in proxy mode");
            },
          }),
        );

        assertExists(result.response);
        assertEquals(
          result.response.status,
          200,
          "proxy mode must report ready without a project dir",
        );
        assertEquals(statCalls, 0, "proxy mode must not stat the project directory");
      } finally {
        setServerInitialized(false);
      }
    });

    it("advertises the dependency artifact builder task capability", async () => {
      const handler = new HealthHandler();
      const ctx = {
        adapter: { fs: { stat: async () => null } },
        projectDir: "/project",
        securityConfig: undefined,
      } as unknown as HandlerContext;

      const result = await handler.handle(new Request("https://example.com/_health"), ctx);

      assertExists(result.response);
      const body = await result.response.json() as { capabilities?: string[] };
      assertEquals(body.capabilities, [DEPENDENCY_ARTIFACT_BUILD_CAPABILITY]);
    });
  });
});
