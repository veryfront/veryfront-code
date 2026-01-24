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

const prodConfig = {
  fs: { veryfront: { apiBaseUrl: "http://test", productionMode: true } },
};

const previewRequestContext = {
  mode: "preview" as const,
  slug: "test",
  branch: null,
  token: "",
};

const productionRequestContext = {
  mode: "production" as const,
  slug: "test",
  branch: null,
  token: "",
};

describe("isProductionMode", () => {
  it("returns true when config.productionMode is true", () => {
    const ctx = createContext({ config: prodConfig });
    assertEquals(isProductionMode(ctx), true);
  });

  it("config.productionMode takes priority over requestContext.mode", () => {
    const ctx = createContext({
      config: prodConfig,
      requestContext: previewRequestContext,
    });
    assertEquals(isProductionMode(ctx), true);
  });

  it("returns true when requestContext.mode is production", () => {
    const ctx = createContext({ requestContext: productionRequestContext });
    assertEquals(isProductionMode(ctx), true);
  });

  it("returns false when requestContext.mode is preview", () => {
    const ctx = createContext({ requestContext: previewRequestContext });
    assertEquals(isProductionMode(ctx), false);
  });

  it("returns false when no requestContext present", () => {
    const ctx = createContext();
    assertEquals(isProductionMode(ctx), false);
  });

  it("works without URL parameter (backward compatible)", () => {
    const ctx = createContext({ requestContext: productionRequestContext });
    assertEquals(isProductionMode(ctx), true);
  });
});
