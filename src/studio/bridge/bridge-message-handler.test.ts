import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for bridge-message-handler: URL validation and route handling.
 */

import { assertEquals } from "@std/assert";
import { setConfigForTest } from "./bridge-config.ts";
import {
  handleStudioMessage,
  invalidateStudioMessageOperations,
  isSafeNavigationUrl,
  parseStudioMessage,
  runExclusiveScreenshotCapture,
  sanitizeNavigationUrl,
} from "./bridge-message-handler.ts";
import { _flushPendingForTest, _resetForTest } from "./bridge-messaging.ts";
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
  (globalThis as any).location.reload = () => {};
  setConfigForTest({ pagePath, pageId: "test-id", projectId: "proj-id" });
}

// Fake parent window reference so isFromStudio accepts the event
const fakeParentWindow = { postMessage(): void {} } as unknown as Window;
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
  return { style: { display: "block" } } as unknown as HTMLElement;
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

Deno.test("isSafeNavigationUrl: allows hosted veryfront.org URLs", () => {
  assertEquals(isSafeNavigationUrl("https://veryfront.org/page"), true);
  assertEquals(isSafeNavigationUrl("https://slug.preview.veryfront.org/page"), true);
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

  // Path traversal gets normalized by new URL().href, which proves the handler uses
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
  assertEquals(sanitizeNavigationUrl("//test.veryfront.com/path"), null);
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

Deno.test("sanitizeNavigationUrl: blocks credentials, downgrade, and control characters", () => {
  assertEquals(sanitizeNavigationUrl("https://user:secret@veryfront.com/page"), null);
  assertEquals(sanitizeNavigationUrl("http://veryfront.com/page"), null);
  assertEquals(sanitizeNavigationUrl("/page\nnext"), null);
});

Deno.test("sanitizeNavigationUrl: blocks empty and invalid input", () => {
  assertEquals(sanitizeNavigationUrl(""), null);
  assertEquals(sanitizeNavigationUrl(null as unknown as string), null);
  assertEquals(sanitizeNavigationUrl(123 as unknown as string), null);
});

Deno.test("sanitizeNavigationUrl: rejects normalized URLs beyond the protocol bound", () => {
  const raw = `/${" ".repeat(2_000)}`;
  assertEquals(raw.length <= 2_048, true);
  assertEquals(sanitizeNavigationUrl(raw), null);
});

Deno.test("parseStudioMessage: snapshots a bounded screenshot request", () => {
  const message = {
    action: "screenshot",
    requestId: "request-1",
    options: { scrollTo: 120, fullPage: false },
  };

  const parsed = parseStudioMessage(message);
  message.options.scrollTo = 999;

  assertEquals(parsed, {
    action: "screenshot",
    requestId: "request-1",
    options: { scrollTo: 120, fullPage: false },
  });
});

Deno.test("parseStudioMessage: ignores bounded forward-compatible message fields", () => {
  assertEquals(parseStudioMessage({ action: "reload", protocolVersion: 2 }), {
    action: "reload",
  });
  assertEquals(
    parseStudioMessage({
      action: "screenshot",
      options: { fullPage: true },
      responseFormat: "png",
    }),
    { action: "screenshot", options: { fullPage: true } },
  );
});

Deno.test("parseStudioMessage: rejects unsupported or incompatible screenshot fields", () => {
  assertEquals(
    parseStudioMessage({ action: "screenshot", options: { quality: 0.8 } }),
    null,
  );
  assertEquals(
    parseStudioMessage({ action: "screenshot", options: { captureTarget: "viewport" } }),
    null,
  );
  assertEquals(parseStudioMessage({ action: "screenshot", sectionCount: 3 }), null);
  assertEquals(
    parseStudioMessage({ action: "screenshot", multipleSections: false, sectionCount: 3 }),
    null,
  );
  assertEquals(
    parseStudioMessage({
      action: "screenshot",
      multipleSections: true,
      options: { scrollTo: 120 },
    }),
    null,
  );
  assertEquals(
    parseStudioMessage({
      action: "screenshot",
      multipleSections: true,
      options: { fullPage: false },
    }),
    null,
  );
  assertEquals(
    parseStudioMessage({ action: "screenshot", multipleSections: true, options: {} }),
    null,
  );
  assertEquals(
    parseStudioMessage({ action: "screenshot", multipleSections: true, sectionCount: 3 }),
    { action: "screenshot", multipleSections: true, sectionCount: 3 },
  );
});

Deno.test("parseStudioMessage: rejects messages beyond the property budget", () => {
  assertEquals(
    parseStudioMessage({
      action: "reload",
      field1: 1,
      field2: 2,
      field3: 3,
      field4: 4,
      field5: 5,
      field6: 6,
      field7: 7,
      field8: 8,
    }),
    null,
  );
});

Deno.test("parseStudioMessage: treats an empty hovered node id as clear", () => {
  assertEquals(parseStudioMessage({ action: "setHoveredNode", id: "" }), {
    action: "setHoveredNode",
    id: null,
  });
});

Deno.test("setHoveredNode: updates and clears hover state outside inspect mode", () => {
  resetState();
  state.inspectMode = false;
  state.hoveredNodeId = null;
  state.hoverOverlay = makeOverlay();

  const previousDocument = globalThis.document;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      querySelector: () => null,
      querySelectorAll: () => [],
    },
  });
  try {
    handleStudioMessage(makeEvent({ action: "setHoveredNode", id: "node-456" }));
    assertEquals(state.hoveredNodeId, "node-456");
    assertEquals(state.hoverOverlay.style.display, "none");

    state.hoverOverlay.style.display = "block";
    handleStudioMessage(makeEvent({ action: "setHoveredNode", id: "" }));
    assertEquals(state.hoveredNodeId, null);
    assertEquals(state.hoverOverlay.style.display, "none");
  } finally {
    if (previousDocument === undefined) {
      delete (globalThis as { document?: Document }).document;
    } else {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  }
});

