/**
 * ToggleGroup adapter conformance: the `toggleGroup` slot. One shared behaviour
 * suite runs against the builtin engine and an independent, contract-only engine,
 * proving the slot is a real seam a third-party engine satisfies with the skin
 * (`toggle-group.tsx`) unchanged.
 *
 * @module react/components/ui/adapter/toggle-group.conformance.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ToggleGroup, ToggleGroupItem } from "../toggle-group.tsx";
import { UIAdapterProvider } from "./context.tsx";
import { Slot } from "../slot.tsx";
import type { ToggleGroupParts } from "./contract.ts";

function installDom(dom: JSDOM): () => void {
  const w = dom.window as unknown as Record<string, unknown>;
  const g = globalThis as unknown as Record<string, unknown>;
  const keys = ["document", "window", "navigator", "HTMLElement", "Node", "Element", "MouseEvent"];
  const prev: Record<string, unknown> = {};
  for (const k of keys) prev[k] = g[k];
  for (const k of keys) g[k] = w[k];
  g.document = w.document;
  g.window = w;
  return () => {
    for (const k of keys) g[k] = prev[k];
    dom.window.close();
  };
}

function render(
  element: React.ReactElement,
): { host: HTMLElement; unmount: () => Promise<void> } {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`);
  const restore = installDom(dom);
  const host = dom.window.document.getElementById("root")!;
  const root = createRoot(host);
  flushSync(() => root.render(element));
  return {
    host: host as unknown as HTMLElement,
    unmount: async () => {
      try {
        await unmountReactRoot(root);
      } finally {
        restore();
      }
    },
  };
}

function click(node: Element): void {
  const MouseEventCtor = (globalThis as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent;
  flushSync(() =>
    node.dispatchEvent(new MouseEventCtor("click", { bubbles: true, cancelable: true }))
  );
}

function runToggleGroupConformance(
  label: string,
  Wrap: React.FC<{ children: React.ReactNode }>,
  /**
   * Selector unique to the engine `Wrap` installs, or `null` for the builtin.
   * Without it the suite proves only that SOME engine produced the right DOM -
   * a skin that ignored `useAdapter()` and imported the builtin directly would
   * pass the "real seam" run unnoticed.
   */
  engineMarker: string | null,
): void {
  describe(`ToggleGroup adapter conformance: ${label}`, () => {
    it("single-select: click sets aria-pressed/data-state; click again clears", async () => {
      const { host, unmount } = render(
        <Wrap>
          <ToggleGroup type="single">
            <ToggleGroupItem value="a">A</ToggleGroupItem>
            <ToggleGroupItem value="b">B</ToggleGroupItem>
          </ToggleGroup>
        </Wrap>,
      );
      try {
        if (engineMarker) {
          assert(
            host.querySelector(engineMarker),
            `the skin resolved this engine through useAdapter() (${engineMarker})`,
          );
        } else {
          assert(
            host.querySelector("[data-alt-group]") === null &&
              host.querySelector('[role="group"][data-type]'),
            "the builtin engine rendered its own root",
          );
        }
        const [a, b] = Array.from(host.querySelectorAll("button"));
        assert(a && b, "renders two item buttons");
        assert(a!.getAttribute("aria-pressed") === "false", "a starts unpressed");

        click(a!);
        assert(a!.getAttribute("aria-pressed") === "true", "a pressed after click");
        assert(a!.getAttribute("data-state") === "on", "a data-state on");
        assert(b!.getAttribute("aria-pressed") === "false", "b still unpressed");

        click(b!);
        assert(b!.getAttribute("aria-pressed") === "true", "single-select moves to b");
        assert(a!.getAttribute("aria-pressed") === "false", "a deselected");

        click(b!);
        assert(b!.getAttribute("aria-pressed") === "false", "click selected again clears it");
      } finally {
        await unmount();
      }
    });

    it("blocks native, composed-link, and consumer-cancelled toggles", async () => {
      let disabledWrapperClickCount = 0;
      let disabledChildClickCount = 0;
      let disabledWrapperAuxClickCount = 0;
      let disabledChildAuxClickCount = 0;
      const { host, unmount } = render(
        <Wrap>
          <ToggleGroup type="multiple" disabled>
            <ToggleGroupItem value="native">Native</ToggleGroupItem>
            <ToggleGroupItem
              value="link"
              asChild
              onClick={() => disabledWrapperClickCount += 1}
              onAuxClick={() => disabledWrapperAuxClickCount += 1}
            >
              <a
                href="#disabled"
                onClickCapture={() => disabledChildClickCount += 1}
                onClick={() => disabledChildClickCount += 1}
                onAuxClickCapture={() => disabledChildAuxClickCount += 1}
                onAuxClick={() => disabledChildAuxClickCount += 1}
              >
                Link
              </a>
            </ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup type="multiple">
            <ToggleGroupItem value="cancelled" onClick={(event) => event.preventDefault()}>
              Cancelled
            </ToggleGroupItem>
          </ToggleGroup>
        </Wrap>,
      );
      try {
        const native = host.querySelector("button")!;
        const link = host.querySelector("a")!;
        const cancelled = host.querySelectorAll("button")[1]!;
        click(native);
        const linkEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
        flushSync(() => link.dispatchEvent(linkEvent));
        const linkAuxEvent = new MouseEvent("auxclick", {
          bubbles: true,
          button: 1,
          cancelable: true,
        });
        flushSync(() => link.dispatchEvent(linkAuxEvent));
        click(cancelled);
        assert(native.getAttribute("aria-pressed") === "false", "disabled button stays off");
        assert(linkEvent.defaultPrevented, "disabled link prevents navigation");
        assert(linkAuxEvent.defaultPrevented, "disabled link prevents auxiliary navigation");
        assert(link.getAttribute("href") === null, "disabled link removes navigation");
        assert(link.getAttribute("aria-disabled") === "true", "disabled link exposes its state");
        assert(
          link.classList.contains("aria-disabled:opacity-50"),
          "disabled composed item carries its disabled visual state",
        );
        assert(link.getAttribute("aria-pressed") === "false", "disabled link stays off");
        assert(
          disabledWrapperClickCount === 0,
          "disabled composed item skips its wrapper click handler",
        );
        assert(
          disabledChildClickCount === 0,
          "disabled composed item skips its child click handler",
        );
        assert(
          disabledWrapperAuxClickCount === 0,
          "disabled composed item skips its wrapper auxiliary handler",
        );
        assert(
          disabledChildAuxClickCount === 0,
          "disabled composed item skips its child auxiliary handler",
        );
        assert(cancelled.getAttribute("aria-pressed") === "false", "cancelled item stays off");
      } finally {
        await unmount();
      }
    });

    it("normalizes retained uncontrolled state when selection mode changes", async () => {
      function Probe(): React.ReactElement {
        const [multiple, setMultiple] = React.useState(true);
        return (
          <Wrap>
            <button type="button" data-switch onClick={() => setMultiple(false)}>Switch</button>
            {multiple
              ? (
                <ToggleGroup type="multiple" defaultValue={["a", "b"]}>
                  <ToggleGroupItem value="a">A</ToggleGroupItem>
                  <ToggleGroupItem value="b">B</ToggleGroupItem>
                </ToggleGroup>
              )
              : (
                <ToggleGroup type="single">
                  <ToggleGroupItem value="a">A</ToggleGroupItem>
                  <ToggleGroupItem value="b">B</ToggleGroupItem>
                </ToggleGroup>
              )}
          </Wrap>
        );
      }
      const { host, unmount } = render(<Probe />);
      try {
        click(host.querySelector("[data-switch]")!);
        const items = Array.from(host.querySelectorAll<HTMLElement>("[data-state]"));
        assert(items[0]?.dataset.state === "on", "first retained selection remains");
        assert(items[1]?.dataset.state === "off", "single mode drops extra retained selections");
      } finally {
        await unmount();
      }
    });
  });
}

