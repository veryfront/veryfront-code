import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for bridge-messaging: postMessage target origin handling and
 * pre-handshake buffering (SEC-002).
 */

import { assertEquals } from "@std/assert";
import {
  _pendingCountForTest,
  _resetForTest,
  isFromStudio,
  postToStudio,
} from "./bridge-messaging.ts";

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

function makeEvent(origin: string): MessageEvent {
  return {
    data: {},
    origin,
    source: {} as Window, // any non-window source is accepted
    ports: [],
  } as unknown as MessageEvent;
}

// ---------------------------------------------------------------------------
// SEC-002: messages sent before handshake must NOT be broadcast with "*"
// ---------------------------------------------------------------------------

Deno.test("postToStudio: buffers messages before handshake (no wildcard broadcast)", () => {
  resetAll();
  postToStudio({ action: "appLoaded", url: "https://app.example/" });
  postToStudio({ action: "ready" });
  assertEquals((fakeParentWindow as any).calls.length, 0, "no postMessage before handshake");
  assertEquals(_pendingCountForTest(), 2);
});

Deno.test("isFromStudio: captures origin and flushes pending buffer", () => {
  resetAll();
  postToStudio({ action: "appLoaded" });
  postToStudio({ action: "ready" });

  const accepted = isFromStudio(makeEvent("https://veryfront.com"));
  assertEquals(accepted, true);
  assertEquals(_pendingCountForTest(), 0);
  assertEquals((fakeParentWindow as any).calls.length, 2);
  assertEquals((fakeParentWindow as any).calls[0].targetOrigin, "https://veryfront.com");
  assertEquals((fakeParentWindow as any).calls[1].targetOrigin, "https://veryfront.com");
});

Deno.test("postToStudio: after handshake uses captured origin (never '*')", () => {
  resetAll();
  isFromStudio(makeEvent("https://studio.veryfront.com"));
  postToStudio({ action: "appLoaded" });

  assertEquals((fakeParentWindow as any).calls.length, 1);
  assertEquals(
    (fakeParentWindow as any).calls[0].targetOrigin,
    "https://studio.veryfront.com",
  );
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
  assertEquals((fakeParentWindow as any).calls[0].targetOrigin, "http://localhost:3000");
});

Deno.test("isFromStudio: accepts veryfront.org and subdomains", () => {
  resetAll();
  assertEquals(isFromStudio(makeEvent("https://veryfront.org")), true);

  resetAll();
  assertEquals(isFromStudio(makeEvent("https://preview.veryfront.org")), true);
});

Deno.test("isFromStudio: accepts veryfront.dev subdomains", () => {
  resetAll();
  assertEquals(isFromStudio(makeEvent("https://x.veryfront.dev")), true);
});

Deno.test("isFromStudio: ignores messages whose source is the current window", () => {
  resetAll();
  const event = {
    data: {},
    origin: "https://veryfront.com",
    source: (globalThis as any).window,
    ports: [],
  } as unknown as MessageEvent;
  assertEquals(isFromStudio(event), false);
});

Deno.test("postToStudio: pending buffer caps at MAX_PENDING_MESSAGES (100); oldest dropped", () => {
  resetAll();
  for (let i = 0; i < 150; i++) {
    postToStudio({ action: "tick", i });
  }
  assertEquals(_pendingCountForTest(), 100);

  isFromStudio(makeEvent("https://veryfront.com"));
  // After flush, all 100 retained should have been delivered with the captured origin.
  assertEquals((fakeParentWindow as any).calls.length, 100);
  // Oldest preserved should be tick #50 (0-49 dropped).
  assertEquals(((fakeParentWindow as any).calls[0].message as any).i, 50);
  assertEquals(((fakeParentWindow as any).calls[99].message as any).i, 149);
});

Deno.test("postToStudio: subsequent isFromStudio calls do not re-capture origin", () => {
  resetAll();
  isFromStudio(makeEvent("https://studio.veryfront.com"));
  // A different valid origin appearing later must not switch the captured origin.
  isFromStudio(makeEvent("https://other.veryfront.com"));
  postToStudio({ action: "ping" });
  assertEquals(
    (fakeParentWindow as any).calls[0].targetOrigin,
    "https://studio.veryfront.com",
  );
});
