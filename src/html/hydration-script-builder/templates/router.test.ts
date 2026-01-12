import { assertStringIncludes } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { getRouterScript } from "./router.ts";

describe("router template", () => {
  const script = getRouterScript();

  describe("navigateSPA hydration check", () => {
    it("should check for React root before SPA navigation", () => {
      assertStringIncludes(
        script,
        "if (!container || !container.__reactRoot)",
      );
    });

    it("should fall back to full page navigation if not hydrated", () => {
      assertStringIncludes(
        script,
        "React not hydrated yet, using full page navigation",
      );
      assertStringIncludes(script, "window.location.href = href");
    });
  });

  describe("renderPageFromData", () => {
    it("should return true on successful render", () => {
      assertStringIncludes(script, "return true;");
    });

    it("should return false if React root not found", () => {
      assertStringIncludes(script, "return false;");
    });

    it("should not throw when React root is missing", () => {
      // The old code threw: throw new Error('React root not found')
      // Verify this is no longer present in the render function
      const renderFnMatch = script.match(
        /async function renderPageFromData[\s\S]*?^\s{4}\}/m,
      );
      if (renderFnMatch) {
        const renderFn = renderFnMatch[0];
        // Should not contain throw for React root
        const hasThrow = renderFn.includes("throw new Error('React root");
        if (hasThrow) {
          throw new Error(
            "renderPageFromData should not throw React root error",
          );
        }
      }
    });
  });

  describe("navigateSPA render fallback", () => {
    it("should check render result and fall back if needed", () => {
      assertStringIncludes(script, "const rendered = await renderPageFromData");
      assertStringIncludes(
        script,
        "React root unavailable, using full page navigation",
      );
    });
  });

  describe("popstate handler", () => {
    it("should handle render failure gracefully", () => {
      // Popstate should check rendered result
      assertStringIncludes(
        script,
        "const rendered = await renderPageFromData(e.state.pageData)",
      );
    });
  });
});
