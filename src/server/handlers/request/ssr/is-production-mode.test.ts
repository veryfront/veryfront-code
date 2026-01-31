import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isProductionMode } from "./ssr.handler.ts";
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
  isLocalDev: true,
};

const productionRequestContext = {
  mode: "production" as const,
  slug: "test",
  branch: null,
  token: "",
  isLocalDev: false,
};

describe("isProductionMode", () => {
  it("returns true when config.productionMode is true", () => {
    assertEquals(isProductionMode(createContext({ config: prodConfig })), true);
  });

  it("config.productionMode takes priority over requestContext.mode", () => {
    assertEquals(
      isProductionMode(
        createContext({ config: prodConfig, requestContext: previewRequestContext }),
      ),
      true,
    );
  });

  it("returns true when requestContext.mode is production", () => {
    assertEquals(
      isProductionMode(createContext({ requestContext: productionRequestContext })),
      true,
    );
  });

  it("returns false when requestContext.mode is preview", () => {
    assertEquals(
      isProductionMode(createContext({ requestContext: previewRequestContext })),
      false,
    );
  });

  it("returns false when no requestContext present", () => {
    assertEquals(isProductionMode(createContext()), false);
  });

  it("works without URL parameter (backward compatible)", () => {
    assertEquals(
      isProductionMode(createContext({ requestContext: productionRequestContext })),
      true,
    );
  });
});
