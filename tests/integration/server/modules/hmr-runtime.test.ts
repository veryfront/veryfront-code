// Disable LRU intervals during testing to prevent resource leaks
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

import { assert, assertEquals, assertExists } from "@veryfront/testing/assert";
import { afterAll, describe, it } from "@veryfront/testing/bdd";
import {
  generateHMRRuntimeScript as generateRuntimeScript,
  type HMRRuntimeOptions,
} from "../../../../src/server/dev-server/hmr/index.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

function getScript(overrides: Partial<HMRRuntimeOptions> = {}): string {
  return generateRuntimeScript({ port: 3001, reactRefresh: false, ...overrides });
}

describe("HMR Runtime Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  afterAll(async () => {
    await cleanupBundler();
  });

  describe("HMR Runtime - Script Generation", () => {
    it("generates valid JavaScript code", () => {
      const script = getScript();

      assertExists(script);
      assert(script.length > 0);
      assert(typeof script === "string");
    });

    it("includes correct port in generated script", () => {
      const script = getScript({ port: 4242 });

      assert(script.includes("4242"), "Script should include the port number");
      assert(script.includes("ws://"), "Script should include WebSocket protocol");
    });

    it("includes WebSocket connection code", () => {
      const script = getScript();

      assert(script.includes("new WebSocket"), "Should create WebSocket connection");
      assert(script.includes("ws.onopen"), "Should have onopen handler");
      assert(script.includes("ws.onmessage"), "Should have onmessage handler");
      assert(script.includes("ws.onclose"), "Should have onclose handler");
      assert(script.includes("ws.onerror"), "Should have onerror handler");
    });

    it("includes message handling code", () => {
      const script = getScript();

      assert(script.includes("message.type"), "Should check message type");
      assert(script.includes("case 'connected'"), "Should handle connected message");
      assert(script.includes("case 'update'"), "Should handle update message");
      assert(script.includes("case 'reload'"), "Should handle reload message");
    });

    it("includes error handling", () => {
      const script = getScript();

      assert(script.includes("try"), "Should have try-catch blocks");
      assert(script.includes("catch"), "Should have error handling");
      assert(
        script.includes("console.error") || script.includes("console.warn"),
        "Should log errors",
      );
    });

    it("includes reconnection logic", () => {
      const script = getScript();

      assert(script.includes("HMR_RELOAD_DELAY_MS"), "Should define reload delay");
      assert(script.includes("setTimeout"), "Should have reconnection timeout");
      assert(script.includes("window.location.reload"), "Should reload page on disconnect");
    });

    it("includes cleanup logic", () => {
      const script = getScript();

      assert(script.includes("beforeunload"), "Should handle beforeunload event");
      assert(script.includes("clearTimeout"), "Should clear timeouts");
      assert(script.includes("ws.close"), "Should close WebSocket on unload");
    });
  });

  describe("HMR Runtime - React Refresh Support", () => {
    it("handles reactRefresh option", () => {
      const scriptWith = getScript({ reactRefresh: true });
      const scriptWithout = getScript({ reactRefresh: false });

      assertExists(scriptWith);
      assertExists(scriptWithout);

      assert(scriptWith.includes("reactRefreshEnabled"));
      assert(scriptWithout.includes("reactRefreshEnabled"));
    });

    it("includes React Refresh handler when enabled", () => {
      const script = getScript({ reactRefresh: true });

      assert(script.includes("reactRefreshEnabled"), "Should track React Refresh state");
      assert(script.includes("$RefreshReg$"), "Should check for React Refresh runtime");
    });

    it("falls back to full reload without React Refresh", () => {
      const script = getScript({ reactRefresh: false });

      assert(script.includes("window.location.reload"), "Should reload window as fallback");
    });
  });

  describe("HMR Runtime - CSS Update Handling", () => {
    it("includes CSS refresh function", () => {
      const script = getScript();

      assert(script.includes("refreshTailwindCSS"), "Should have refreshTailwindCSS function");
      assert(script.includes(".css"), "Should check for CSS files");
    });

    it("handles CSS file updates via link refresh", () => {
      const script = getScript();

      assert(script.includes("vf-tailwind-css"), "Should target Tailwind CSS link");
      assert(script.includes("Date.now"), "Should add cache-busting timestamp");
    });

    it("updates link href with timestamp", () => {
      const script = getScript();

      assert(script.includes("link.href"), "Should update link href");
      assert(script.includes("/_vf_styles/styles.css"), "Should use styles endpoint");
    });
  });

  describe("HMR Runtime - Message Validation", () => {
    it("validates message structure", () => {
      const script = getScript();

      assert(script.includes("JSON.parse"), "Should parse JSON messages");
      assert(script.includes("message.type"), "Should check message type");
    });

    it("handles unknown message types", () => {
      const script = getScript();

      assert(
        script.includes("default:") || script.includes("console.warn"),
        "Should handle unknown types",
      );
    });

    it("handles missing path in updates", () => {
      const script = getScript();

      assert(
        script.includes("update.path") || script.includes("!update.path"),
        "Should check for path",
      );
    });

    it("includes error handling for malformed messages", () => {
      const script = getScript();

      assert(script.includes("catch"), "Should catch parsing errors");
      assert(script.includes("console.error"), "Should log parse errors");
    });
  });

  describe("HMR Runtime - Script Structure", () => {
    it("wraps code in IIFE", () => {
      const script = getScript();

      assert(script.includes("(function ()"), "Should start with IIFE");
      assert(script.includes("})();"), "Should end with IIFE invocation");
    });

    it("exposes WebSocket for debugging", () => {
      const script = getScript();

      assert(script.includes("window.__veryfrontHMRWebSocket"), "Should expose WebSocket globally");
    });

    it("declares constants at top level", () => {
      const script = getScript();

      assert(script.includes("const HMR_RELOAD_DELAY_MS"), "Should declare constants");
      assert(script.includes("const host"), "Should declare host variable");
      assert(script.includes("const ws"), "Should declare WebSocket variable");
    });

    it("uses proper scoping for variables", () => {
      const script = getScript();

      assert(
        script.includes("const ") || script.includes("let "),
        "Should use modern variable declarations",
      );
    });
  });

  describe("HMR Runtime - Connection Resilience", () => {
    it("handles reconnection timeout", () => {
      const script = getScript();

      assert(script.includes("reconnectTimeoutId"), "Should track reconnection timeout");
      assert(script.includes("setTimeout"), "Should schedule reconnection");
    });

    it("clears timeout on reconnection", () => {
      const script = getScript();

      assert(script.includes("clearTimeout"), "Should clear timeout");
      assert(script.includes("reconnectTimeoutId !== null"), "Should check timeout exists");
    });

    it("handles multiple disconnect/reconnect cycles", () => {
      const script = getScript();

      assert(script.includes("clearTimeout"), "Should handle cleanup");
      assert(script.includes("setTimeout"), "Should handle new timeouts");
    });
  });

  describe("HMR Runtime - Production Safety", () => {
    it("generates script without syntax errors", () => {
      const script = getScript();

      const openBraces = (script.match(/\{/g) || []).length;
      const closeBraces = (script.match(/\}/g) || []).length;
      const openParens = (script.match(/\(/g) || []).length;
      const closeParens = (script.match(/\)/g) || []).length;

      assertEquals(openBraces, closeBraces, "Braces should be balanced");
      assertEquals(openParens, closeParens, "Parentheses should be balanced");
    });

    it("includes appropriate logging for development", () => {
      const script = getScript();

      assert(script.includes("console.log"), "Should have console.log for HMR feedback");
      assert(script.includes("console.error"), "Should log errors");
    });

    it("handles edge cases gracefully", () => {
      const script = getScript();

      const tryCount = (script.match(/try\s*\{/g) || []).length;
      const catchCount = (script.match(/catch\s*\(/g) || []).length;

      assert(tryCount > 0, "Should have try blocks");
      assert(catchCount > 0, "Should have catch blocks");
      assertEquals(tryCount, catchCount, "Try and catch should be balanced");
    });
  });

  describe("HMR Runtime - Performance", () => {
    it("generates script quickly", () => {
      const start = performance.now();
      getScript();
      const duration = performance.now() - start;

      assert(duration < 10, `Script generation should be <10ms, took ${duration}ms`);
    });

    it("generates consistent output", () => {
      const script1 = getScript();
      const script2 = getScript();

      assertEquals(script1, script2, "Should generate identical output for same options");
    });

    it("script size is reasonable", () => {
      const script = getScript();

      assert(script.length < 10 * 1024, `Script should be <10KB, is ${script.length} bytes`);
    });
  });

  describe("HMR Runtime - Different Port Numbers", () => {
    it("handles standard ports", () => {
      const ports = [3000, 3001, 8080, 8000];

      for (const port of ports) {
        const script = getScript({ port });
        assert(script.includes(port.toString()), `Should include port ${port}`);
      }
    });

    it("handles high port numbers", () => {
      const script = getScript({ port: 65535 });
      assert(script.includes("65535"), "Should handle maximum port number");
    });

    it("handles low port numbers", () => {
      const script = getScript({ port: 1024 });
      assert(script.includes("1024"), "Should handle low port numbers");
    });
  });
});
