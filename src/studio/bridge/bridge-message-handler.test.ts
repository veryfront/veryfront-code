/**
 * Tests for bridge-message-handler: contentChanged handler branching logic.
 *
 * These tests prove that:
 * 1. contentChanged in non-edit mode triggers page reload
 * 2. contentChanged in edit mode with Yjs connected does NOT apply content
 *    (Yjs is the source of truth when connected)
 * 3. contentChanged in edit mode with Yjs disconnected applies content as fallback
 * 4. contentChanged with fileId mismatch is ignored
 * 5. contentChanged on non-markdown pages is ignored
 *
 * We test the handler's branching logic by directly calling handleStudioMessage
 * with a synthetic MessageEvent. The handler delegates to isFromStudio() which
 * checks origin, so we construct events from a valid origin.
 */

import { assertEquals } from "@std/assert";
import { setConfigForTest } from "./bridge-config.ts";
import { editorState } from "./bridge-editor-state.ts";
import { handleStudioMessage, isSafeNavigationUrl } from "./bridge-message-handler.ts";

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

let reloadCallCount = 0;

function resetState(pagePath = "test.md"): void {
  reloadCallCount = 0;
  (globalThis as any).location.reload = () => {
    reloadCallCount++;
  };
  setConfigForTest({ pagePath, pageId: "test-id", projectId: "proj-id" });
  editorState.markdownFileId = "file-123";
  editorState.markdownCurrentContent = "";
  editorState.markdownCurrentEditorContent = "";
  editorState.markdownApplyingRemoteUpdate = false;
  editorState.markdownLastRemoteContent = null;
  editorState.markdownYjsConnected = false;
  editorState.markdownEditorRoot = null;
  editorState.markdownLexicalApi = null;
  editorState.markdownLexicalRenderedContent = null;
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

// ---------------------------------------------------------------------------
// contentChanged: page type guard
// ---------------------------------------------------------------------------

Deno.test("contentChanged: ignored on non-markdown pages", () => {
  resetState("page.tsx"); // Not a markdown page

  const event = makeEvent({
    action: "contentChanged",
    fileId: "file-123",
    content: "new content",
  });

  // Should not throw or have any side effects
  handleStudioMessage(event);

  // Content should not have been modified
  assertEquals(editorState.markdownCurrentContent, "");
});

// ---------------------------------------------------------------------------
// contentChanged: fileId mismatch
// ---------------------------------------------------------------------------

Deno.test("contentChanged: ignored when fileId does not match", () => {
  resetState();

  const event = makeEvent({
    action: "contentChanged",
    fileId: "different-file-id",
    content: "new content",
  });

  handleStudioMessage(event);

  // Content should not have been modified
  assertEquals(editorState.markdownCurrentContent, "");
});

// ---------------------------------------------------------------------------
// contentChanged: non-edit mode (no editor root displayed)
// ---------------------------------------------------------------------------

Deno.test("contentChanged: non-edit mode reloads (editorRoot not displayed)", () => {
  resetState();

  // Simulate non-edit mode: no editor root at all
  editorState.markdownEditorRoot = null;

  const event = makeEvent({
    action: "contentChanged",
    fileId: "file-123",
    content: "updated markdown content",
  });

  handleStudioMessage(event);

  // In non-edit mode, reload should have been called
  assertEquals(reloadCallCount, 1);

  // Content should NOT have been applied via applyMarkdownContent
  assertEquals(editorState.markdownCurrentContent, "");
});

// ---------------------------------------------------------------------------
// contentChanged: edit mode with Yjs connected
// ---------------------------------------------------------------------------

Deno.test("contentChanged: edit mode with Yjs connected does NOT apply content", () => {
  resetState();

  // Simulate edit mode: editor root exists and is displayed
  const fakeRoot = { style: { display: "block" } } as unknown as HTMLElement;
  editorState.markdownEditorRoot = fakeRoot;
  editorState.markdownYjsConnected = true;
  editorState.markdownCurrentContent = "original content";

  const event = makeEvent({
    action: "contentChanged",
    fileId: "file-123",
    content: "content from postMessage",
  });

  handleStudioMessage(event);

  // When Yjs is connected, contentChanged should NOT apply content
  // because Yjs is the authoritative source
  assertEquals(editorState.markdownCurrentContent, "original content");
});

// ---------------------------------------------------------------------------
// contentChanged: edit mode with Yjs disconnected
// ---------------------------------------------------------------------------

Deno.test("contentChanged: edit mode with Yjs disconnected applies content", () => {
  resetState();

  // Simulate edit mode: editor root exists and is displayed
  const fakeRoot = { style: { display: "block" } } as unknown as HTMLElement;
  editorState.markdownEditorRoot = fakeRoot;
  editorState.markdownYjsConnected = false;
  editorState.markdownCurrentContent = "original content";

  const event = makeEvent({
    action: "contentChanged",
    fileId: "file-123",
    content: "content from postMessage",
  });

  handleStudioMessage(event);

  // When Yjs is disconnected, contentChanged SHOULD apply content
  // via applyMarkdownContent. Since we don't have Lexical set up,
  // it will take the textarea fallback path, but markdownCurrentContent
  // should be updated.
  assertEquals(editorState.markdownCurrentContent, "content from postMessage");
});

// ---------------------------------------------------------------------------
// contentChanged: missing content
// ---------------------------------------------------------------------------

Deno.test("contentChanged: missing content field in non-edit mode still reloads", () => {
  resetState();

  // Non-edit mode (no editor root)
  editorState.markdownEditorRoot = null;

  const event = makeEvent({
    action: "contentChanged",
    fileId: "file-123",
    // content is missing (undefined)
  });

  // Should not throw, and should reload since in non-edit mode
  handleStudioMessage(event);

  assertEquals(reloadCallCount, 1);
  assertEquals(editorState.markdownCurrentContent, "");
});

Deno.test("contentChanged: missing content field in edit mode does not apply", () => {
  resetState();

  // Edit mode
  const fakeRoot = { style: { display: "block" } } as unknown as HTMLElement;
  editorState.markdownEditorRoot = fakeRoot;
  editorState.markdownYjsConnected = false;
  editorState.markdownCurrentContent = "original";

  const event = makeEvent({
    action: "contentChanged",
    fileId: "file-123",
    // content is missing
  });

  handleStudioMessage(event);

  // Missing content should not apply anything
  assertEquals(editorState.markdownCurrentContent, "original");
  assertEquals(reloadCallCount, 0);
});

Deno.test("contentChanged: null content in edit mode does NOT apply", () => {
  resetState();

  const fakeRoot = { style: { display: "block" } } as unknown as HTMLElement;
  editorState.markdownEditorRoot = fakeRoot;
  editorState.markdownYjsConnected = false;
  editorState.markdownCurrentContent = "original";

  const event = makeEvent({
    action: "contentChanged",
    fileId: "file-123",
    content: null,
  });

  handleStudioMessage(event);

  // null content should NOT be applied even in edit mode with Yjs disconnected
  assertEquals(editorState.markdownCurrentContent, "original");
});

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
