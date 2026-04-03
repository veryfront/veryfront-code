/**
 * Tests for bridge-message-handler: URL validation and route handling.
 */

import { assertEquals } from "@std/assert";
import { setConfigForTest } from "./bridge-config.ts";
import { handleStudioMessage, isSafeNavigationUrl } from "./bridge-message-handler.ts";
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
    hostname: "test.veryfront.com",
    reload: () => {},
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetState(pagePath = "test.md"): void {
  (globalThis as any).location.reload = () => {};
  setConfigForTest({ pagePath, pageId: "test-id", projectId: "proj-id" });
}

// Fake parent window reference so isFromStudio accepts the event
const fakeParentWindow = {} as Window;

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

Deno.test("isSafeNavigationUrl: allows https URLs", () => {
  assertEquals(isSafeNavigationUrl("https://example.com/page"), true);
});

Deno.test("isSafeNavigationUrl: allows http URLs", () => {
  assertEquals(isSafeNavigationUrl("http://example.com/page"), true);
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
  assertEquals(navigatedTo, "/new-page");

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
  assertEquals(navigatedTo, "/new-page");

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
