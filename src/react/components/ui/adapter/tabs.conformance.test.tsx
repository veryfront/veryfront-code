/**
 * Tabs adapter conformance - the `tabs` slot. One shared behaviour suite runs
 * against the builtin engine and an independent, contract-only engine, proving
 * the slot is a real seam a third-party engine satisfies with the skin
 * (`tabs.tsx`) unchanged.
 *
 * @module react/components/ui/adapter/tabs.conformance.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { Tabs, TabsItem } from "../tabs.tsx";
import { UIAdapterProvider } from "./context.tsx";
import { Slot } from "../slot.tsx";
import type { TabsParts } from "./contract.ts";

function installDom(dom: JSDOM): () => void {
  const w = dom.window as unknown as Record<string, unknown>;
  const g = globalThis as unknown as Record<string, unknown>;
  const keys = [
    "document",
    "window",
    "navigator",
    "HTMLElement",
    "Node",
    "Element",
    "MouseEvent",
    "KeyboardEvent",
  ];
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

function render(el: React.ReactElement): { host: HTMLElement; unmount: () => Promise<void> } {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`);
  const restore = installDom(dom);
  const host = dom.window.document.getElementById("root")!;
  const root = createRoot(host);
  flushSync(() => root.render(el));
  return {
    host: host as unknown as HTMLElement,
    unmount: async () => {
      try {
        root.unmount();
        // Drain one macrotask so jsdom's selectionchange 0ms timer (started
        // by element.focus()) completes inside the test's sanitizer window.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
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

function key(node: Element, value: string): void {
  const KeyboardEventCtor =
    (globalThis as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent;
  flushSync(() =>
    node.dispatchEvent(
      new KeyboardEventCtor("keydown", { bubbles: true, cancelable: true, key: value }),
    )
  );
}

function Harness(): React.ReactElement {
  const [tab, setTab] = React.useState("a");
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsItem value="a">A</TabsItem>
      <TabsItem value="b">B</TabsItem>
    </Tabs>
  );
}

/** Three tabs where the middle one is taken out of the roving order. */
function SkipHarness(
  { off }: { off: { disabled?: boolean; "aria-disabled"?: "true" } },
): React.ReactElement {
  const [tab, setTab] = React.useState("a");
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsItem value="a">A</TabsItem>
      <TabsItem value="b" {...off}>B</TabsItem>
      <TabsItem value="c">C</TabsItem>
    </Tabs>
  );
}

/** A caller that cancels its own click, vetoing the tab's activation. */
function VetoHarness(): React.ReactElement {
  const [tab, setTab] = React.useState("a");
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsItem value="a">A</TabsItem>
      <TabsItem value="b" onClick={(event) => event.preventDefault()}>B</TabsItem>
    </Tabs>
  );
}

function runTabsConformance(label: string, Wrap: React.FC<{ children: React.ReactNode }>): void {
  describe(`Tabs adapter conformance - ${label}`, () => {
    it("role=tablist/tab; clicking a tab selects it (aria-selected + data-state)", async () => {
      const { host, unmount } = render(
        <Wrap>
          <Harness />
        </Wrap>,
      );
      try {
        assert(host.querySelector('[role="tablist"]'), "renders role=tablist");
        const [a, b] = Array.from(host.querySelectorAll('[role="tab"]'));
        assert(a && b, "two tabs render");
        assert(a!.getAttribute("aria-selected") === "true", "a selected initially");
        assert(a!.getAttribute("data-state") === "active", "a data-state active");
        assert(b!.getAttribute("aria-selected") === "false", "b not selected");

        click(b!);
        assert(b!.getAttribute("aria-selected") === "true", "b selected after click");
        assert(a!.getAttribute("aria-selected") === "false", "a deselected");
        assert(b!.getAttribute("data-state") === "active", "b data-state active");
      } finally {
        await unmount();
      }
    });
  });
}

// (1) builtin.
const Identity: React.FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>;
runTabsConformance("builtin (default)", Identity);

