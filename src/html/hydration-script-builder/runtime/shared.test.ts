import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeDocument, RuntimeWindow } from "./env.ts";
import {
  createLogging,
  getDocumentNonce,
  isAbortError,
  moduleServerUrl,
  normalizeRouteParams,
} from "./shared.ts";

function stubWindow(
  location: { origin?: string; search?: string },
  debug?: boolean,
): RuntimeWindow {
  return {
    location: {
      origin: location.origin ?? "https://veryfront.test",
      search: location.search ?? "",
    },
    __VERYFRONT_DEBUG__: debug,
  } as unknown as RuntimeWindow;
}

function stubDocument(element: unknown): RuntimeDocument {
  return { querySelector: () => element } as unknown as RuntimeDocument;
}

/** Swaps the console before `createLogging` binds it, then restores it. */
function withCapturedConsole(
  run: (captured: { log: unknown[][]; error: unknown[][] }) => void,
): void {
  const captured = { log: [] as unknown[][], error: [] as unknown[][] };
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => {
    captured.log.push(args);
  };
  console.error = (...args: unknown[]) => {
    captured.error.push(args);
  };

  try {
    run(captured);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

describe("hydration-script-builder/runtime/shared", () => {
  describe("normalizeRouteParams", () => {
    it("joins catch-all segments and passes strings through", () => {
      assertEquals(
        normalizeRouteParams({ slug: ["guides", "intro"], lang: "en" }),
        { slug: "guides/intro", lang: "en" },
      );
    });

    // The declared parameter type rules these out, but hydration data is
    // server-written JSON, so the runtime behaviour still has to hold.
    it("skips undefined values", () => {
      const withHole = { id: "42", draft: undefined } as unknown as Record<string, string>;
      assertEquals(normalizeRouteParams(withHole), { id: "42" });
    });

    it("returns an empty object for missing params", () => {
      assertEquals(normalizeRouteParams(null as unknown as undefined), {});
      assertEquals(normalizeRouteParams(undefined), {});
    });
  });

  describe("isAbortError", () => {
    it("recognizes aborted requests", () => {
      assertEquals(isAbortError({ name: "AbortError" }), true);
      assertEquals(isAbortError(new DOMException("x", "AbortError")), true);
    });

    it("does not claim other failures", () => {
      assertEquals(isAbortError(null), false);
      assertEquals(isAbortError(undefined), false);
      assertEquals(isAbortError(new TypeError("Failed to fetch")), false);
    });
  });

  describe("getDocumentNonce", () => {
    it("returns the nonce property", () => {
      assertEquals(getDocumentNonce(stubDocument({ nonce: "abc" })), "abc");
    });

    it("falls back to the nonce attribute", () => {
      assertEquals(
        getDocumentNonce(
          stubDocument({ getAttribute: (name: string) => name === "nonce" ? "xyz" : null }),
        ),
        "xyz",
      );
    });

    it("returns undefined when no element carries a nonce", () => {
      assertEquals(getDocumentNonce(stubDocument(null)), undefined);
    });
  });

  describe("moduleServerUrl", () => {
    it("resolves the module server against the window origin", () => {
      assertEquals(
        moduleServerUrl(stubWindow({ origin: "https://veryfront.test" })),
        "https://veryfront.test/_vf_modules",
      );
    });
  });

  describe("createLogging", () => {
    it("keeps DEBUG off by default", () => {
      withCapturedConsole(() => {
        assertEquals(createLogging(stubWindow({})).DEBUG, false);
      });
    });

    it("turns DEBUG on for the window flag", () => {
      withCapturedConsole(() => {
        assertEquals(createLogging(stubWindow({}, true)).DEBUG, true);
      });
    });

    it("turns DEBUG on for the vf_debug search param", () => {
      withCapturedConsole(() => {
        assertEquals(createLogging(stubWindow({ search: "?vf_debug=1" })).DEBUG, true);
      });
    });

    it("makes log a no-op when DEBUG is off", () => {
      withCapturedConsole((captured) => {
        createLogging(stubWindow({})).log("quiet");
        assertEquals(captured.log, []);
      });
    });

    it("writes log output when DEBUG is on", () => {
      withCapturedConsole((captured) => {
        createLogging(stubWindow({}, true)).log("loud");
        assertEquals(captured.log, [["[Veryfront]", "loud"]]);
      });
    });

    it("always writes logError", () => {
      withCapturedConsole((captured) => {
        createLogging(stubWindow({})).logError("boom");
        assertEquals(captured.error, [["[Veryfront]", "boom"]]);
      });
    });

    it("logs background fetch failures with the error message when there is one", () => {
      withCapturedConsole((captured) => {
        const { logBackgroundFetchFailure } = createLogging(stubWindow({}, true));

        logBackgroundFetchFailure("Page data prefetch", "/docs", new Error("boom"));
        logBackgroundFetchFailure("Stale page data refresh", "/docs", 42);

        assertEquals(captured.log, [
          ["[Veryfront]", "Page data prefetch failed:", "/docs", "boom"],
          ["[Veryfront]", "Stale page data refresh failed:", "/docs", "42"],
        ]);
      });
    });
  });
});
