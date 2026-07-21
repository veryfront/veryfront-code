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
  isFromStudio(makeEvent("https://veryfront.com"));
  postToStudio({ action: "appLoaded" });

  assertEquals((fakeParentWindow as any).calls.length, 1);
  assertEquals(
    (fakeParentWindow as any).calls[0].targetOrigin,
    "https://veryfront.com",
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

Deno.test("isFromStudio: accepts exact hosted Studio origins", () => {
  resetAll();
  assertEquals(isFromStudio(makeEvent("https://veryfront.org")), true);

  resetAll();
  assertEquals(isFromStudio(makeEvent("https://veryfront.com")), true);
});

Deno.test("isFromStudio: rejects tenant and hosted development subdomains", () => {
  resetAll();
  assertEquals(isFromStudio(makeEvent("https://project.preview.veryfront.org")), false);
  assertEquals(isFromStudio(makeEvent("https://project.production.veryfront.com")), false);
  assertEquals(isFromStudio(makeEvent("https://studio.veryfront.dev")), false);
  // studio.* subdomains are not deployed and are no longer trusted.
  assertEquals(isFromStudio(makeEvent("https://studio.veryfront.com")), false);
  assertEquals(isFromStudio(makeEvent("https://studio.veryfront.org")), false);
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
  // After flush, all 100 retained should have been delivered with the captured origin.
  assertEquals((fakeParentWindow as any).calls.length, 100);
  // Oldest preserved should be tick #50 (0-49 dropped).
  assertEquals(((fakeParentWindow as any).calls[0].message as any).i, 50);
  assertEquals(((fakeParentWindow as any).calls[99].message as any).i, 149);
});

Deno.test("isFromStudio: rejects a different trusted origin after the handshake", () => {
  resetAll();
  assertEquals(isFromStudio(makeEvent("https://veryfront.com")), true);
  assertEquals(isFromStudio(makeEvent("https://veryfront.org")), false);
  postToStudio({ action: "ping" });
  assertEquals(
    (fakeParentWindow as any).calls[0].targetOrigin,
    "https://veryfront.com",
  );
});