describe("Tabs adapter conformance - builtin keyboard navigation", () => {
  it("uses one tab stop and selects tabs with roving keyboard commands", async () => {
    const { host, unmount } = render(
      <Identity>
        <Harness />
      </Identity>,
    );
    try {
      const [a, b] = Array.from(host.querySelectorAll<HTMLElement>('[role="tab"]'));
      assert(a && b, "two tabs render");
      assert(a!.getAttribute("tabindex") === "0", "selected tab is the only tab stop");
      assert(b!.getAttribute("tabindex") === "-1", "inactive tab is skipped by sequential tabbing");

      key(a!, "ArrowRight");
      assert(b!.getAttribute("aria-selected") === "true", "ArrowRight selects the next tab");
      assert(b!.getAttribute("tabindex") === "0", "new selected tab becomes the tab stop");
      assert(a!.getAttribute("tabindex") === "-1", "previous tab leaves the tab order");
      assert(host.ownerDocument.activeElement === b, "keyboard navigation moves focus");

      key(b!, "Home");
      assert(a!.getAttribute("aria-selected") === "true", "Home selects the first tab");
      key(a!, "End");
      assert(b!.getAttribute("aria-selected") === "true", "End selects the last tab");

      // Backwards travel and the wrap at both ends - the modulo arithmetic that
      // ArrowRight/Home/End alone never evaluate.
      key(b!, "ArrowRight");
      assert(
        a!.getAttribute("aria-selected") === "true",
        "ArrowRight wraps from the last tab to the first",
      );
      key(a!, "ArrowLeft");
      assert(
        b!.getAttribute("aria-selected") === "true",
        "ArrowLeft wraps from the first tab to the last",
      );
      key(b!, "ArrowUp");
      assert(
        a!.getAttribute("aria-selected") === "true",
        "ArrowUp navigates backwards like ArrowLeft",
      );
      assert(host.ownerDocument.activeElement === a, "backwards navigation moves focus too");
    } finally {
      await unmount();
    }
  });

  for (
    const [label, off] of [
      ["disabled", { disabled: true }],
      ["aria-disabled", { "aria-disabled": "true" }],
    ] as const
  ) {
    it(`roving navigation steps over a ${label} tab`, async () => {
      const { host, unmount } = render(
        <Identity>
          <SkipHarness off={off} />
        </Identity>,
      );
      try {
        const [a, b, c] = Array.from(host.querySelectorAll<HTMLElement>('[role="tab"]'));
        assert(a && b && c, "three tabs render");

        key(a!, "ArrowRight");
        assert(
          c!.getAttribute("aria-selected") === "true",
          `ArrowRight skips the ${label} tab`,
        );
        assert(
          b!.getAttribute("aria-selected") === "false",
          `the ${label} tab is never selected by roving navigation`,
        );

        key(c!, "ArrowLeft");
        assert(
          a!.getAttribute("aria-selected") === "true",
          `ArrowLeft also skips the ${label} tab`,
        );
      } finally {
        await unmount();
      }
    });
  }
});

describe("Tabs adapter conformance - builtin click composition", () => {
  it("lets a caller that cancels its own click veto the selection", async () => {
    const { host, unmount } = render(
      <Identity>
        <VetoHarness />
      </Identity>,
    );
    try {
      const [a, b] = Array.from(host.querySelectorAll<HTMLElement>('[role="tab"]'));
      assert(a && b, "two tabs render");

      click(b!);
      assert(
        a!.getAttribute("aria-selected") === "true",
        "a caller that preventDefaults its onClick vetoes selection",
      );
      assert(
        b!.getAttribute("aria-selected") === "false",
        "the vetoed tab does not activate",
      );
    } finally {
      await unmount();
    }
  });
});

// (2) an INDEPENDENT contract-only engine - its own tablist context, same skin.
const AltCtx = React.createContext<{ value: string; onValueChange: (v: string) => void } | null>(
  null,
);
const altTabs: TabsParts = {
  Root: ({ value, onValueChange, children, ref, ...props }) => (
    <div ref={ref} role="tablist" data-alt-tabs {...props}>
      <AltCtx.Provider value={{ value, onValueChange }}>{children}</AltCtx.Provider>
    </div>
  ),
  Tab: ({ value, asChild, onClick, ref, ...props }) => {
    const ctx = React.useContext(AltCtx);
    const isActive = ctx?.value === value;
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        {...(asChild ? {} : { type: "button" as const })}
        ref={ref}
        role="tab"
        aria-selected={isActive}
        data-state={isActive ? "active" : "inactive"}
        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
          onClick?.(e);
          ctx?.onValueChange(value);
        }}
        {...props}
      />
    );
  },
};

const AltWrap: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <UIAdapterProvider adapter={{ name: "independent-alt", tabs: altTabs }}>
    {children}
  </UIAdapterProvider>
);
runTabsConformance("independent adapter (contract-is-a-real-seam proof)", AltWrap);
