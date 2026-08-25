import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { installComponentDom } from "#veryfront/testing/dom-globals.ts";
import { MessageEditForm } from "./message-edit-form.tsx";

function setupMessageEditFormDom(): () => void {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "https://example.com/",
  });
  const window = dom.window;
  // The form focuses its textarea on mount; React's legacy focus path probes
  // attachEvent/detachEvent, which jsdom does not implement.
  Object.defineProperties(window.HTMLElement.prototype, {
    attachEvent: { value: () => {}, configurable: true },
    detachEvent: { value: () => {}, configurable: true },
  });
  return installComponentDom(dom, { windowGlobals: ["KeyboardEvent"] });
}

describe("MessageEditForm", () => {
  it("renders the initial content inside the textarea", () => {
    const html = renderToString(
      <MessageEditForm
        initialContent="Original message body"
        onSave={() => undefined}
        onCancel={() => undefined}
      />,
    );
    assertStringIncludes(html, "Original message body");
    assertStringIncludes(html, "<textarea");
  });

  it("renders the default Save & Submit / Cancel labels", () => {
    const html = renderToString(
      <MessageEditForm
        initialContent="Hello"
        onSave={() => undefined}
        onCancel={() => undefined}
      />,
    );
    assertStringIncludes(html, "Save &amp; Submit");
    assertStringIncludes(html, "Cancel");
  });

  it("renders custom save/cancel labels when provided", () => {
    const html = renderToString(
      <MessageEditForm
        initialContent="Hello"
        onSave={() => undefined}
        onCancel={() => undefined}
        saveLabel="Update"
        cancelLabel="Discard"
      />,
    );
    assertStringIncludes(html, "Update");
    assertStringIncludes(html, "Discard");
  });

  it("disables the save button when the initial content is blank", () => {
    const html = renderToString(
      <MessageEditForm
        initialContent="   "
        onSave={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const saveButtonStart = html.indexOf("Save &amp; Submit");
    const buttonOpenTag = html.lastIndexOf("<button", saveButtonStart);
    assert(
      html.slice(buttonOpenTag, saveButtonStart).includes("disabled"),
      "expected the save button to be disabled for blank content",
    );
  });

  it("merges className and spreads extra props onto the wrapper", () => {
    const html = renderToString(
      <MessageEditForm
        initialContent="Hello"
        onSave={() => undefined}
        onCancel={() => undefined}
        className="vf-custom-edit-form"
        data-testid="edit-form"
      />,
    );
    assertStringIncludes(html, "vf-custom-edit-form");
    assertStringIncludes(html, 'data-testid="edit-form"');
  });

  it("submits trimmed content on Enter, ignores Shift+Enter, and cancels on Escape", async () => {
    const restoreDom = setupMessageEditFormDom();
    const saves: string[] = [];
    let cancels = 0;
    try {
      const root = createRoot(document.getElementById("root")!);
      flushSync(() => {
        root.render(
          <MessageEditForm
            initialContent="  hello  "
            onSave={(value) => saves.push(value)}
            onCancel={() => cancels++}
          />,
        );
      });
      const textarea = document.querySelector("textarea");
      assert(textarea, "renders the textarea");
      const press = (init: KeyboardEventInit) =>
        flushSync(() =>
          textarea.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }))
        );

      press({ key: "Enter" });
      assertEquals(saves, ["hello"], "Enter submits the trimmed content");

      press({ key: "Enter", shiftKey: true });
      assertEquals(saves.length, 1, "Shift+Enter does not submit");
      assertEquals(cancels, 0, "Shift+Enter does not cancel");

      press({ key: "Escape" });
      assertEquals(cancels, 1, "Escape cancels");
      assertEquals(saves.length, 1, "Escape does not submit");

      await unmountReactRoot(root);
    } finally {
      restoreDom();
    }
  });

  it("submits trimmed content when the save button is clicked", async () => {
    const restoreDom = setupMessageEditFormDom();
    const saves: string[] = [];
    try {
      const root = createRoot(document.getElementById("root")!);
      flushSync(() => {
        root.render(
          <MessageEditForm
            initialContent="  hello  "
            onSave={(value) => saves.push(value)}
            onCancel={() => undefined}
          />,
        );
      });
      const save = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Save & Submit")
      );
      assert(save, "renders the save button");
      flushSync(() => save.click());
      assertEquals(saves, ["hello"], "the save button submits the trimmed content");

      await unmountReactRoot(root);
    } finally {
      restoreDom();
    }
  });
});
