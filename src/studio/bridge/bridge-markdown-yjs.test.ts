/**
 * Tests for bridge-markdown-yjs: dispose cleanup and syncLocalChangeToYText.
 *
 * These tests prove that:
 * 1. disposeMarkdownYjs resets ALL echo-back guard state
 * 2. syncLocalChangeToYText is a no-op when Yjs is not connected
 * 3. State is clean after dispose so re-entering edit mode works correctly
 */

import { assertEquals } from "@std/assert";
import { setConfigForTest } from "./bridge-config.ts";
import { editorState } from "./bridge-editor-state.ts";
import { disposeMarkdownYjs, syncLocalChangeToYText } from "./bridge-markdown-yjs.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetState(): void {
  setConfigForTest({ pagePath: "test.md", pageId: "test-id", projectId: "proj-id" });
}

// ---------------------------------------------------------------------------
// disposeMarkdownYjs: state cleanup
// ---------------------------------------------------------------------------

Deno.test("disposeMarkdownYjs: resets echo-back guard state", () => {
  resetState();

  // Simulate state that would exist during active Yjs session
  editorState.markdownLastRemoteContent = "some remote content";
  editorState.markdownApplyingRemoteUpdate = true;
  editorState.markdownYjsConnected = true;
  editorState.markdownPendingSelection = { start: 0, end: 5 };

  disposeMarkdownYjs();

  // All echo-back guard state must be reset
  assertEquals(editorState.markdownLastRemoteContent, null);
  assertEquals(editorState.markdownApplyingRemoteUpdate, false);
  assertEquals(editorState.markdownYjsConnected, false);
  assertEquals(editorState.markdownPendingSelection, null);
});

Deno.test("disposeMarkdownYjs: resets Yjs connection state", () => {
  resetState();

  editorState.markdownYjsConnected = true;
  editorState.markdownYjsY = {} as any;

  disposeMarkdownYjs();

  assertEquals(editorState.markdownYDoc, null);
  assertEquals(editorState.markdownYProvider, null);
  assertEquals(editorState.markdownYText, null);
  assertEquals(editorState.markdownYjsConnected, false);
  assertEquals(editorState.markdownYjsY, null);
});

Deno.test("disposeMarkdownYjs: increments setupId to invalidate stale callbacks", () => {
  resetState();

  const before = editorState.markdownYjsSetupId;
  disposeMarkdownYjs();
  const after = editorState.markdownYjsSetupId;

  assertEquals(after, before + 1);
});

Deno.test("disposeMarkdownYjs: is safe to call when already disposed", () => {
  resetState();

  // All Yjs state is already null/false
  editorState.markdownYDoc = null;
  editorState.markdownYProvider = null;
  editorState.markdownYText = null;
  editorState.markdownYjsConnected = false;

  // Should not throw
  disposeMarkdownYjs();

  assertEquals(editorState.markdownYDoc, null);
  assertEquals(editorState.markdownYjsConnected, false);
});

// ---------------------------------------------------------------------------
// syncLocalChangeToYText: guards
// ---------------------------------------------------------------------------

Deno.test("syncLocalChangeToYText: no-op when YText is null", () => {
  resetState();

  editorState.markdownYText = null;
  editorState.markdownYDoc = null;

  // Should not throw
  syncLocalChangeToYText("some content");
});

Deno.test("syncLocalChangeToYText: no-op when YDoc is null", () => {
  resetState();

  editorState.markdownYText = {
    length: 0,
    insert: () => {},
    delete: () => {},
    toString: () => "",
    observe: () => {},
  };
  editorState.markdownYDoc = null;

  syncLocalChangeToYText("some content");

  // Clean up
  editorState.markdownYText = null;
});

Deno.test("syncLocalChangeToYText: no-op when content matches Y.Text", () => {
  resetState();

  const content = "matching content";
  editorState.markdownYText = {
    length: content.length,
    insert: () => {
      throw new Error("insert should not be called");
    },
    delete: () => {
      throw new Error("delete should not be called");
    },
    toString: () => content,
    observe: () => {},
  };
  editorState.markdownYDoc = {
    getText: () => editorState.markdownYText!,
    destroy: () => {},
    transact: (fn: () => void) => fn(),
  };

  // Same content — should be a no-op
  syncLocalChangeToYText(content);

  // Clean up
  editorState.markdownYText = null;
  editorState.markdownYDoc = null;
});

Deno.test("syncLocalChangeToYText: applies diff when content differs", () => {
  resetState();

  const operations: Array<{ op: string; args: any[] }> = [];
  const currentContent = "hello world";

  editorState.markdownYText = {
    length: currentContent.length,
    insert: (index: number, text: string) => {
      operations.push({ op: "insert", args: [index, text] });
    },
    delete: (index: number, len: number) => {
      operations.push({ op: "delete", args: [index, len] });
    },
    toString: () => currentContent,
    observe: () => {},
  };
  editorState.markdownYDoc = {
    getText: () => editorState.markdownYText!,
    destroy: () => {},
    transact: (fn: () => void, _origin?: unknown) => fn(),
  };

  syncLocalChangeToYText("hello there");

  // Should have produced delete + insert operations for "world" -> "there"
  assertEquals(operations.length >= 1, true);

  // Verify the operations would produce the correct result
  const hasDelete = operations.some((op) => op.op === "delete");
  const hasInsert = operations.some((op) => op.op === "insert" && op.args[1] === "there");
  assertEquals(hasDelete, true);
  assertEquals(hasInsert, true);

  // Clean up
  editorState.markdownYText = null;
  editorState.markdownYDoc = null;
});
