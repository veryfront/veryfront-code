/**
 * Autocomplete behaviour - the free-text-with-suggestions skin over the builtin
 * `combobox` adapter. Verifies: a `role="combobox"` input; typing surfaces the
 * free text via `onValueChange` and filters suggestions; choosing a suggestion
 * fills the input (also via `onValueChange`); ArrowDown drives
 * `aria-activedescendant`. Keyboard/typing go through the adapter's real state
 * handlers (captured via `useAdapter`) since DOM key/input events don't reach
 * React handlers in this deno+jsdom harness; clicks use MouseEvent.
 *
 * @module react/components/ui/autocomplete.behaviour.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  Autocomplete,
  AutocompleteContent,
  AutocompleteInput,
  AutocompleteItem,
} from "./autocomplete.tsx";
import { useAdapter } from "./adapter/context.tsx";
import type { ComboboxState } from "./adapter/contract.ts";

function installDomGlobals(dom: JSDOM): () => void {
  const window = dom.window;
  const keys = [
    "window",
    "document",
    "navigator",
    "self",
    "Node",
    "Element",
    "HTMLElement",
    "MouseEvent",
    "getComputedStyle",
  ] as const;
  const previous: Record<string, unknown> = {};
  for (const k of keys) previous[k] = (globalThis as Record<string, unknown>)[k];
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    self: window,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    MouseEvent: window.MouseEvent,
    getComputedStyle: window.getComputedStyle.bind(window),
  });
  return () => {
    Object.assign(globalThis, previous);
    dom.window.close();
  };
}

describe("react/components/ui/autocomplete", () => {
  let ctx: ComboboxState | null = null;
  function Capture(): null {
    const { combobox } = useAdapter();
    ctx = combobox.useCombobox();
    return null;
  }

  function mount(onValueChange?: (v: string) => void) {
    const dom = new JSDOM(
      `<!doctype html><html><body><div id="root"></div></body></html>`,
      { url: "https://example.com/", pretendToBeVisual: true },
    );
    const restore = installDomGlobals(dom);
    const scope = document.getElementById("root")!;
    scope.setAttribute("data-vf-ui", "");
    const root = createRoot(scope);
    flushSync(() =>
      root.render(
        <Autocomplete onValueChange={onValueChange}>
          <AutocompleteInput placeholder="Search" />
          <Capture />
          <AutocompleteContent>
            <AutocompleteItem value="Amsterdam" />
            <AutocompleteItem value="Berlin" />
            <AutocompleteItem value="Barcelona" />
          </AutocompleteContent>
        </Autocomplete>,
      )
    );
    return {
      scope,
      input: () => scope.querySelector<HTMLInputElement>('[role="combobox"]')!,
      options: () => [...scope.querySelectorAll<HTMLElement>('[role="option"]')],
      type: (text: string) => flushSync(() => ctx!.setQuery(text)),
      press: (key: string) =>
        flushSync(() =>
          ctx!.onInputKeyDown(
            { key, defaultPrevented: false, preventDefault() {} } as unknown as React.KeyboardEvent<
              HTMLInputElement
            >,
          )
        ),
      clickOption: (label: string) =>
        flushSync(() =>
          [...scope.querySelectorAll<HTMLElement>('[role="option"]')]
            .find((o) => o.textContent === label)!
            .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
        ),
      cleanup: () => {
        root.unmount();
        restore();
      },
    };
  }

  it("renders a role=combobox input", () => {
    const h = mount();
    try {
      assertEquals(h.input().getAttribute("role"), "combobox");
    } finally {
      h.cleanup();
    }
  });

  it("typing surfaces free text via onValueChange and filters suggestions", () => {
    let text: string | undefined;
    const h = mount((v) => text = v);
    try {
      h.type("Ba");
      assertEquals(text, "Ba", "free-typed text is surfaced (not forced to a suggestion)");
      assertEquals(h.options().map((o) => o.textContent), ["Barcelona"], "suggestions filtered");
    } finally {
      h.cleanup();
    }
  });

  it("choosing a suggestion fills the input and surfaces it", () => {
    let text: string | undefined;
    const h = mount((v) => text = v);
    try {
      h.press("ArrowDown"); // open
      h.clickOption("Berlin");
      assertEquals(text, "Berlin", "the chosen suggestion becomes the value");
      assertEquals(h.input().value, "Berlin", "and fills the input");
    } finally {
      h.cleanup();
    }
  });

  it("ArrowDown drives aria-activedescendant over the suggestions", () => {
    const h = mount();
    try {
      h.press("ArrowDown"); // open
      h.press("ArrowDown"); // first suggestion active
      const active = h.input().getAttribute("aria-activedescendant");
      assert(active, "aria-activedescendant is set");
      assert(h.scope.querySelector(`#${active}`), "points at a rendered suggestion");
    } finally {
      h.cleanup();
    }
  });
});
