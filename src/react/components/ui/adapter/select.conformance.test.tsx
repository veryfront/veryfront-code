/**
 * Select adapter conformance + characterization. Pins the pre-adapter behaviour
 * of `select.tsx` now that its dual-state machine (value + open) + `Floating`
 * listbox live in `builtinSelect`, resolved via `useAdapter()`: the trigger is a
 * `role="combobox"` showing the selected label, opening reveals a `role="listbox"`
 * in the token scope, selecting an option sets the value + closes + marks
 * `aria-selected`. Re-run through `UIAdapterProvider`.
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../select.tsx";
import { UIAdapterProvider } from "./context.tsx";
import { builtinSelect } from "./builtin/select.tsx";

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
    "KeyboardEvent",
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
    KeyboardEvent: window.KeyboardEvent,
    getComputedStyle: window.getComputedStyle.bind(window),
  });
  return () => {
    Object.assign(globalThis, previous);
    dom.window.close();
  };
}

function mount(element: React.ReactElement): {
  scope: HTMLElement;
  root: Root;
  click: (el: Element) => void;
  cleanup: () => void;
} {
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="root"></div></body></html>`,
    { url: "https://example.com/", pretendToBeVisual: true },
  );
  const restore = installDomGlobals(dom);
  const scope = document.createElement("div");
  scope.setAttribute("data-vf-ui", "");
  document.getElementById("root")!.appendChild(scope);
  const root = createRoot(scope);
  flushSync(() => root.render(element));
  const win = dom.window;
  return {
    scope,
    root,
    click: (el: Element) =>
      flushSync(() => el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }))),
    cleanup: () => {
      root.unmount();
      restore();
    },
  };
}

function Fixture(
  { Wrap, ...selectProps }:
    & { Wrap: React.FC<{ children: React.ReactNode }> }
    & React.ComponentProps<typeof Select>,
): React.ReactElement {
  return (
    <Wrap>
      <Select {...selectProps}>
        <SelectTrigger>
          <SelectValue placeholder="Pick one" />
        </SelectTrigger>
        <SelectContent className="vf-test-listbox">
          <SelectItem value="a">Apple</SelectItem>
          <SelectItem value="b">Banana</SelectItem>
        </SelectContent>
      </Select>
    </Wrap>
  );
}

function runSelectConformance(
  label: string,
  Wrap: React.FC<{ children: React.ReactNode }>,
): void {
  describe(`Select adapter conformance — ${label}`, () => {
    it("trigger is a combobox showing the placeholder until a value is chosen", () => {
      const { scope, cleanup } = mount(<Fixture Wrap={Wrap} />);
      try {
        const trigger = scope.querySelector('[role="combobox"]') as HTMLElement;
        assert(trigger, "trigger has role=combobox");
        assertEquals(trigger.getAttribute("aria-haspopup"), "listbox");
        assert(trigger.textContent?.includes("Pick one"), "shows placeholder");
      } finally {
        cleanup();
      }
    });

    it("opening reveals a listbox in the token scope; selecting sets value + closes", () => {
      let changed: string | undefined;
      const { scope, click, cleanup } = mount(
        <Fixture Wrap={Wrap} onValueChange={(v) => (changed = v)} />,
      );
      try {
        assertEquals(scope.querySelector('[role="listbox"]'), null, "closed initially");
        click(scope.querySelector('[role="combobox"]')!);
        const listbox = scope.querySelector('[role="listbox"]') as HTMLElement;
        assert(listbox, "opens a listbox");
        assertEquals(
          listbox.closest("[data-vf-ui],[data-vf-chat]"),
          scope,
          "listbox stays within the token scope",
        );
        assert(listbox.className.includes("vf-test-listbox"), "consumer class merged");
        const options = scope.querySelectorAll('[role="option"]');
        assertEquals(options.length, 2, "renders both options");
        click(options[1]); // Banana
        assertEquals(changed, "b", "onValueChange fired with the chosen value");
        assertEquals(scope.querySelector('[role="listbox"]'), null, "closed on select");
        assert(
          scope.querySelector('[role="combobox"]')!.textContent?.includes("Banana"),
          "trigger now shows the selected label",
        );
      } finally {
        cleanup();
      }
    });

    it("the current option is marked aria-selected", () => {
      const { scope, click, cleanup } = mount(<Fixture Wrap={Wrap} defaultValue="a" />);
      try {
        click(scope.querySelector('[role="combobox"]')!);
        const options = Array.from(scope.querySelectorAll('[role="option"]'));
        const apple = options.find((o) => o.textContent?.includes("Apple"))!;
        const banana = options.find((o) => o.textContent?.includes("Banana"))!;
        assertEquals(apple.getAttribute("aria-selected"), "true");
        assertEquals(banana.getAttribute("aria-selected"), "false");
      } finally {
        cleanup();
      }
    });

    it("controlled value drives the trigger label", () => {
      function Controlled({ value }: { value: string }): React.ReactElement {
        return <Fixture Wrap={Wrap} value={value} onValueChange={() => {}} />;
      }
      const { scope, root, cleanup } = mount(<Controlled value="a" />);
      try {
        assert(
          scope.querySelector('[role="combobox"]')!.textContent?.includes("Apple"),
          "shows controlled value's label",
        );
        flushSync(() => root.render(<Controlled value="b" />));
        assert(
          scope.querySelector('[role="combobox"]')!.textContent?.includes("Banana"),
          "updates when the controlled value changes",
        );
      } finally {
        cleanup();
      }
    });
  });
}

function BuiltinWrap({ children }: { children: React.ReactNode }): React.ReactElement {
  return <>{children}</>;
}
function ProviderWrap({ children }: { children: React.ReactNode }): React.ReactElement {
  return <UIAdapterProvider adapter={{ select: builtinSelect }}>{children}</UIAdapterProvider>;
}

runSelectConformance("builtin", BuiltinWrap);
runSelectConformance("builtin via UIAdapterProvider (swap path)", ProviderWrap);