Deno.test("setHoveredNode: leaves inspect-owned hover state unchanged", () => {
  resetState();
  state.inspectMode = true;
  state.hoveredNodeId = "inspected-node";
  state.hoverOverlay = makeOverlay();

  handleStudioMessage(makeEvent({ action: "setHoveredNode", id: "" }));

  assertEquals(state.hoveredNodeId, "inspected-node");
  assertEquals(state.hoverOverlay.style.display, "block");

  state.inspectMode = false;
  state.hoveredNodeId = null;
  state.hoverOverlay = null;
});

Deno.test("parseStudioMessage: rejects accessors without executing them", () => {
  let getterCalls = 0;
  const message = Object.defineProperty({}, "action", {
    enumerable: true,
    get() {
      getterCalls++;
      return "reload";
    },
  });

  assertEquals(parseStudioMessage(message), null);
  assertEquals(getterCalls, 0);
});

Deno.test("parseStudioMessage: rejects malformed and unbounded fields", () => {
  assertEquals(parseStudioMessage({ action: "toggleInspectMode", value: "false" }), null);
  assertEquals(parseStudioMessage({ action: "colorMode", value: "sepia" }), null);
  assertEquals(parseStudioMessage({ action: "setSelectedNode", id: "x".repeat(513) }), null);
  assertEquals(
    parseStudioMessage({ action: "screenshot", multipleSections: true, sectionCount: Infinity }),
    null,
  );
  assertEquals(
    parseStudioMessage({ action: "screenshot", multipleSections: true, sectionCount: 21 }),
    null,
  );
});

Deno.test("parseStudioMessage: rejects retired no-op actions", () => {
  assertEquals(parseStudioMessage({ action: "toggleLayout", value: true }), null);
  assertEquals(parseStudioMessage({ action: "providerId", id: "provider-1" }), null);
  assertEquals(parseStudioMessage({ action: "layoutId", id: "layout-1" }), null);
});

Deno.test("parseStudioMessage: contains revoked proxies", () => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();

  assertEquals(parseStudioMessage(proxy), null);
});

Deno.test("runExclusiveScreenshotCapture: rejects overlap and releases ownership", async () => {
  let release: (() => void) | undefined;
  const first = runExclusiveScreenshotCapture(
    () => new Promise<string>((resolve) => (release = () => resolve("first"))),
  );
  await Promise.resolve();

  assertEquals(await runExclusiveScreenshotCapture(() => Promise.resolve("second")), {
    accepted: false,
  });
  release?.();
  assertEquals(await first, { accepted: true, current: true, value: "first" });
  assertEquals(await runExclusiveScreenshotCapture(() => Promise.resolve("third")), {
    accepted: true,
    current: true,
    value: "third",
  });
});

Deno.test("runExclusiveScreenshotCapture: marks work invalidated by lifecycle teardown", async () => {
  let release: (() => void) | undefined;
  let operationSignal: AbortSignal | undefined;
  const capture = runExclusiveScreenshotCapture(
    (signal) => {
      operationSignal = signal;
      return new Promise<string>((resolve) => (release = () => resolve("stale")));
    },
  );
  await Promise.resolve();
  assertEquals(operationSignal?.aborted, false);

  invalidateStudioMessageOperations();
  assertEquals(operationSignal?.aborted, true);
  release?.();

  assertEquals(await capture, { accepted: true, current: false, value: "stale" });
  assertEquals(await runExclusiveScreenshotCapture(() => Promise.resolve("current")), {
    accepted: true,
    current: true,
    value: "current",
  });
});

Deno.test("runExclusiveScreenshotCapture: contains unexpected capture failures", async () => {
  assertEquals(
    await runExclusiveScreenshotCapture(() => Promise.reject(new Error("private failure"))),
    { accepted: true, current: true, failed: true },
  );
  assertEquals(await runExclusiveScreenshotCapture(() => Promise.resolve("next")), {
    accepted: true,
    current: true,
    value: "next",
  });
});

Deno.test("screenshot: correlates unexpected multi-section failures", async () => {
  resetState();
  const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const parent = fakeParentWindow as unknown as {
    postMessage(message: Record<string, unknown>, targetOrigin: string): void;
  };
  const originalPostMessage = parent.postMessage;
  const messages: Record<string, unknown>[] = [];
  parent.postMessage = (message) => messages.push(message);
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      documentElement: {
        get scrollHeight() {
          throw new Error("private geometry failure");
        },
      },
    },
  });

  try {
    handleStudioMessage(makeEvent({
      action: "screenshot",
      requestId: "capture-1",
      multipleSections: true,
      sectionCount: 1,
    }));
    for (let turn = 0; turn < 5; turn++) await Promise.resolve();
    _flushPendingForTest();

    assertEquals(messages, [{
      action: "screenshotResult",
      requestId: "capture-1",
      multiple: true,
      results: [{ success: false, error: "Screenshot capture failed" }],
    }]);
  } finally {
    parent.postMessage = originalPostMessage;
    if (originalDocumentDescriptor) {
      Object.defineProperty(globalThis, "document", originalDocumentDescriptor);
    } else {
      delete (globalThis as { document?: Document }).document;
    }
    _resetForTest();
  }
});