// (1) builtin.
const Identity: React.FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>;
runToggleGroupConformance("builtin (default)", Identity, null);

// (2) an INDEPENDENT contract-only engine: a distinct wrapper (`data-alt-group`)
// + its own selection reducer, same skin + call-site.
const AltCtx = React.createContext<
  { value: string[]; toggle: (v: string) => void; disabled?: boolean } | null
>(null);
const altToggleGroup: ToggleGroupParts = {
  Root: (
    { type = "single", value, defaultValue, onValueChange, disabled, children, ref, ...props },
  ) => {
    const controlled = value !== undefined;
    const normalize = (v: string | string[] | undefined) => {
      const values = v == null ? [] : Array.isArray(v) ? v : [v];
      return type === "single" ? values.slice(0, 1) : values;
    };
    const [internal, setInternal] = React.useState<string[]>(() => normalize(defaultValue));
    const selected = normalize(controlled ? value : internal);
    React.useEffect(() => {
      if (!controlled) setInternal((current) => normalize(current));
    }, [controlled, type]);
    const toggle = React.useCallback((iv: string) => {
      const next = type === "single"
        ? (selected[0] === iv ? [] : [iv])
        : (selected.includes(iv) ? selected.filter((v) => v !== iv) : [...selected, iv]);
      if (!controlled) setInternal(next);
      if (type === "single") {
        (onValueChange as ((value: string) => void) | undefined)?.(next[0] ?? "");
      } else {
        (onValueChange as ((value: string[]) => void) | undefined)?.(next);
      }
    }, [type, selected, controlled, onValueChange]);
    return (
      <div ref={ref} role="group" data-alt-group {...props}>
        <AltCtx.Provider value={{ value: selected, toggle, disabled }}>{children}</AltCtx.Provider>
      </div>
    );
  },
  Item: ({ value, asChild, onClick, ref, disabled, ...props }) => {
    const ctx = React.useContext(AltCtx);
    const isOn = ctx?.value.includes(value) ?? false;
    const isDisabled = Boolean(disabled || ctx?.disabled);
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        {...(asChild ? {} : { type: "button" as const })}
        ref={ref}
        aria-pressed={isOn}
        aria-disabled={asChild && isDisabled ? true : undefined}
        disabled={isDisabled}
        data-state={isOn ? "on" : "off"}
        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
          if (isDisabled) {
            e.preventDefault();
            return;
          }
          onClick?.(e);
          if (!e.defaultPrevented) ctx?.toggle(value);
        }}
        {...props}
      />
    );
  },
};

const AltWrap: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <UIAdapterProvider adapter={{ name: "independent-alt", toggleGroup: altToggleGroup }}>
    {children}
  </UIAdapterProvider>
);
runToggleGroupConformance(
  "independent adapter (contract-is-a-real-seam proof)",
  AltWrap,
  "[data-alt-group]",
);
