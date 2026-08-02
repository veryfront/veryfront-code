/**
 * Disclosure adapter conformance: the `disclosure` slot (Collapsible archetype).
 *
 * Runs one shared behaviour suite against (1) the builtin engine, (2) the builtin
 * re-supplied through `UIAdapterProvider` (the swap path), and (3) an independent,
 * contract-only alternative engine: proving the `disclosure` slot is a real seam
 * a third-party engine can satisfy without the skin (`collapsible.tsx`) changing.
 *
 * @module react/components/ui/adapter/disclosure.conformance.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { UIAdapterProvider, useAdapter } from "./context.tsx";
import { Slot } from "../slot.tsx";
import type { DisclosureParts } from "./contract.ts";

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

/** Click a node with a bubbling MouseEvent (reaches React in jsdom). */
function click(node: Element): MouseEvent {
  const MouseEventCtor = (globalThis as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent;
  const event = new MouseEventCtor("click", { bubbles: true, cancelable: true });
  flushSync(() => node.dispatchEvent(event));
  return event;
}

function runDisclosureConformance(
  label: string,
  Wrap: React.FC<{ children: React.ReactNode }>,
): void {
  describe(`Disclosure adapter conformance: ${label}`, () => {
    it("starts closed, toggles content + aria-expanded on trigger click", () => {
      const { host, unmount } = render(
        <Wrap>
          <DisclosureProbe />
        </Wrap>,
      );
      try {
        const trigger = host.querySelector("button")!;
        assert(trigger, "renders a trigger button");
        assert(trigger.getAttribute("aria-expanded") === "false", "closed by default");
        const content = host.querySelector<HTMLElement>("[data-vf-content]")!;
        assert(content.hidden, "content retained but hidden while closed");
        assert(trigger.getAttribute("aria-controls") === content.id, "trigger controls content");

        click(trigger);
        assert(trigger.getAttribute("aria-expanded") === "true", "expanded after click");
        assert(!content.hidden, "content revealed while open");

        click(trigger);
        assert(trigger.getAttribute("aria-expanded") === "false", "collapsed after second click");
        assert(content.hidden, "content hidden after collapse");
      } finally {
        unmount();
      }
    });

    it("honours disabled state and a consumer-cancelled trigger event", () => {
      const { host, unmount } = render(
        <Wrap>
          <DisclosureProbe disabled preventToggle />
        </Wrap>,
      );
      try {
        const trigger = host.querySelector("button")!;
        click(trigger);
        assert(trigger.getAttribute("aria-expanded") === "false", "disabled trigger stays closed");
      } finally {
        unmount();
      }

      const second = render(
        <Wrap>
          <DisclosureProbe preventToggle />
        </Wrap>,
      );
      try {
        const trigger = second.host.querySelector("button")!;
        click(trigger);
        assert(
          trigger.getAttribute("aria-expanded") === "false",
          "preventDefault cancels the internal toggle",
        );
      } finally {
        second.unmount();
      }
    });

    it("prevents disabled asChild link navigation", () => {
      const { host, unmount } = render(
        <Wrap>
          <DisclosureAsChildProbe />
        </Wrap>,
      );
      try {
        const link = host.querySelector("a")!;
        const event = click(link);
        assert(event.defaultPrevented, "disabled composed link prevents its default action");
        assert(link.getAttribute("aria-expanded") === "false", "disabled link stays closed");
      } finally {
        unmount();
      }
    });

    it("keeps realized trigger and content ids wired in both directions", () => {
      const { host, unmount } = render(
        <Wrap>
          <DisclosureCustomIdProbe />
        </Wrap>,
      );
      try {
        const trigger = host.querySelector("button")!;
        const content = host.querySelector<HTMLElement>("[role=region]")!;
        assert(trigger.getAttribute("aria-controls") === "custom-content", "controls realized id");
        assert(
          content.getAttribute("aria-labelledby") === "custom-trigger",
          "region names trigger",
        );
      } finally {
        unmount();
      }
    });
  });
}

function DisclosureProbe(
  { disabled, preventToggle = false }: { disabled?: boolean; preventToggle?: boolean },
): React.ReactElement {
  const { disclosure } = useAdapter();
  return (
    <disclosure.Root disabled={disabled}>
      <disclosure.Trigger onClick={preventToggle ? (event) => event.preventDefault() : undefined}>
        Toggle
      </disclosure.Trigger>
      <disclosure.Content data-vf-content>
        <span data-vf-body>Body</span>
      </disclosure.Content>
    </disclosure.Root>
  );
}

function DisclosureAsChildProbe(): React.ReactElement {
  const { disclosure } = useAdapter();
  return (
    <disclosure.Root disabled>
      <disclosure.Trigger asChild>
        <a href="#navigated">Toggle</a>
      </disclosure.Trigger>
      <disclosure.Content>Body</disclosure.Content>
    </disclosure.Root>
  );
}

function DisclosureCustomIdProbe(): React.ReactElement {
  const { disclosure } = useAdapter();
  return (
    <disclosure.Root triggerId="custom-trigger" contentId="custom-content">
      <disclosure.Trigger id="custom-trigger">Toggle</disclosure.Trigger>
      <disclosure.Content id="custom-content" role="region">Body</disclosure.Content>
    </disclosure.Root>
  );
}

// (1) builtin: no provider.
const Identity: React.FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>;
runDisclosureConformance("builtin (default)", Identity);

// (3) an INDEPENDENT contract-only engine: proves the seam. Different impl than
// the builtin (its own context + a `<section>` wrapper), same skin + call-site.
const AltCtx = React.createContext<
  {
    open: boolean;
    toggle: () => void;
    triggerId: string;
    contentId: string;
    disabled?: boolean;
  } | null
>(null);
const altDisclosure: DisclosureParts = {
  Root: ({
    open,
    defaultOpen,
    onOpenChange,
    disabled,
    triggerId: explicitTriggerId,
    contentId: explicitContentId,
    children,
    ref,
    ...props
  }) => {
    const controlled = open !== undefined;
    const [internal, setInternal] = React.useState(defaultOpen ?? false);
    const baseId = `alt-disclosure-${React.useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
    const triggerId = explicitTriggerId ?? `${baseId}-trigger`;
    const contentId = explicitContentId ?? `${baseId}-content`;
    const isOpen = controlled ? open : internal;
    const toggle = React.useCallback(() => {
      if (!controlled) setInternal((v) => !v);
      onOpenChange?.(!isOpen);
    }, [controlled, isOpen, onOpenChange]);
    return (
      <section ref={ref} data-state={isOpen ? "open" : "closed"} {...props}>
        <AltCtx.Provider
          value={{
            open: isOpen,
            toggle,
            triggerId,
            contentId,
            disabled,
          }}
        >
          {children}
        </AltCtx.Provider>
      </section>
    );
  },
  Trigger: ({ asChild, onClick, children, ref, disabled, id, ...props }) => {
    const ctx = React.useContext(AltCtx);
    const Comp = asChild ? Slot : "button";
    const isDisabled = Boolean(ctx?.disabled || disabled);
    const realizedId = id ?? ctx?.triggerId;
    return (
      <Comp
        {...(asChild ? {} : { type: "button" as const })}
        ref={ref}
        id={realizedId}
        aria-expanded={ctx?.open ?? false}
        aria-controls={ctx?.contentId}
        disabled={asChild ? undefined : isDisabled}
        aria-disabled={asChild && isDisabled ? true : undefined}
        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
          onClick?.(e);
          if (isDisabled) e.preventDefault();
          if (!e.defaultPrevented) ctx?.toggle();
        }}
        {...props}
      >
        {children}
      </Comp>
    );
  },
  Content: ({ children, ref, id, hidden, ...props }) => {
    const ctx = React.useContext(AltCtx);
    const realizedId = id ?? ctx?.contentId;
    return (
      <div
        {...props}
        ref={ref}
        id={realizedId}
        aria-labelledby={props["aria-labelledby"] ?? ctx?.triggerId}
        data-state={ctx?.open ? "open" : "closed"}
        hidden={Boolean(hidden || !ctx?.open)}
      >
        {children}
      </div>
    );
  },
};

const AltWrap: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <UIAdapterProvider adapter={{ name: "independent-alt", disclosure: altDisclosure }}>
    {children}
  </UIAdapterProvider>
);
runDisclosureConformance("independent adapter (contract-is-a-real-seam proof)", AltWrap);
