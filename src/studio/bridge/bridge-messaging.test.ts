import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for bridge-messaging: postMessage target origin handling and
 * pre-handshake buffering (SEC-002).
 */

import { assert, assertEquals } from "@std/assert";
import { FakeTime } from "#std/testing/time";
import {
  _flushPendingForTest,
  _pendingCountForTest,
  _resetForTest,
  disposeMessaging,
  isFromStudio,
  postToStudio as typedPostToStudio,
} from "./bridge-messaging.ts";

// These tests deliberately exercise the transport's defensive snapshotting
// with malformed and partial payloads. Production callers use the schema-
// derived signature exported by bridge-messaging.
const postToStudio = typedPostToStudio as unknown as (
  message: Record<string, unknown>,
) => boolean;

// ---------------------------------------------------------------------------
// Browser API polyfills for Deno test environment
// ---------------------------------------------------------------------------

type PostCall = { message: unknown; targetOrigin: string };

interface FakeParent {
  calls: PostCall[];
  postMessage(message: unknown, targetOrigin: string): void;
}

const fakeParentWindow: FakeParent = {
  calls: [],
  postMessage(message: unknown, targetOrigin: string): void {
    fakeParentWindow.calls.push({ message, targetOrigin });
  },
};

if (typeof globalThis.window === "undefined") {
  (globalThis as any).window = globalThis;
}
(globalThis as any).window.parent = fakeParentWindow;

function resetAll(): void {
  _resetForTest();
  (fakeParentWindow as any).calls.length = 0;
}

function makeEvent(
  origin: string,
  source: MessageEventSource = fakeParentWindow as unknown as Window,
): MessageEvent {
  return {
    data: {},
    origin,
    source,
    ports: [],
  } as unknown as MessageEvent;
}

// ---------------------------------------------------------------------------
// SEC-002: messages sent before handshake must NOT be broadcast with "*"
// ---------------------------------------------------------------------------

Deno.test("postToStudio: buffers messages before handshake (no wildcard broadcast)", () => {
  resetAll();
  postToStudio({ action: "appLoaded", url: "https://app.example/" });
  postToStudio({
    action: "onPageTransitionEnd",
    url: "https://app.example/",
    projectId: "project-1",
    id: "page-1",
    params: {},
  });
  assertEquals((fakeParentWindow as any).calls.length, 0, "no postMessage before handshake");
  assertEquals(_pendingCountForTest(), 2);
});

Deno.test("isFromStudio: captures origin and flushes pending buffer", () => {
  resetAll();
  postToStudio({ action: "appLoaded" });
  postToStudio({
    action: "onPageTransitionEnd",
    url: "https://app.example/",
    projectId: "project-1",
    id: "page-1",
    params: {},
  });

  const accepted = isFromStudio(makeEvent("https://veryfront.com"));
  assertEquals(accepted, true);
  _flushPendingForTest();
  assertEquals(_pendingCountForTest(), 0);
  assertEquals((fakeParentWindow as any).calls.length, 2);
  assertEquals((fakeParentWindow as any).calls[0].targetOrigin, "https://veryfront.com");
  assertEquals((fakeParentWindow as any).calls[1].targetOrigin, "https://veryfront.com");
});

Deno.test("postToStudio: after handshake uses captured origin (never '*')", () => {
  resetAll();
  isFromStudio(makeEvent("https://studio.veryfront.com"));
  postToStudio({ action: "appLoaded" });
  _flushPendingForTest();

  assertEquals((fakeParentWindow as any).calls.length, 1);
  assertEquals(
    (fakeParentWindow as any).calls[0].targetOrigin,
    "https://studio.veryfront.com",
  );
});

Deno.test("postToStudio: schedules and bounds live floods without losing critical responses", () => {
  using time = new FakeTime();
  resetAll();
  assertEquals(isFromStudio(makeEvent("https://studio.veryfront.com")), true);

  for (let index = 0; index < 150; index++) {
    postToStudio({ action: "logEvent", value: { method: "log", data: [index] } });
  }
  postToStudio({ action: "appLoaded", url: "https://preview.example/" });
  postToStudio({ action: "treeUpdated", tree: { id: "old" } });
  postToStudio({ action: "treeUpdated", tree: { id: "current" } });
  postToStudio({
    action: "screenshotResult",
    requestId: "capture-1",
    multiple: false,
    success: true,
    data: "data:image/png;base64,example",
  });

  assertEquals(fakeParentWindow.calls.length, 0, "live sends yield to the bounded scheduler");
  assert(_pendingCountForTest() <= 101, "the standard queue plus screenshot lane stays bounded");

  time.tick(16);

  assert(fakeParentWindow.calls.length > 0);
  assert(fakeParentWindow.calls.length <= 8, "one scheduler turn has a fixed send budget");
  const firstActions = fakeParentWindow.calls.map((call) =>
    (call.message as { action?: string }).action
  );
  assertEquals(firstActions.includes("appLoaded"), true);
  assertEquals(firstActions.includes("treeUpdated"), true);
  assertEquals(firstActions.includes("screenshotResult"), true);
  const trees = fakeParentWindow.calls.filter((call) =>
    (call.message as { action?: string }).action === "treeUpdated"
  );
  assertEquals(trees.length, 1);
  assertEquals((trees[0]!.message as { tree: { id: string } }).tree.id, "current");

  time.tick(2_000);
  assertEquals(_pendingCountForTest(), 0);
});

