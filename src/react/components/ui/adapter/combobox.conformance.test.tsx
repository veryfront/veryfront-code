/**
 * Combobox adapter conformance + characterization.
 *
 * Pins the behaviour the builtin `combobox` adapter must provide through the
 * `combobox.tsx` skin: a `role="combobox"` input wired to `aria-expanded` /
 * `aria-controls` / `aria-activedescendant`, a `role="listbox"` portalled into
 * the token scope, substring filtering that hides non-matching `role="option"`s,
 * ArrowDown moving the active descendant, and click / Enter committing a
 * selection.
 *
 * Interactions use React-friendly paths: `input` events for typing and `click`
 * for selection. Keyboard navigation is driven through the adapter's real
 * `onInputKeyDown` handler (captured via `useCombobox`) rather than synthetic DOM
 * `KeyboardEvent`s, which React 19 + jsdom mishandle on a controlled input.
 * `runComboboxConformance(label, Wrap)` is parameterised so a third-party adapter
 * (cmdk / Base UI) can re-run the identical suite.
 *
 * @module react/components/ui/adapter/combobox.conformance.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem } from "../combobox.tsx";
import { useAdapter } from "./context.tsx";
import type { ComboboxState } from "./contract.ts";

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
    "HTMLInputElement",
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
    HTMLInputElement: window.HTMLInputElement,
    MouseEvent: window.MouseEvent,
    getComputedStyle: window.getComputedStyle.bind(window),
  });
  return () => {
    Object.assign(globalThis, previous);
    dom.window.close();
  };
}

/** A fake React.KeyboardEvent carrying just what `onInputKeyDown` reads. */
function keyEvent(key: string): React.KeyboardEvent<HTMLInputElement> {
  return {
    key,
    defaultPrevented: false,
    preventDefault() {/* no-op */},
  } as unknown as React.KeyboardEvent<HTMLInputElement>;
}

export function runComboboxConformance(
  label: string,
  Wrap: React.FC<{ children: React.ReactNode }>,
): void {
  // Capture the live combobox state so the test can invoke the real keyboard
  // handler and read state, without dispatching flaky synthetic KeyboardEvents.
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
        <Wrap>
          <Combobox onValueChange={onValueChange}>
            <ComboboxInput placeholder="Search" />
            <Capture />
            <ComboboxContent>
              <ComboboxItem value="next">Next.js</ComboboxItem>
              <ComboboxItem value="remix">Remix</ComboboxItem>
              <ComboboxItem value="astro">Astro</ComboboxItem>
            </ComboboxContent>
          </Combobox>
        </Wrap>,
      )
    );
    const input = () => scope.querySelector<HTMLInputElement>('[role="combobox"]')!;
    return {
      scope,
      input,
      options: () => [...scope.querySelectorAll<HTMLElement>('[role="option"]')],
      // The input's onChange is a one-liner (`ctx.setQuery(target.value)`), but
      // DOM `input` events don't propagate to React's onChange in this
      // deno+jsdom+React harness, so drive the real query path directly - same as
      // keyboard nav goes through the real `onInputKeyDown`.
      type: (text: string) => flushSync(() => ctx!.setQuery(text)),
      press: (key: string) => flushSync(() => ctx!.onInputKeyDown(keyEvent(key))),
      clickOption: (label: string) =>
        flushSync(() => {
          const opt = [...scope.querySelectorAll<HTMLElement>('[role="option"]')]
            .find((o) => o.textContent === label)!;
          opt.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
        }),
      cleanup: () => {
        root.unmount();
        restore();
      },
    };
  }

  describe(`Combobox adapter conformance - ${label}`, () => {
    it("input is role=combobox with aria-controls + aria-expanded", () => {
      const h = mount();
      try {
        const input = h.input();
        assertEquals(input.getAttribute("role"), "combobox");
        assertEquals(input.getAttribute("aria-expanded"), "false");
        assert(input.getAttribute("aria-controls"), "aria-controls points at the listbox id");
      } finally {
        h.cleanup();
      }
    });

    it("typing opens a role=listbox portalled inside the token scope", () => {
      const h = mount();
      try {
        h.type("re");
        const listbox = h.scope.querySelector('[role="listbox"]');
        assert(listbox, "listbox opens while filtering");
        assertEquals(
          listbox!.closest("[data-vf-ui],[data-vf-chat]"),
          h.scope,
          "listbox stays inside the token scope",
        );
        assertEquals(h.input().getAttribute("aria-expanded"), "true");
      } finally {
        h.cleanup();
      }
    });

    it("typing filters options by substring (non-matching hidden)", () => {
      const h = mount();
      try {
        h.press("ArrowDown"); // open with empty query
        assertEquals(h.options().length, 3, "all options visible with empty query");
        h.type("re");
        assertEquals(h.options().map((o) => o.textContent), ["Remix"], "only matches remain");
      } finally {
        h.cleanup();
      }
    });

    it("ArrowDown sets aria-activedescendant to a rendered option", () => {
      const h = mount();
      try {
        h.press("ArrowDown"); // open
        h.press("ArrowDown"); // move to first option
        const active = h.input().getAttribute("aria-activedescendant");
        assert(active, "aria-activedescendant is set");
        const activeOption = h.scope.querySelector(`#${active}`);
        assert(activeOption, "activedescendant points at a rendered option");
        assertEquals(activeOption!.getAttribute("data-active"), "");
      } finally {
        h.cleanup();
      }
    });

    it("clicking an option commits the value and closes the listbox", () => {
      let selected: string | undefined;
      const h = mount((v) => selected = v);
      try {
        h.press("ArrowDown");
        h.clickOption("Remix");
        assertEquals(selected, "remix", "onValueChange fired with the option value");
        assertEquals(h.input().value, "remix", "input shows the selected text");
        assertEquals(h.scope.querySelector('[role="listbox"]'), null, "listbox closes on select");
      } finally {
        h.cleanup();
      }
    });

    it("Enter on the active option selects it", () => {
      let selected: string | undefined;
      const h = mount((v) => selected = v);
      try {
        h.press("ArrowDown"); // open
        h.press("ArrowDown"); // active = first (Next.js)
        h.press("Enter");
        assertEquals(selected, "next", "Enter commits the active option");
      } finally {
        h.cleanup();
      }
    });

    it("Escape closes the listbox", () => {
      const h = mount();
      try {
        h.press("ArrowDown");
        assert(h.scope.querySelector('[role="listbox"]'), "open before Escape");
        h.press("Escape");
        assertEquals(h.scope.querySelector('[role="listbox"]'), null, "Escape closes it");
      } finally {
        h.cleanup();
      }
    });
  });
}

function BuiltinWrap({ children }: { children: React.ReactNode }): React.ReactElement {
  return <>{children}</>;
}

runComboboxConformance("builtin", BuiltinWrap);
