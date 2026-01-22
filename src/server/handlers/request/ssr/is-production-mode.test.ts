import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isProductionMode } from "./ssr-handler.ts";
import type { HandlerContext } from "../../types.ts";

function createContext(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/test",
    adapter: {} as HandlerContext["adapter"],
    securityConfig: null,
    cspUserHeader: null,
    ...overrides,
  };
}

const prodConfig = { fs: { veryfront: { apiBaseUrl: "http://test", productionMode: true } } };

describe("isProductionMode", () => {
  it("returns true when config.productionMode is true", () => {
    const ctx = createContext({ config: prodConfig });
    assertEquals(isProductionMode(ctx), true);
  });

  it("config.productionMode takes priority over requestContext.mode", () => {
    const ctx = createContext({
      config: prodConfig,
      requestContext: { mode: "preview", slug: "test", branch: null, token: "" },
    });
    assertEquals(isProductionMode(ctx), true);
  });

  it("returns true when requestContext.mode is production", () => {
    const ctx = createContext({
      requestContext: { mode: "production", slug: "test", branch: null, token: "" },
    });
    assertEquals(isProductionMode(ctx), true);
  });

  it("returns false when requestContext.mode is preview", () => {
    const ctx = createContext({
      requestContext: { mode: "preview", slug: "test", branch: null, token: "" },
    });
    assertEquals(isProductionMode(ctx), false);
  });

  it("returns false when no requestContext present", () => {
    const ctx = createContext({});
    assertEquals(isProductionMode(ctx), false);
  });

  it("works without URL parameter (backward compatible)", () => {
    const ctx = createContext({
      requestContext: { mode: "production", slug: "test", branch: null, token: "" },
    });
    assertEquals(isProductionMode(ctx), true);
  });
});