Deno.test("postToStudio: sends navigation lifecycle messages before the document can unload", () => {
  resetAll();
  assertEquals(isFromStudio(makeEvent("https://studio.veryfront.com")), true);

  postToStudio({ action: "onPageTransitionStart", url: "https://preview.example/next" });
  postToStudio({ action: "appUnloaded", url: "https://preview.example/" });

  assertEquals(fakeParentWindow.calls.map((call) => call.message), [
    { action: "onPageTransitionStart", url: "https://preview.example/next" },
    { action: "appUnloaded", url: "https://preview.example/" },
  ]);
  assertEquals(_pendingCountForTest(), 0);
});

Deno.test("postToStudio: makes appUnloaded a terminal boundary for queued session traffic", () => {
  using time = new FakeTime();
  resetAll();
  assertEquals(isFromStudio(makeEvent("https://studio.veryfront.com")), true);

  postToStudio({ action: "treeUpdated", tree: { id: "stale-tree" } });
  postToStudio({ action: "logEvent", value: { method: "log", data: ["stale-log"] } });
  postToStudio({
    action: "screenshotResult",
    requestId: "stale-capture",
    multiple: false,
    success: false,
    error: "stale",
  });
  postToStudio({ action: "appUnloaded", url: "https://preview.example/" });

  assertEquals(fakeParentWindow.calls.map((call) => call.message), [
    { action: "appUnloaded", url: "https://preview.example/" },
  ]);
  assertEquals(_pendingCountForTest(), 0);
  time.tick(100);
  assertEquals(fakeParentWindow.calls.length, 1);
  assertEquals(
    postToStudio({ action: "treeUpdated", tree: { id: "after-unload" } }),
    false,
  );

  assertEquals(postToStudio({ action: "appLoaded", url: "https://preview.example/" }), true);
  assertEquals(postToStudio({ action: "treeUpdated", tree: { id: "restored" } }), true);
  time.tick(100);
  assertEquals(
    fakeParentWindow.calls.map((call) => (call.message as { action: string }).action),
    ["appUnloaded", "appLoaded", "treeUpdated"],
  );
});

Deno.test("postToStudio: preserves queued critical state before immediate navigation", () => {
  using _time = new FakeTime();
  resetAll();
  postToStudio({ action: "appLoaded", url: "https://preview.example/" });
  postToStudio({ action: "appUpdated", url: "https://preview.example/" });
  postToStudio({ action: "onPageTransitionEnd", url: "https://preview.example/" });
  postToStudio({ action: "logEvent", value: { method: "log", data: ["queued"] } });

  assertEquals(isFromStudio(makeEvent("https://studio.veryfront.com")), true);
  postToStudio({
    action: "onPageTransitionStart",
    url: "https://preview.example/next",
  });

  assertEquals(
    fakeParentWindow.calls.map((call) => (call.message as { action: string }).action),
    ["appLoaded", "appUpdated", "onPageTransitionEnd", "onPageTransitionStart"],
  );
  assertEquals(_pendingCountForTest(), 1, "noncritical traffic remains scheduled");
  disposeMessaging();
});

Deno.test("postToStudio: immediate navigation sends only the latest duplicate lifecycle state", () => {
  using _time = new FakeTime();
  resetAll();
  assertEquals(isFromStudio(makeEvent("https://studio.veryfront.com")), true);
  for (let index = 0; index < 20; index++) {
    postToStudio({ action: "appLoaded", url: `https://preview.example/${index}` });
  }

  postToStudio({
    action: "onPageTransitionStart",
    url: "https://preview.example/next",
  });

  assertEquals(fakeParentWindow.calls.map((call) => call.message), [
    { action: "appLoaded", url: "https://preview.example/19" },
    { action: "onPageTransitionStart", url: "https://preview.example/next" },
  ]);
  disposeMessaging();
});

