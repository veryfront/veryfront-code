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
  resolveDocumentNavigationUrl,
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

  describe("resolveDocumentNavigationUrl", () => {
    const origin = "https://veryfront.test";

    it("resolves a relative path against the supplied navigation base", () => {
      assertEquals(
        resolveDocumentNavigationUrl("/docs/intro", origin),
        "https://veryfront.test/docs/intro",
      );
      assertEquals(
        resolveDocumentNavigationUrl("login", `${origin}/users/account`),
        "https://veryfront.test/users/login",
      );
    });

    it("allows http and https targets", () => {
      assertEquals(
        resolveDocumentNavigationUrl("https://example.test/x", origin),
        "https://example.test/x",
      );
      assertEquals(
        resolveDocumentNavigationUrl("http://example.test/x", origin),
        "http://example.test/x",
      );
    });

    it("refuses schemes that execute when assigned to location.href", () => {
      assertEquals(resolveDocumentNavigationUrl("javascript:alert(1)", origin), null);
      assertEquals(
        resolveDocumentNavigationUrl("data:text/html,<script>alert(1)</script>", origin),
        null,
      );
      assertEquals(resolveDocumentNavigationUrl("vbscript:msgbox(1)", origin), null);
    });

    it("refuses other non-navigable schemes", () => {
      assertEquals(resolveDocumentNavigationUrl("file:///etc/passwd", origin), null);
      assertEquals(resolveDocumentNavigationUrl("blob:https://x/y", origin), null);
    });

    it("returns null for an unparseable target", () => {
      assertEquals(resolveDocumentNavigationUrl("", "not a url"), null);
      assertEquals(resolveDocumentNavigationUrl("http://[", origin), null);
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

    // performance.now() returning 0 is a legitimate timestamp, not a missing
    // timer. A falsy check would leak the map entry and skip the measurement.
    it("measures a span that started at timestamp zero", () => {
      const originalNow = performance.now;
      const readings = [0, 5];
      let call = 0;
      performance.now = () => readings[Math.min(call++, readings.length - 1)] as number;
      try {
        withCapturedConsole((captured) => {
          const { perfStart, perfEnd } = createLogging(stubWindow({}, true));
          perfStart("boot");
          assertEquals(perfEnd("boot"), 5);
          assertEquals(captured.log.length, 1);
        });
      } finally {
        performance.now = originalNow;
      }
    });

    it("returns zero and logs nothing for a label that was never started", () => {
      withCapturedConsole((captured) => {
        const { perfEnd } = createLogging(stubWindow({}, true));
        assertEquals(perfEnd("never-started"), 0);
        assertEquals(captured.log, []);
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
