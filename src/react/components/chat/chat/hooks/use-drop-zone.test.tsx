import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { useDropZone, type UseDropZoneResult } from "./use-drop-zone.ts";

describe("useDropZone", () => {
  it("returns explicit event handlers instead of a props bag", async () => {
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
      result = useDropZone(() => undefined);
      return null;
    }

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");
      const root = createRoot(rootElement);
      flushSync(() => root.render(<Capture />));

      assert(result);
      assertEquals("dragProps" in result, false);
      assert(typeof result.onDragEnter === "function");
      assert(typeof result.onDragLeave === "function");
      assert(typeof result.onDragOver === "function");
      assert(typeof result.onDrop === "function");

      root.unmount();
    } finally {
      Object.assign(globalThis, previous);
      dom.window.close();
    }
  });
});