Deno.test("postToStudio: bounds immediate navigation work under unrelated critical pressure", () => {
  using _time = new FakeTime();
  resetAll();
  for (let index = 0; index < 20; index++) {
    postToStudio({ action: "runtimeError", errors: [{ type: "error", message: `${index}` }] });
  }
  postToStudio({
    action: "screenshotResult",
    requestId: "large-capture",
    multiple: false,
    success: true,
    data: `data:image/png;base64,${"x".repeat(600_000)}`,
  });
  postToStudio({ action: "appLoaded", url: "https://preview.example/" });
  postToStudio({ action: "appUpdated", url: "https://preview.example/" });
  postToStudio({ action: "onPageTransitionEnd", url: "https://preview.example/" });

  assertEquals(isFromStudio(makeEvent("https://studio.veryfront.com")), true);
  assertEquals(
    postToStudio({
      action: "onPageTransitionStart",
      url: "https://preview.example/next",
    }),
    true,
  );

  assertEquals(
    fakeParentWindow.calls.map((call) => (call.message as { action: string }).action),
    ["appLoaded", "appUpdated", "onPageTransitionEnd", "onPageTransitionStart"],
  );
  assert(
    fakeParentWindow.calls.length <= 8,
    "immediate delivery stays within one scheduler send budget",
  );
  assertEquals(_pendingCountForTest(), 21, "unrelated critical traffic remains scheduled");
  disposeMessaging();
});

Deno.test("disposeMessaging: cancels a scheduled live drain", () => {
  using time = new FakeTime();
  resetAll();
  assertEquals(isFromStudio(makeEvent("https://studio.veryfront.com")), true);
  postToStudio({ action: "logEvent", value: { method: "log", data: ["queued"] } });
  assertEquals(_pendingCountForTest(), 1);

  disposeMessaging();
  time.tick(100);

  assertEquals(_pendingCountForTest(), 0);
  assertEquals(fakeParentWindow.calls.length, 0);
});

Deno.test("isFromStudio: rejects invalid origins; pending buffer remains", () => {
  resetAll();
  postToStudio({ action: "appLoaded" });

  assertEquals(isFromStudio(makeEvent("https://evil.example.com")), false);
  assertEquals(_pendingCountForTest(), 1, "buffer not flushed on rejected origin");
  assertEquals((fakeParentWindow as any).calls.length, 0);
});

Deno.test("isFromStudio: accepts localhost", () => {
  resetAll();
  postToStudio({ action: "appLoaded" });
  assertEquals(isFromStudio(makeEvent("http://localhost:3000")), true);
  _flushPendingForTest();
  assertEquals((fakeParentWindow as any).calls[0].targetOrigin, "http://localhost:3000");
});

Deno.test("isFromStudio: accepts exact hosted Studio origins", () => {
  resetAll();
  assertEquals(isFromStudio(makeEvent("https://veryfront.org")), true);

  resetAll();
  assertEquals(isFromStudio(makeEvent("https://studio.veryfront.org")), true);
});

Deno.test("isFromStudio: rejects tenant and hosted development subdomains", () => {
  resetAll();
  assertEquals(isFromStudio(makeEvent("https://project.preview.veryfront.org")), false);
  assertEquals(isFromStudio(makeEvent("https://project.production.veryfront.com")), false);
  assertEquals(isFromStudio(makeEvent("https://studio.veryfront.dev")), false);
});

Deno.test("isFromStudio: rejects messages not sent by the parent window", () => {
  resetAll();
  assertEquals(isFromStudio(makeEvent("https://veryfront.com", {} as Window)), false);
  assertEquals(
    isFromStudio(makeEvent("https://veryfront.com", (globalThis as any).window)),
    false,
  );
});

Deno.test("postToStudio: pending buffer caps at MAX_PENDING_MESSAGES (100); oldest dropped", () => {
  resetAll();
  for (let i = 0; i < 150; i++) {
    postToStudio({ action: "tick", i });
  }
  assertEquals(_pendingCountForTest(), 100);

  isFromStudio(makeEvent("https://veryfront.com"));
  _flushPendingForTest();
  // After flush, all 100 retained should have been delivered with the captured origin.
  assertEquals((fakeParentWindow as any).calls.length, 100);
  // Oldest preserved should be tick #50 (0-49 dropped).
  assertEquals(((fakeParentWindow as any).calls[0].message as any).i, 50);
  assertEquals(((fakeParentWindow as any).calls[99].message as any).i, 149);
});

