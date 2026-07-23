import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateDevErrorLoggerScript } from "./dev-error-logger.ts";

describe("hydration-script-builder/dev-error-logger", () => {
  describe("generateDevErrorLoggerScript", () => {
    it("should return a script tag", () => {
      const result = generateDevErrorLoggerScript();
      assertEquals(result.includes("<script"), true);
      assertEquals(result.includes("</script>"), true);
    });

    it("should include nonce attribute when provided", () => {
      const result = generateDevErrorLoggerScript("abc123");
      assertEquals(result.includes('nonce="abc123"'), true);
    });

    it("should escape nonce attribute when provided", () => {
      const result = generateDevErrorLoggerScript('"abc<123>');
      assertEquals(result.includes('nonce="&quot;abc&lt;123&gt;"'), true);
    });

    it("should not include nonce attribute when not provided", () => {
      const result = generateDevErrorLoggerScript();
      assertEquals(result.includes("nonce="), false);
    });

    it("should not include nonce attribute when undefined", () => {
      const result = generateDevErrorLoggerScript(undefined);
      assertEquals(result.includes("nonce="), false);
    });

    it("should include error event listener", () => {
      const result = generateDevErrorLoggerScript();
      assertEquals(result.includes("addEventListener('error'"), true);
    });

    it("should include unhandled rejection listener", () => {
      const result = generateDevErrorLoggerScript();
      assertEquals(result.includes("addEventListener('unhandledrejection'"), true);
    });

    it("should log to server endpoint", () => {
      const result = generateDevErrorLoggerScript();
      assertEquals(result.includes("/_veryfront/log"), true);
    });

    it("should make failed log POSTs observable without blocking", () => {
      const result = generateDevErrorLoggerScript();
      assertEquals(result.includes(".catch(() => {"), true);
      assertEquals(result.includes("console.debug?.('[Veryfront] dev log POST failed'"), true);
    });

    it("bounds and sanitizes client-provided log data", () => {
      const result = generateDevErrorLoggerScript();
      assertEquals(result.includes("MAX_LOG_TEXT_LENGTH"), true);
      assertEquals(result.includes("MAX_LOG_POSTS"), true);
      assertEquals(result.includes("sanitizeLogText"), true);
      assertEquals(result.includes("args.slice(0, MAX_LOG_ARGS)"), true);
    });

    it("does not transmit raw URLs, source filenames, stacks, or user-agent data", () => {
      const result = generateDevErrorLoggerScript();
      assertEquals(result.includes("window.location.href"), false);
      assertEquals(result.includes("event.filename"), false);
      assertEquals(result.includes(".stack"), false);
      assertEquals(result.includes("navigator.userAgent"), false);
      assertEquals(result.includes("window.location.pathname"), true);
    });

    it("should override console.error", () => {
      const result = generateDevErrorLoggerScript();
      assertEquals(result.includes("console.error"), true);
    });

    it("should override console.warn", () => {
      const result = generateDevErrorLoggerScript();
      assertEquals(result.includes("console.warn"), true);
    });

    it("should include page loaded log", () => {
      const result = generateDevErrorLoggerScript();
      assertEquals(result.includes("Page loaded"), true);
    });

    it("should include HTML comment describing purpose", () => {
      const result = generateDevErrorLoggerScript();
      assertEquals(result.includes("Client-side error logger"), true);
    });

    it("installs listeners and console wrappers only once", () => {
      const html = generateDevErrorLoggerScript();
      const body = html.match(/<script[^>]*>([\s\S]*)<\/script>/)?.[1];
      if (!body) throw new Error("generated logger script body was not found");

      const listeners: Record<string, Array<(event: unknown) => void>> = {};
      const windowStub = {
        location: { pathname: "/page" },
        addEventListener(type: string, listener: (event: unknown) => void) {
          (listeners[type] ??= []).push(listener);
        },
      };
      const requests: string[] = [];
      const requestBodies: string[] = [];
      const fetchStub = (url: string, init?: { body?: unknown }) => {
        requests.push(url);
        requestBodies.push(typeof init?.body === "string" ? init.body : "");
        return Promise.resolve({ ok: true });
      };
      const consoleStub = {
        debug(..._args: unknown[]) {},
        error(..._args: unknown[]) {},
        warn(..._args: unknown[]) {},
      };
      const execute = new Function("window", "fetch", "console", body);

      execute(windowStub, fetchStub, consoleStub);
      execute(windowStub, fetchStub, consoleStub);
      consoleStub.error("/Users/example/private.ts?token=secret Bearer credential");

      assertEquals(listeners.error?.length, 1);
      assertEquals(listeners.unhandledrejection?.length, 1);
      assertEquals(requests.length, 2);
      assertEquals(requestBodies.at(-1)?.includes("/Users/example"), false);
      assertEquals(requestBodies.at(-1)?.includes("credential"), false);
      assertEquals(requestBodies.at(-1)?.includes("<REDACTED>"), true);
    });
  });
});
