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

function render(element: React.ReactElement): { host: HTMLElement; unmount: () => void } {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`);
  const restore = installDom(dom);
  const host = dom.window.document.getElementById("root")!;
  const root = createRoot(host);
  flushSync(() => root.render(element));
  return {
    host: host as unknown as HTMLElement,
    unmount: () => {
      try {
        root.unmount();
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
): void {
  describe(`ToggleGroup adapter conformance: ${label}`, () => {
    it("single-select: click sets aria-pressed/data-state; click again clears", () => {
      const { host, unmount } = render(
        <Wrap>
          <ToggleGroup type="single">
            <ToggleGroupItem value="a">A</ToggleGroupItem>
            <ToggleGroupItem value="b">B</ToggleGroupItem>
          </ToggleGroup>
        </Wrap>,
      );
      try {
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
        unmount();
      }
    });
  });
}

// (1) builtin.
const Identity: React.FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>;
runToggleGroupConformance("builtin (default)", Identity);

describe("Builtin ToggleGroup event semantics", () => {
  it("does not toggle disabled native items", () => {
    const { host, unmount } = render(
      <ToggleGroup type="multiple" disabled>
        <ToggleGroupItem value="disabled">Disabled</ToggleGroupItem>
      </ToggleGroup>,
    );
    try {
      const item = host.querySelector("button")!;
      click(item);
      assert(item.getAttribute("aria-pressed") === "false", "disabled group blocks toggles");
    } finally {
      unmount();
    }
  });

  it("does not toggle disabled asChild items", () => {
    const { host, unmount } = render(
      <ToggleGroup type="multiple" disabled>
        <ToggleGroupItem value="disabled" asChild>
          <a href="#disabled">Disabled</a>
        </ToggleGroupItem>
      </ToggleGroup>,
    );
    try {
      const item = host.querySelector("a")!;
      assert(item.getAttribute("aria-disabled") === "true", "disabled child is exposed to AT");
      click(item);
      assert(item.getAttribute("aria-pressed") === "false", "disabled child blocks toggles");
    } finally {
      unmount();
    }
  });

  it("does not toggle consumer-cancelled items", () => {
    const second = render(
      <ToggleGroup type="multiple">
        <ToggleGroupItem value="cancelled" onClick={(event) => event.preventDefault()}>
          Cancelled
        </ToggleGroupItem>
      </ToggleGroup>,
    );
    try {
      const item = second.host.querySelector("button")!;
      click(item);
      assert(item.getAttribute("aria-pressed") === "false", "preventDefault cancels toggling");
    } finally {
      second.unmount();
    }
  });
});

// (2) an INDEPENDENT contract-only engine: a distinct wrapper (`data-alt-group`)
// + its own selection reducer, same skin + call-site.
const AltCtx = React.createContext<{ value: string[]; toggle: (v: string) => void } | null>(null);
const altToggleGroup: ToggleGroupParts = {
  Root: (
    { type = "single", value, defaultValue, onValueChange, disabled: _d, children, ref, ...props },
  ) => {
    const controlled = value !== undefined;
    const toArr = (v: string | string[] | undefined) => v == null ? [] : Array.isArray(v) ? v : [v];
    const [internal, setInternal] = React.useState<string[]>(() => toArr(defaultValue));
    const selected = controlled ? toArr(value) : internal;
    const toggle = React.useCallback((iv: string) => {
      const next = type === "single"
        ? (selected[0] === iv ? [] : [iv])
        : (selected.includes(iv) ? selected.filter((v) => v !== iv) : [...selected, iv]);
      if (!controlled) setInternal(next);
      onValueChange?.(type === "single" ? (next[0] ?? "") : next);
    }, [type, selected, controlled, onValueChange]);
    return (
      <div ref={ref} role="group" data-alt-group {...props}>
        <AltCtx.Provider value={{ value: selected, toggle }}>{children}</AltCtx.Provider>
      </div>
    );
  },
  Item: ({ value, asChild, onClick, ref, ...props }) => {
    const ctx = React.useContext(AltCtx);
    const isOn = ctx?.value.includes(value) ?? false;
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        {...(asChild ? {} : { type: "button" as const })}
        ref={ref}
        aria-pressed={isOn}
        data-state={isOn ? "on" : "off"}
        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
          onClick?.(e);
          ctx?.toggle(value);
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
runToggleGroupConformance("independent adapter (contract-is-a-real-seam proof)", AltWrap);