Deno.test("postToStudio: startup logs do not evict lifecycle state", () => {
  resetAll();
  postToStudio({ action: "appLoaded", url: "https://app.example/" });
  postToStudio({ action: "onPageTransitionEnd", url: "https://app.example/page" });
  postToStudio({ action: "treeUpdated", tree: { id: "initial" } });
  for (let index = 0; index < 150; index++) {
    postToStudio({ action: "logEvent", value: { method: "log", data: [index] } });
  }

  assertEquals(_pendingCountForTest(), 100);
  isFromStudio(makeEvent("https://veryfront.com"));
  _flushPendingForTest();

  const actions = (fakeParentWindow as any).calls.map((call: PostCall) =>
    (call.message as { action?: string }).action
  );
  assertEquals(actions.includes("appLoaded"), true);
  assertEquals(actions.includes("onPageTransitionEnd"), true);
  assertEquals(actions.includes("treeUpdated"), true);
});

Deno.test("postToStudio: runtime error floods do not evict startup state", () => {
  resetAll();
  postToStudio({ action: "appLoaded", url: "https://app.example/" });
  postToStudio({ action: "onPageTransitionEnd", url: "https://app.example/page" });
  postToStudio({ action: "treeUpdated", tree: { id: "initial" } });
  for (let index = 0; index < 150; index++) {
    postToStudio({ action: "runtimeError", errors: [{ type: "error", message: `${index}` }] });
  }

  isFromStudio(makeEvent("https://veryfront.com"));
  _flushPendingForTest();
  const actions = (fakeParentWindow as any).calls.map((call: PostCall) =>
    (call.message as { action?: string }).action
  );
  assertEquals(actions.includes("appLoaded"), true);
  assertEquals(actions.includes("onPageTransitionEnd"), true);
  assertEquals(actions.includes("treeUpdated"), true);
  assertEquals(actions.filter((action: string) => action === "runtimeError").length <= 20, true);
});

Deno.test("postToStudio: coalesces superseded startup state", () => {
  resetAll();
  postToStudio({ action: "treeUpdated", tree: { id: "old" } });
  postToStudio({ action: "treeUpdated", tree: { id: "current" } });
  postToStudio({ action: "appUpdated", url: "/old" });
  postToStudio({ action: "appUpdated", url: "/current" });

  assertEquals(_pendingCountForTest(), 2);
  isFromStudio(makeEvent("https://veryfront.com"));
  _flushPendingForTest();
  assertEquals((fakeParentWindow as any).calls.map((call: PostCall) => call.message), [
    { action: "treeUpdated", tree: { id: "current" } },
    { action: "appUpdated", url: "/current" },
  ]);
});

Deno.test("isFromStudio: rejects a different trusted origin after the handshake", () => {
  resetAll();
  assertEquals(isFromStudio(makeEvent("https://studio.veryfront.com")), true);
  assertEquals(isFromStudio(makeEvent("https://veryfront.org")), false);
  postToStudio({ action: "ping" });
  _flushPendingForTest();
  assertEquals(
    (fakeParentWindow as any).calls[0].targetOrigin,
    "https://studio.veryfront.com",
  );
});

Deno.test("disposeMessaging: forgets queued state and the captured origin", () => {
  resetAll();
  postToStudio({ action: "appLoaded", url: "https://preview.example/old" });
  assertEquals(_pendingCountForTest(), 1);

  disposeMessaging();
  assertEquals(_pendingCountForTest(), 0);
  assertEquals(isFromStudio(makeEvent("https://studio.veryfront.com")), true);
  disposeMessaging();

  postToStudio({ action: "appLoaded", url: "https://preview.example/new" });
  assertEquals(_pendingCountForTest(), 1);
  assertEquals((fakeParentWindow as any).calls.length, 0);
  assertEquals(isFromStudio(makeEvent("https://veryfront.org")), true);
  _flushPendingForTest();
  assertEquals((fakeParentWindow as any).calls[0].targetOrigin, "https://veryfront.org");
});

Deno.test("postToStudio: detaches queued messages from later caller mutation", () => {
  resetAll();
  const message = { action: "treeUpdated", tree: { id: "original" } };

  postToStudio(message);
  message.tree.id = "mutated";
  isFromStudio(makeEvent("https://veryfront.com"));
  _flushPendingForTest();

  assertEquals((fakeParentWindow as any).calls[0].message, {
    action: "treeUpdated",
    tree: { id: "original" },
  });
});

Deno.test("postToStudio: rejects accessors without executing them", () => {
  resetAll();
  let getterCalls = 0;
  const message = Object.defineProperty({}, "action", {
    enumerable: true,
    get() {
      getterCalls++;
      return "unsafe";
    },
  });

  postToStudio(message);

  assertEquals(getterCalls, 0);
  assertEquals(_pendingCountForTest(), 0);
});

