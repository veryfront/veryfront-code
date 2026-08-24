import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for bridge-message-handler: URL validation and route handling.
 */

import { assertEquals } from "@std/assert";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import { setConfigForTest } from "./bridge-config.ts";
import {
  handleStudioMessage,
  isSafeNavigationUrl,
  sanitizeNavigationUrl,
} from "./bridge-message-handler.ts";
import { _resetForTest } from "./bridge-messaging.ts";
import { state } from "./bridge-state.ts";

// ---------------------------------------------------------------------------
// Browser API polyfills for Deno test environment
// ---------------------------------------------------------------------------

if (typeof globalThis.window === "undefined") {
  (globalThis as any).window = globalThis;
}
if (typeof globalThis.location === "undefined") {
  (globalThis as any).location = {
    href: "https://test.veryfront.com/test",
    origin: "https://test.veryfront.com",
    hostname: "test.veryfront.com",
    reload: () => {},
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetState(pagePath = "test.md"): void {
  _resetForTest();
  postedToStudio.length = 0;
  (globalThis as any).location.reload = () => {};
  setConfigForTest({ pagePath, pageId: "test-id", projectId: "proj-id" });
}

// What the preview posted back to Studio. Recorded rather than discarded so the
// notifications the handler owes Studio are observable, not just local state.
const postedToStudio: Record<string, unknown>[] = [];

// Fake parent window reference so isFromStudio accepts the event
const fakeParentWindow = {
  postMessage(message: Record<string, unknown>): void {
    postedToStudio.push(message);
  },
} as unknown as Window;
(globalThis as any).window.parent = fakeParentWindow;

function makeEvent(data: Record<string, unknown>): MessageEvent {
  return {
    data,
    origin: "https://veryfront.com",
    source: fakeParentWindow,
    ports: [],
  } as unknown as MessageEvent;
}

function makeOverlay(): HTMLElement {
  return {
    style: { display: "block" },
    querySelector: () => null,
  } as unknown as HTMLElement;
}

function captureNavigation(): { navigatedTo(): string; restore(): void } {
  let navigatedTo = "";
  Object.defineProperty(globalThis.location, "href", {
    set(v: string) {
      navigatedTo = v;
    },
    get() {
      return "https://test.veryfront.com/test";
    },
    configurable: true,
  });

  return {
    navigatedTo: () => navigatedTo,
    restore() {
      Object.defineProperty(globalThis.location, "href", {
        value: "https://test.veryfront.com/test",
        writable: true,
        configurable: true,
      });
    },
  };
}

/**
 * Minimal DOM for the screenshot path.
 *
 * `html2canvas` is normally fetched from a CDN, which is unreachable here, so
 * the loaded flag is pre-set and the global is stubbed instead.
 */
async function withScreenshotDom(run: () => Promise<void>): Promise<void> {
  const globalRecord = globalThis as any;
  const keys = [
    "document",
    "scrollTo",
    "html2canvas",
    "innerHeight",
    "devicePixelRatio",
    "scrollY",
  ];
  const previous = new Map(keys.map((key) => [key, globalRecord[key]]));

  globalRecord.document = { documentElement: { scrollHeight: 480 }, body: {} };
  globalRecord.scrollTo = () => {};
  globalRecord.html2canvas = () =>
    Promise.resolve({
      width: 320,
      height: 240,
      toDataURL: () => `data:image/png;base64,${"A".repeat(200)}`,
    });
  globalRecord.innerHeight = 240;
  globalRecord.devicePixelRatio = 1;
  globalRecord.scrollY = 0;
  state.html2canvasLoaded = true;

  try {
    await run();
  } finally {
    state.html2canvasLoaded = false;
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete globalRecord[key];
      else globalRecord[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// isSafeNavigationUrl
// ---------------------------------------------------------------------------

Deno.test("isSafeNavigationUrl: allows relative URLs", () => {
  assertEquals(isSafeNavigationUrl("/page"), true);
  assertEquals(isSafeNavigationUrl("/some/deep/path"), true);
});

Deno.test("isSafeNavigationUrl: allows same-origin https URLs", () => {
  assertEquals(isSafeNavigationUrl("https://test.veryfront.com/page"), true);
});

Deno.test("isSafeNavigationUrl: allows veryfront.com URLs", () => {
  assertEquals(isSafeNavigationUrl("https://veryfront.com/page"), true);
  assertEquals(isSafeNavigationUrl("https://slug.preview.veryfront.com/page"), true);
});

Deno.test("isSafeNavigationUrl: blocks protocol-relative URLs", () => {
  assertEquals(isSafeNavigationUrl("//evil.com/path"), false);
  assertEquals(isSafeNavigationUrl("//evil.com"), false);
});

Deno.test("isSafeNavigationUrl: blocks non-veryfront URLs", () => {
  assertEquals(isSafeNavigationUrl("https://example.com/page"), false);
  assertEquals(isSafeNavigationUrl("http://evil.com/page"), false);
});

Deno.test("isSafeNavigationUrl: blocks javascript: URLs", () => {
  assertEquals(isSafeNavigationUrl("javascript:alert(1)"), false);
  assertEquals(isSafeNavigationUrl("JavaScript:alert(1)"), false);
});

Deno.test("isSafeNavigationUrl: blocks data: URLs", () => {
  assertEquals(isSafeNavigationUrl("data:text/html,<script>alert(1)</script>"), false);
});

Deno.test("isSafeNavigationUrl: blocks vbscript: URLs", () => {
  assertEquals(isSafeNavigationUrl("vbscript:msgbox"), false);
});

Deno.test("isSafeNavigationUrl: blocks non-web protocols", () => {
  assertEquals(isSafeNavigationUrl("mailto:user@example.com"), false);
  assertEquals(isSafeNavigationUrl("intent://example.com"), false);
  assertEquals(isSafeNavigationUrl("ftp://example.com/file"), false);
});

// ---------------------------------------------------------------------------
// routeChange: URL validation
// ---------------------------------------------------------------------------

Deno.test("routeChange: navigates for safe relative URL", () => {
  resetState();
  let navigatedTo = "";
  (globalThis as any).location.href = "https://test.veryfront.com/test";
  Object.defineProperty(globalThis.location, "href", {
    set(v: string) {
      navigatedTo = v;
    },
    get() {
      return "https://test.veryfront.com/test";
    },
    configurable: true,
  });

  handleStudioMessage(makeEvent({ action: "routeChange", url: "/new-page" }));
  assertEquals(navigatedTo, "https://test.veryfront.com/new-page");

  // Restore
  Object.defineProperty(globalThis.location, "href", {
    value: "https://test.veryfront.com/test",
    writable: true,
    configurable: true,
  });
});

Deno.test("routeChange: ignores a message from an untrusted origin", () => {
  resetState();
  state.selectedNodeId = "node-123";
  state.selectionOverlay = makeOverlay();
  const navigation = captureNavigation();

  try {
    handleStudioMessage(
      {
        data: { action: "routeChange", url: "/new-page" },
        origin: "https://evil.com",
        source: fakeParentWindow,
        ports: [],
      } as unknown as MessageEvent,
    );

    assertEquals(
      navigation.navigatedTo(),
      "",
      "a message from an untrusted origin must not navigate",
    );
    assertEquals(
      state.selectedNodeId,
      "node-123",
      "the origin guard must run before any state is mutated",
    );
  } finally {
    navigation.restore();
  }
});

Deno.test("routeChange: ignores a message from a window other than the studio parent", () => {
  resetState();
  const navigation = captureNavigation();

  try {
    handleStudioMessage(
      {
        data: { action: "routeChange", url: "/new-page" },
        origin: "https://veryfront.com",
        source: { postMessage(): void {} } as unknown as Window,
        ports: [],
      } as unknown as MessageEvent,
    );

    assertEquals(
      navigation.navigatedTo(),
      "",
      "a message from a window other than the studio parent must not navigate",
    );
  } finally {
    navigation.restore();
  }
});

Deno.test("routeChange: blocks protocol-relative URL", () => {
  resetState();
  let navigatedTo = "";
  Object.defineProperty(globalThis.location, "href", {
    set(v: string) {
      navigatedTo = v;
    },
    get() {
      return "https://test.veryfront.com/test";
    },
    configurable: true,
  });

  handleStudioMessage(makeEvent({ action: "routeChange", url: "//evil.com/path" }));
  assertEquals(navigatedTo, ""); // Should NOT navigate

  // Restore
  Object.defineProperty(globalThis.location, "href", {
    value: "https://test.veryfront.com/test",
    writable: true,
    configurable: true,
  });
});

Deno.test("routeChange: blocks javascript: URL", () => {
  resetState();
  let navigatedTo = "";
  Object.defineProperty(globalThis.location, "href", {
    set(v: string) {
      navigatedTo = v;
    },
    get() {
      return "https://test.veryfront.com/test";
    },
    configurable: true,
  });

  handleStudioMessage(makeEvent({ action: "routeChange", url: "javascript:alert(1)" }));
  assertEquals(navigatedTo, ""); // Should NOT navigate

  // Restore
  Object.defineProperty(globalThis.location, "href", {
    value: "https://test.veryfront.com/test",
    writable: true,
    configurable: true,
  });
});

Deno.test("routeChange: assigns normalized URL, not raw input", () => {
  resetState();
  let navigatedTo = "";
  Object.defineProperty(globalThis.location, "href", {
    set(v: string) {
      navigatedTo = v;
    },
    get() {
      return "https://test.veryfront.com/test";
    },
    configurable: true,
  });

  // Path traversal gets normalized by new URL().href — proves the handler uses
  // the sanitized value rather than the raw postMessage input.
  handleStudioMessage(
    makeEvent({ action: "routeChange", url: "https://test.veryfront.com/a/../b" }),
  );
  assertEquals(navigatedTo, "https://test.veryfront.com/b");

  Object.defineProperty(globalThis.location, "href", {
    value: "https://test.veryfront.com/test",
    writable: true,
    configurable: true,
  });
});

Deno.test("routeChange: clears existing selection before navigating", () => {
  resetState();
  state.selectedNodeId = "node-123";
  state.selectionOverlay = makeOverlay();

  let navigatedTo = "";
  Object.defineProperty(globalThis.location, "href", {
    set(v: string) {
      navigatedTo = v;
    },
    get() {
      return "https://test.veryfront.com/test";
    },
    configurable: true,
  });

  handleStudioMessage(makeEvent({ action: "routeChange", url: "/new-page" }));

  assertEquals(state.selectedNodeId, null);
  assertEquals(state.selectionOverlay?.style.display, "none");
  assertEquals(navigatedTo, "https://test.veryfront.com/new-page");
  assertEquals(
    postedToStudio[0],
    { action: "setSelectedNode", id: null },
    "the preview tells Studio the selection was dropped before navigating",
  );
  assertEquals(
    postedToStudio[1],
    {
      action: "onPageTransitionStart",
      url: "https://test.veryfront.com/new-page",
      projectId: "proj-id",
    },
    "Studio is notified with the sanitized URL, not the raw input",
  );

  Object.defineProperty(globalThis.location, "href", {
    value: "https://test.veryfront.com/test",
    writable: true,
    configurable: true,
  });
});

Deno.test("toggleInspectMode: disabling inspect mode clears hover state only", () => {
  resetState();
  state.inspectMode = true;
  state.hoveredNodeId = "hovered-node";
  state.selectedNodeId = "selected-node";
  state.hoverOverlay = makeOverlay();
  state.selectionOverlay = makeOverlay();

  handleStudioMessage(makeEvent({ action: "toggleInspectMode", value: false }));

  assertEquals(state.inspectMode, false);
  assertEquals(state.hoveredNodeId, null);
  assertEquals(state.hoverOverlay?.style.display, "none");
  assertEquals(state.selectedNodeId, "selected-node");
  assertEquals(state.selectionOverlay?.style.display, "block");
});

Deno.test("toggleInspectMode: deselectElements also clears selection", () => {
  resetState();
  state.inspectMode = true;
  state.selectedNodeId = "selected-node";
  state.selectionOverlay = makeOverlay();

  handleStudioMessage(
    makeEvent({ action: "toggleInspectMode", value: false, deselectElements: true }),
  );

  assertEquals(state.inspectMode, false);
  assertEquals(state.selectedNodeId, null);
  assertEquals(state.selectionOverlay?.style.display, "none");
});

Deno.test("screenshot: answers a single-capture request with a screenshotResult", async () => {
  resetState();

  await withScreenshotDom(async () => {
    handleStudioMessage(makeEvent({ action: "screenshot", requestId: "req-1" }));
    await waitFor(() => postedToStudio.length > 0, {
      message: "Studio's screenshot request was never answered",
    });

    assertEquals(postedToStudio.length, 1, "a screenshot request is answered exactly once");
    assertEquals(
      postedToStudio[0]?.action,
      "screenshotResult",
      "the reply must be a screenshotResult",
    );
    assertEquals(postedToStudio[0]?.requestId, "req-1", "the reply must carry the requestId back");
    assertEquals(postedToStudio[0]?.multiple, false, "a single capture is not a multi-section one");
    assertEquals(postedToStudio[0]?.success, true, "the capture succeeded");
  });
});

Deno.test("screenshot: routes a multipleSections request to the multi-section capture", async () => {
  resetState();

  await withScreenshotDom(async () => {
    handleStudioMessage(
      makeEvent({
        action: "screenshot",
        requestId: "req-2",
        multipleSections: true,
        sectionCount: 1,
      }),
    );
    await waitFor(() => postedToStudio.length > 0, {
      message: "Studio's multi-section screenshot request was never answered",
    });

    assertEquals(postedToStudio.length, 1, "a screenshot request is answered exactly once");
    assertEquals(
      postedToStudio[0]?.action,
      "screenshotResult",
      "the reply must be a screenshotResult",
    );
    assertEquals(postedToStudio[0]?.requestId, "req-2", "the reply must carry the requestId back");
    assertEquals(
      postedToStudio[0]?.multiple,
      true,
      "multipleSections must reach the multi-section capture",
    );
    assertEquals(
      (postedToStudio[0]?.results as unknown[]).length,
      1,
      "the requested section count is honored",
    );
  });
});

Deno.test("setSelectedNode: scrolls to the element only when asked", () => {
  resetState();
  state.selectionOverlay = makeOverlay();

  const globalRecord = globalThis as any;
  const previousDocument = globalRecord.document;
  let scrollIntoViewCalls = 0;
  const element = {
    getAttribute: () => null,
    tagName: "DIV",
    getBoundingClientRect: () => ({ top: 10, left: 20, width: 30, height: 40 }),
    scrollIntoView: () => {
      scrollIntoViewCalls++;
    },
  };
  globalRecord.document = { querySelector: () => element };

  try {
    handleStudioMessage(makeEvent({ action: "setSelectedNode", id: "node-1" }));

    assertEquals(state.selectedNodeId, "node-1", "the selection is recorded");
    assertEquals(
      state.selectionOverlay?.style.display,
      "block",
      "the selection overlay is shown over the element",
    );
    assertEquals(scrollIntoViewCalls, 0, "a selection without scroll must not move the page");

    handleStudioMessage(makeEvent({ action: "setSelectedNode", id: "node-2", scroll: true }));

    assertEquals(state.selectedNodeId, "node-2", "the new selection is recorded");
    assertEquals(scrollIntoViewCalls, 1, "scroll: true must bring the element into view");
  } finally {
    if (previousDocument === undefined) delete globalRecord.document;
    else globalRecord.document = previousDocument;
  }
});

// ---------------------------------------------------------------------------
// sanitizeNavigationUrl
// ---------------------------------------------------------------------------

Deno.test("sanitizeNavigationUrl: returns normalized href for relative paths", () => {
  assertEquals(sanitizeNavigationUrl("/page"), "https://test.veryfront.com/page");
  assertEquals(sanitizeNavigationUrl("/a/../b"), "https://test.veryfront.com/b");
});

Deno.test("sanitizeNavigationUrl: returns normalized href for same-origin URLs", () => {
  const result = sanitizeNavigationUrl("https://test.veryfront.com/page");
  assertEquals(result, "https://test.veryfront.com/page");
});

Deno.test("sanitizeNavigationUrl: allows veryfront.com subdomains", () => {
  assertEquals(
    sanitizeNavigationUrl("https://slug.preview.veryfront.com/page"),
    "https://slug.preview.veryfront.com/page",
  );
  assertEquals(
    sanitizeNavigationUrl("https://veryfront.com/dashboard"),
    "https://veryfront.com/dashboard",
  );
});

Deno.test("sanitizeNavigationUrl: blocks non-veryfront domains", () => {
  assertEquals(sanitizeNavigationUrl("https://evil.com/page"), null);
  assertEquals(sanitizeNavigationUrl("https://notveryfront.com/page"), null);
});

Deno.test("sanitizeNavigationUrl: blocks protocol-relative URLs", () => {
  assertEquals(sanitizeNavigationUrl("//evil.com/path"), null);
  assertEquals(sanitizeNavigationUrl("//evil.com"), null);
});

Deno.test("sanitizeNavigationUrl: blocks javascript: protocol", () => {
  assertEquals(sanitizeNavigationUrl("javascript:alert(1)"), null);
});

Deno.test("sanitizeNavigationUrl: blocks data: protocol", () => {
  assertEquals(sanitizeNavigationUrl("data:text/html,<script>alert(1)</script>"), null);
  assertEquals(
    sanitizeNavigationUrl("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="),
    null,
  );
});

Deno.test("sanitizeNavigationUrl: blocks empty and invalid input", () => {
  assertEquals(sanitizeNavigationUrl(""), null);
  assertEquals(sanitizeNavigationUrl(null as unknown as string), null);
  assertEquals(sanitizeNavigationUrl(123 as unknown as string), null);
});
