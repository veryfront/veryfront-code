import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { useDropZone, type UseDropZoneResult } from "./use-drop-zone.ts";

/** Minimal drag event carrying the data-transfer fields the hook reads. */
function dragEvent(types: string[], files: File[] = []): React.DragEvent {
  return {
    preventDefault: () => {},
    stopPropagation: () => {},
    dataTransfer: { types, files },
  } as unknown as React.DragEvent;
}

/** Mount the hook in JSDOM and hand the body a reader for the latest result. */
async function withDropZone(
  onDrop: ((files: FileList) => void) | undefined,
  body: (read: () => UseDropZoneResult) => void | Promise<void>,
): Promise<void> {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: "https://example.com/" },
  );
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
  };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
  });

  let result: UseDropZoneResult | undefined;
  function Capture(): React.ReactElement | null {
    result = useDropZone(onDrop);
    return null;
  }

  try {
    const rootElement = document.getElementById("root");
    assert(rootElement, "Expected root element to exist");
    const root = createRoot(rootElement);
    flushSync(() => root.render(<Capture />));

    await body(() => {
      assert(result, "Expected the hook result to be captured");
      return result;
    });

    await unmountReactRoot(root);
  } finally {
    Object.assign(globalThis, previous);
    dom.window.close();
  }
}

describe("useDropZone", () => {
  it("returns explicit event handlers instead of a props bag", async () => {
    await withDropZone(() => undefined, (read) => {
      const result = read();
      assertEquals("dragProps" in result, false);
      assert(typeof result.onDragEnter === "function");
      assert(typeof result.onDragLeave === "function");
      assert(typeof result.onDragOver === "function");
      assert(typeof result.onDrop === "function");
    });
  });

  it("ignores drags that do not carry files", async () => {
    await withDropZone(() => undefined, (read) => {
      flushSync(() => read().onDragEnter?.(dragEvent(["text/plain"])));
      assertEquals(
        read().isDragActive,
        false,
        "a drag carrying no Files must not activate the zone",
      );
    });
  });

  it("ref-counts enter and leave so child boundaries do not flicker", async () => {
    await withDropZone(() => undefined, (read) => {
      flushSync(() => read().onDragEnter?.(dragEvent(["Files"])));
      assertEquals(
        read().isDragActive,
        true,
        "a file drag entering the target activates the zone",
      );

      flushSync(() => read().onDragEnter?.(dragEvent(["Files"])));
      flushSync(() => read().onDragLeave?.(dragEvent(["Files"])));
      assertEquals(
        read().isDragActive,
        true,
        "leaving a child keeps the zone active (ref-counted)",
      );

      flushSync(() => read().onDragLeave?.(dragEvent(["Files"])));
      assertEquals(
        read().isDragActive,
        false,
        "the final leave clears the zone",
      );
    });
  });

  it("fires onDrop with the dropped files and only when files are present", async () => {
    const dropped: FileList[] = [];
    await withDropZone((files) => dropped.push(files), (read) => {
      flushSync(() => read().onDragEnter?.(dragEvent(["Files"])));

      const file = new File(["a"], "a.txt");
      flushSync(() => read().onDrop?.(dragEvent(["Files"], [file])));
      assertEquals(dropped.length, 1, "drop with files fires onDrop exactly once");
      assertEquals(
        dropped[0]?.[0],
        file,
        "onDrop receives the dropped file list",
      );
      assertEquals(
        read().isDragActive,
        false,
        "drop resets the active state",
      );

      flushSync(() => read().onDrop?.(dragEvent(["Files"])));
      assertEquals(
        dropped.length,
        1,
        "a drop carrying no files must not fire onDrop",
      );
    });
  });

  it("returns no handlers when there is no onDrop consumer", async () => {
    await withDropZone(undefined, (read) => {
      assertEquals(
        read(),
        { isDragActive: false },
        "no onDrop consumer means no handlers are returned",
      );
    });
  });
});