Deno.test("postToStudio: rejects an individually oversized message", () => {
  resetAll();

  postToStudio({ action: "logEvent", value: "x".repeat(1_048_577) });

  assertEquals(_pendingCountForTest(), 0);
});

Deno.test("postToStudio: delivers screenshot results within the capture contract", () => {
  resetAll();
  isFromStudio(makeEvent("https://veryfront.com"));
  const data = `data:image/png;base64,${"x".repeat(600_000)}`;

  postToStudio({ action: "screenshotResult", multiple: false, success: true, data });
  _flushPendingForTest();

  assertEquals((fakeParentWindow as any).calls.length, 1);
  assertEquals(((fakeParentWindow as any).calls[0].message as any).data, data);
});

Deno.test("postToStudio: busy screenshot floods preserve a completed capture", () => {
  resetAll();
  postToStudio({
    action: "screenshotResult",
    requestId: "completed-capture",
    multiple: false,
    success: true,
    data: "data:image/png;base64,complete",
  });
  for (let index = 0; index < 20; index++) {
    postToStudio({
      action: "screenshotResult",
      requestId: `busy-${index}`,
      multiple: false,
      success: false,
      error: "Screenshot capture is already in progress",
    });
  }

  assertEquals(isFromStudio(makeEvent("https://veryfront.com")), true);
  _flushPendingForTest();

  const requestIds = fakeParentWindow.calls.map((call) =>
    (call.message as { requestId?: string }).requestId
  );
  assertEquals(requestIds.includes("completed-capture"), true);
  assertEquals(requestIds.length, 20);
});

Deno.test("postToStudio: screenshot pressure preserves successful multi-section results", () => {
  resetAll();
  postToStudio({
    action: "screenshotResult",
    requestId: "completed-sections",
    multiple: true,
    results: [{ success: true, data: "data:image/png;base64,complete" }],
  });
  for (let index = 0; index < 20; index++) {
    postToStudio({
      action: "screenshotResult",
      requestId: `busy-${index}`,
      multiple: true,
      results: [{ success: false, error: "Screenshot capture is already in progress" }],
    });
  }

  assertEquals(isFromStudio(makeEvent("https://veryfront.com")), true);
  _flushPendingForTest();
  assertEquals(
    fakeParentWindow.calls.some((call) =>
      (call.message as { requestId?: string }).requestId === "completed-sections"
    ),
    true,
  );
  assertEquals(fakeParentWindow.calls.length, 20);
});

Deno.test("postToStudio: delivers navigator trees at the producer depth and node limits", () => {
  resetAll();
  isFromStudio(makeEvent("https://veryfront.com"));
  const node = (id: string, children: unknown[] = []) => ({
    id,
    name: "div",
    type: "element",
    path: "page.tsx",
    parentId: "root",
    start: { line: 0, column: 0 },
    end: { line: 0, column: 0 },
    children,
    isRemote: false,
  });
  let nested = node("leaf");
  for (let depth = 0; depth < 64; depth++) nested = node(`nested-${depth}`, [nested]);
  const flatChildren = Array.from({ length: 2_000 }, (_, index) => node(`flat-${index}`));

  postToStudio({ action: "treeUpdated", tree: node("root", [nested]) });
  _flushPendingForTest();
  postToStudio({ action: "treeUpdated", tree: node("root", flatChildren) });
  _flushPendingForTest();

  assertEquals((fakeParentWindow as any).calls.length, 2);
});

Deno.test("postToStudio: queues one valid navigator tree larger than the generic budget", () => {
  resetAll();
  const path = "p".repeat(1_500);
  const children = Array.from({ length: 2_000 }, (_, index) => ({
    id: `node-${index}`,
    name: "div",
    type: "element",
    path,
    parentId: "root",
    start: { line: 0, column: 0 },
    end: { line: 0, column: 0 },
    children: [],
    isRemote: false,
  }));

  assertEquals(postToStudio({ action: "treeUpdated", tree: { id: "root", children } }), true);
  assertEquals(_pendingCountForTest(), 1);
  isFromStudio(makeEvent("https://veryfront.com"));
  _flushPendingForTest();
  assertEquals((fakeParentWindow as any).calls.length, 1);
});

Deno.test("postToStudio: contains revoked proxies", () => {
  resetAll();
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();

  postToStudio(proxy as Record<string, unknown>);

  assertEquals(_pendingCountForTest(), 0);
});
