import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isProductionMode, shouldHideRouteInProduction } from "./route-visibility-policy.ts";
import type { HandlerContext } from "../types.ts";

function createContext(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/test",
    adapter: {} as HandlerContext["adapter"],
    securityConfig: null,
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

describe("request route visibility policy", () => {
  it("honors an explicit production config override", () => {
    assertEquals(isProductionMode(createContext({ config: prodConfig })), true);
    assertEquals(
      isProductionMode(
        createContext({ config: prodConfig, requestContext: previewRequestContext }),
      ),
      true,
    );
  });

  it("uses resolved environment before request context mode", () => {
    assertEquals(
      isProductionMode(
        createContext({
          resolvedEnvironment: "preview",
          requestContext: productionRequestContext,
        }),
      ),
      false,
    );
    assertEquals(
      isProductionMode(createContext({ requestContext: productionRequestContext })),
      true,
    );
    assertEquals(isProductionMode(createContext()), false);
  });

  it("hides dot-segment routes only in production", () => {
    const production = createContext({ requestContext: productionRequestContext });
    const preview = createContext({ requestContext: previewRequestContext });

    assertEquals(shouldHideRouteInProduction(production, ".veryfront/secrets"), true);
    assertEquals(shouldHideRouteInProduction(production, "docs/.draft/page"), true);
    assertEquals(shouldHideRouteInProduction(production, "docs/public"), false);
    assertEquals(shouldHideRouteInProduction(preview, ".veryfront/secrets"), false);
  });
});
