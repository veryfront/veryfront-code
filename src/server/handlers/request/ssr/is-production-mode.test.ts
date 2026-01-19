import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isProductionMode } from "./ssr-handler.ts";
import type { HandlerContext } from "../../types.ts";

function createContext(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/test",
    adapter: {} as HandlerContext["adapter"],
    mode: "production",
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

  it("config.productionMode takes priority over domain", () => {
    const ctx = createContext({
      config: prodConfig,
      parsedDomain: {
        isVeryfrontDomain: true,
        isDraft: true,
        slug: "test",
        branch: null,
        environment: "preview",
        allowIframeEmbed: true,
      },
    });
    assertEquals(isProductionMode(ctx), true);
  });

  it("returns true for veryfront domain when isDraft is false", () => {
    const ctx = createContext({
      parsedDomain: {
        isVeryfrontDomain: true,
        isDraft: false,
        slug: "test",
        branch: null,
        environment: "production",
        allowIframeEmbed: true,
      },
    });
    assertEquals(isProductionMode(ctx), true);
  });

  it("returns false for veryfront domain when isDraft is true", () => {
    const ctx = createContext({
      parsedDomain: {
        isVeryfrontDomain: true,
        isDraft: true,
        slug: "test",
        branch: null,
        environment: "preview",
        allowIframeEmbed: true,
      },
    });
    assertEquals(isProductionMode(ctx), false);
  });

  it("returns true for custom domain with production proxy environment", () => {
    const ctx = createContext({
      parsedDomain: {
        isVeryfrontDomain: false,
        isDraft: false,
        slug: null,
        branch: null,
        environment: null,
        allowIframeEmbed: false,
      },
      proxyEnvironment: "production",
    });
    assertEquals(isProductionMode(ctx), true);
  });

  it("returns false for custom domain with preview proxy environment", () => {
    const ctx = createContext({
      parsedDomain: {
        isVeryfrontDomain: false,
        isDraft: false,
        slug: null,
        branch: null,
        environment: null,
        allowIframeEmbed: false,
      },
      proxyEnvironment: "preview",
    });
    assertEquals(isProductionMode(ctx), false);
  });

  it("returns false when no indicators present", () => {
    const ctx = createContext({});
    assertEquals(isProductionMode(ctx), false);
  });

  it("works without URL parameter (backward compatible)", () => {
    const ctx = createContext({
      parsedDomain: {
        isVeryfrontDomain: true,
        isDraft: false,
        slug: "test",
        branch: null,
        environment: "production",
        allowIframeEmbed: true,
      },
    });
    assertEquals(isProductionMode(ctx), true);
  });
});
