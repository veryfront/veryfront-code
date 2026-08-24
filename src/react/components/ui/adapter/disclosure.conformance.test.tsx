/**
 * Disclosure adapter conformance: the `disclosure` slot (Collapsible archetype).
 *
 * Runs one shared behaviour suite against (1) the builtin engine and (2) an
 * independent, contract-only alternative engine: proving the `disclosure` slot
 * is a real seam a third-party engine can satisfy without the skin
 * (`collapsible.tsx`) changing.
 *
 * @module react/components/ui/adapter/disclosure.conformance.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { UIAdapterProvider } from "./context.tsx";
import { Slot } from "../slot.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../collapsible.tsx";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../accordion.tsx";
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

/** Click a node with a bubbling MouseEvent (reaches React in jsdom). */
function click(node: Element): MouseEvent {
  const MouseEventCtor = (globalThis as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent;
  const event = new MouseEventCtor("click", { bubbles: true, cancelable: true });
  flushSync(() => node.dispatchEvent(event));
  return event;
}

function auxClick(node: Element): MouseEvent {
  const MouseEventCtor = (globalThis as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent;
  const event = new MouseEventCtor("auxclick", { bubbles: true, button: 1, cancelable: true });
  flushSync(() => node.dispatchEvent(event));
  return event;
}

function runDisclosureConformance(
  label: string,
  Wrap: React.FC<{ children: React.ReactNode }>,
): void {
  describe(`Disclosure adapter conformance: ${label}`, () => {
    it("keeps root-owned Collapsible IDs wired during SSR", () => {
      const html = renderToString(
        <Wrap>
          <Collapsible triggerId="ssr-trigger" contentId="ssr-content">
            <DisclosureWrappedTrigger />
            <DisclosureWrappedContent />
          </Collapsible>
        </Wrap>,
      );
      const document = new JSDOM(html).window.document;
      const trigger = document.querySelector("button")!;
      const content = document.querySelector<HTMLElement>("[role=region]")!;
      assert(trigger.id === "ssr-trigger", "SSR realizes the root-owned trigger id");
      assert(content.id === "ssr-content", "SSR realizes the root-owned content id");
      assert(trigger.getAttribute("aria-controls") === content.id, "SSR trigger controls content");
      assert(content.getAttribute("aria-labelledby") === trigger.id, "SSR content names trigger");
    });

    it("omits unresolved part-owned ID references during SSR", () => {
      const html = renderToString(
        <Wrap>
          <DisclosureWrappedPartIdProbe />
        </Wrap>,
      );
      const document = new JSDOM(html).window.document;
      const trigger = document.querySelector("button")!;
      const content = document.querySelector<HTMLElement>("[role=region]")!;
      assert(trigger.id === "wrapped-trigger", "SSR preserves the part-owned trigger id");
      assert(content.id === "wrapped-content", "SSR preserves the part-owned content id");
      assert(trigger.getAttribute("aria-controls") === null, "SSR emits no dangling control id");
      assert(content.getAttribute("aria-labelledby") === null, "SSR emits no dangling label id");
    });

    it("starts closed, toggles content + aria-expanded on trigger click", async () => {
      const { host, unmount } = render(
        <Wrap>
          <DisclosureProbe />
        </Wrap>,
      );
      try {
        const trigger = host.querySelector("button")!;
        assert(trigger, "renders a trigger button");
        assert(trigger.getAttribute("aria-expanded") === "false", "closed by default");
        assert(trigger.getAttribute("data-state") === "closed", "publishes closed state");
        const content = host.querySelector<HTMLElement>("[data-vf-content]")!;
        assert(content.hidden, "content retained but hidden while closed");
        assert(trigger.getAttribute("aria-controls") === content.id, "trigger controls content");

        click(trigger);
        assert(trigger.getAttribute("aria-expanded") === "true", "expanded after click");
        assert(trigger.getAttribute("data-state") === "open", "publishes open state");
        assert(!content.hidden, "content revealed while open");

        click(trigger);
        assert(trigger.getAttribute("aria-expanded") === "false", "collapsed after second click");
        assert(content.hidden, "content hidden after collapse");
      } finally {
        await unmount();
      }
    });

    it("honours disabled state and a consumer-cancelled trigger event", async () => {
      // Disabled ALONE, with no consumer preventDefault to lean on - otherwise
      // the cancelled event would keep the surface closed even for an engine
      // that ignores `disabled` entirely.
      const { host, unmount } = render(
        <Wrap>
          <DisclosureProbe disabled />
        </Wrap>,
      );
      try {
        const trigger = host.querySelector("button")!;
        const content = host.querySelector<HTMLElement>("[data-vf-content]")!;
        assert(
          trigger.hasAttribute("disabled"),
          "a disabled plain-button trigger carries the native disabled attribute",
        );
        click(trigger);
        assert(
          trigger.getAttribute("aria-expanded") === "false",
          "the disabled guard blocks the toggle for a plain button trigger",
        );
        assert(content.hidden, "disabled trigger leaves the content hidden");
      } finally {
        await unmount();
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
        await second.unmount();
      }
    });

    it("prevents disabled asChild link navigation", async () => {
      let disabledWrapperClickCount = 0;
      let disabledChildClickCount = 0;
      let disabledWrapperAuxClickCount = 0;
      let disabledChildAuxClickCount = 0;
      const { host, unmount } = render(
        <Wrap>
          <DisclosureAsChildProbe
            onClick={() => disabledWrapperClickCount += 1}
            onChildClick={() => disabledChildClickCount += 1}
            onAuxClick={() => disabledWrapperAuxClickCount += 1}
            onChildAuxClick={() => disabledChildAuxClickCount += 1}
          />
        </Wrap>,
      );
      try {
        const link = host.querySelector("a")!;
        const event = click(link);
        const auxiliaryEvent = auxClick(link);
        assert(event.defaultPrevented, "disabled composed link prevents its default action");
        assert(
          auxiliaryEvent.defaultPrevented,
          "disabled composed link prevents auxiliary default action",
        );
        assert(link.getAttribute("href") === null, "disabled composed link removes navigation");
        assert(link.getAttribute("aria-expanded") === "false", "disabled link stays closed");
        assert(
          disabledWrapperClickCount === 0,
          "disabled composed trigger skips its wrapper click handler",
        );
        assert(
          disabledChildClickCount === 0,
          "disabled composed trigger skips its child click handler",
        );
        assert(
          disabledWrapperAuxClickCount === 0,
          "disabled composed trigger skips its wrapper auxiliary handler",
        );
        assert(
          disabledChildAuxClickCount === 0,
          "disabled composed trigger skips its child auxiliary handler",
        );
      } finally {
        await unmount();
      }
    });

    it("keeps realized trigger and content ids wired in both directions", async () => {
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
        await unmount();
      }
    });

    it("preserves ids declared directly on public Collapsible parts", async () => {
      const { host, unmount } = render(
        <Wrap>
          <DisclosurePartIdProbe />
        </Wrap>,
      );
      try {
        const trigger = host.querySelector("button")!;
        const content = host.querySelector<HTMLElement>("[role=region]")!;
        assert(trigger.id === "part-trigger", "keeps the declared trigger id");
        assert(content.id === "part-content", "keeps the declared content id");
        assert(
          trigger.getAttribute("aria-controls") === content.id,
          "controls declared content id",
        );
        assert(
          content.getAttribute("aria-labelledby") === trigger.id,
          "declared content is named by declared trigger",
        );
      } finally {
        await unmount();
      }
    });

    it("preserves an id declared on a composed trigger child", async () => {
      const { host, unmount } = render(
        <Wrap>
          <DisclosureComposedIdProbe />
        </Wrap>,
      );
      try {
        const trigger = host.querySelector("a")!;
        const content = host.querySelector<HTMLElement>("[role=region]")!;
        assert(trigger.id === "composed-trigger", "keeps the composed child id");
        assert(
          content.getAttribute("aria-labelledby") === trigger.id,
          "content is named by the composed trigger",
        );
      } finally {
        await unmount();
      }
    });

    it("preserves ids declared by opaque public-part wrappers", async () => {
      const { host, unmount } = render(
        <Wrap>
          <DisclosureWrappedPartIdProbe />
        </Wrap>,
      );
      try {
        const trigger = host.querySelector("button")!;
        const content = host.querySelector<HTMLElement>("[role=region]")!;
        assert(trigger.id === "wrapped-trigger", "keeps the wrapped trigger id");
        assert(content.id === "wrapped-content", "keeps the wrapped content id");
        assert(
          trigger.getAttribute("aria-controls") === content.id,
          "wrapped trigger controls the realized content id",
        );
        assert(
          content.getAttribute("aria-labelledby") === trigger.id,
          "wrapped content is named by the realized trigger id",
        );
      } finally {
        await unmount();
      }
    });

    it("preserves a composed child id declared by an opaque trigger wrapper", async () => {
      const { host, unmount } = render(
        <Wrap>
          <DisclosureWrappedComposedIdProbe />
        </Wrap>,
      );
      try {
        const trigger = host.querySelector("a")!;
        assert(trigger.id === "wrapped-composed-trigger", "keeps the wrapped child id");
      } finally {
        await unmount();
      }
    });

    it("supports several distinct triggers for one collapsible region", async () => {
      const { host, unmount } = render(
        <Wrap>
          <DisclosureMultipleTriggerProbe />
        </Wrap>,
      );
      try {
        const triggers = [...host.querySelectorAll("button")];
        const content = host.querySelector<HTMLElement>("[role=region]")!;
        assert(triggers.length === 2, "renders both disclosure triggers");
        assert(triggers[0]!.id === "first-trigger", "keeps the first trigger id");
        assert(triggers[1]!.id === "second-trigger", "keeps the second trigger id");
        assert(
          triggers.every((trigger) => trigger.getAttribute("aria-controls") === content.id),
          "every trigger controls the same region",
        );
        assert(
          content.getAttribute("aria-labelledby") === "first-trigger second-trigger",
          "the region is named by every trigger in DOM order",
        );
      } finally {
        await unmount();
      }
    });

    it("generates unique ids for several id-less triggers", async () => {
      const { host, unmount } = render(
        <Wrap>
          <DisclosureGeneratedMultipleTriggerProbe />
        </Wrap>,
      );
      try {
        const triggers = [...host.querySelectorAll("button")];
        const content = host.querySelector<HTMLElement>("[role=region]")!;
        assert(triggers.length === 2, "renders both id-less triggers");
        assert(Boolean(triggers[0]!.id), "generates the first trigger id");
        assert(Boolean(triggers[1]!.id), "generates the second trigger id");
        assert(triggers[0]!.id !== triggers[1]!.id, "generated trigger ids stay unique");
        assert(
          content.getAttribute("aria-labelledby") ===
            `${triggers[0]!.id} ${triggers[1]!.id}`,
          "the region references both generated trigger ids",
        );
      } finally {
        await unmount();
      }
    });

    it("preserves an Accordion asChild trigger id and its region relationship", async () => {
      const { host, unmount } = render(
        <Wrap>
          <Accordion>
            <AccordionItem value="shipping">
              <AccordionTrigger asChild>
                <a id="shipping-link" href="#shipping">Shipping</a>
              </AccordionTrigger>
              <AccordionContent>Body</AccordionContent>
            </AccordionItem>
          </Accordion>
        </Wrap>,
      );
      try {
        const trigger = host.querySelector<HTMLAnchorElement>("a")!;
        const content = host.querySelector<HTMLElement>("[role=region]")!;
        assert(trigger.id === "shipping-link", "preserves the composed child id");
        assert(
          trigger.getAttribute("aria-controls") === content.id,
          "the composed child controls the item region",
        );
        assert(
          content.getAttribute("aria-labelledby") === trigger.id,
          "the item region references the composed child id",
        );
      } finally {
        await unmount();
      }
    });

    it("keeps an item-owned Accordion asChild id wired during SSR", () => {
      const html = renderToString(
        <Wrap>
          <Accordion>
            <AccordionItem value="shipping" triggerId="shipping-link">
              <AccordionTrigger asChild>
                <a id="shipping-link" href="#shipping">Shipping</a>
              </AccordionTrigger>
              <AccordionContent>Body</AccordionContent>
            </AccordionItem>
          </Accordion>
        </Wrap>,
      );
      const document = new JSDOM(html).window.document;
      const trigger = document.querySelector<HTMLAnchorElement>("a")!;
      const content = document.querySelector<HTMLElement>("[role=region]")!;
      assert(trigger.id === "shipping-link", "SSR preserves the composed child id");
      assert(trigger.getAttribute("aria-controls") === content.id, "SSR trigger controls content");
      assert(content.getAttribute("aria-labelledby") === trigger.id, "SSR content names trigger");
    });
  });
}

function DisclosureProbe(
  { disabled, preventToggle = false }: { disabled?: boolean; preventToggle?: boolean },
): React.ReactElement {
  return (
    <Collapsible disabled={disabled}>
      <CollapsibleTrigger
        onClick={preventToggle ? (event) => event.preventDefault() : undefined}
      >
        Toggle
      </CollapsibleTrigger>
      <CollapsibleContent data-vf-content>
        <span data-vf-body>Body</span>
      </CollapsibleContent>
    </Collapsible>
  );
}

function DisclosureAsChildProbe(
  {
    onClick,
    onChildClick,
    onAuxClick,
    onChildAuxClick,
  }: {
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    onChildClick?: React.MouseEventHandler<HTMLAnchorElement>;
    onAuxClick?: React.MouseEventHandler<HTMLButtonElement>;
    onChildAuxClick?: React.MouseEventHandler<HTMLAnchorElement>;
  },
): React.ReactElement {
  return (
    <Collapsible disabled>
      <CollapsibleTrigger asChild onClick={onClick} onAuxClick={onAuxClick}>
        <a
          href="#navigated"
          onClickCapture={onChildClick}
          onClick={onChildClick}
          onAuxClickCapture={onChildAuxClick}
          onAuxClick={onChildAuxClick}
        >
          Toggle
        </a>
      </CollapsibleTrigger>
      <CollapsibleContent>Body</CollapsibleContent>
    </Collapsible>
  );
}

function DisclosureCustomIdProbe(): React.ReactElement {
  return (
    <Collapsible triggerId="custom-trigger" contentId="custom-content">
      <CollapsibleTrigger id="custom-trigger">Toggle</CollapsibleTrigger>
      <CollapsibleContent id="custom-content" role="region">Body</CollapsibleContent>
    </Collapsible>
  );
}

function DisclosurePartIdProbe(): React.ReactElement {
  return (
    <Collapsible>
      <CollapsibleTrigger id="part-trigger">Toggle</CollapsibleTrigger>
      <CollapsibleContent id="part-content" role="region">Body</CollapsibleContent>
    </Collapsible>
  );
}

function DisclosureComposedIdProbe(): React.ReactElement {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <a id="composed-trigger" href="#details">Toggle</a>
      </CollapsibleTrigger>
      <CollapsibleContent role="region">Body</CollapsibleContent>
    </Collapsible>
  );
}

function WrappedCollapsibleTrigger(): React.ReactElement {
  return <CollapsibleTrigger id="wrapped-trigger">Toggle</CollapsibleTrigger>;
}

function WrappedCollapsibleContent(): React.ReactElement {
  return <CollapsibleContent id="wrapped-content" role="region">Body</CollapsibleContent>;
}

function DisclosureWrappedPartIdProbe(): React.ReactElement {
  return (
    <Collapsible>
      <WrappedCollapsibleTrigger />
      <WrappedCollapsibleContent />
    </Collapsible>
  );
}

function WrappedComposedCollapsibleTrigger(): React.ReactElement {
  return (
    <CollapsibleTrigger asChild>
      <a id="wrapped-composed-trigger" href="#wrapped-details">Toggle</a>
    </CollapsibleTrigger>
  );
}

function DisclosureWrappedComposedIdProbe(): React.ReactElement {
  return (
    <Collapsible>
      <WrappedComposedCollapsibleTrigger />
      <CollapsibleContent>Body</CollapsibleContent>
    </Collapsible>
  );
}

function DisclosureWrappedTrigger(): React.ReactElement {
  return <CollapsibleTrigger>Toggle</CollapsibleTrigger>;
}

function DisclosureWrappedContent(): React.ReactElement {
  return <CollapsibleContent role="region">Body</CollapsibleContent>;
}

function DisclosureMultipleTriggerProbe(): React.ReactElement {
  return (
    <Collapsible>
      <CollapsibleTrigger id="first-trigger">First toggle</CollapsibleTrigger>
      <CollapsibleTrigger id="second-trigger">Second toggle</CollapsibleTrigger>
      <CollapsibleContent id="multiple-trigger-content" role="region">
        Body
      </CollapsibleContent>
    </Collapsible>
  );
}

function DisclosureGeneratedMultipleTriggerProbe(): React.ReactElement {
  return (
    <Collapsible>
      <CollapsibleTrigger>First toggle</CollapsibleTrigger>
      <CollapsibleTrigger>Second toggle</CollapsibleTrigger>
      <CollapsibleContent role="region">Body</CollapsibleContent>
    </Collapsible>
  );
}

// (1) builtin: no provider.
const Identity: React.FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>;
runDisclosureConformance("builtin (default)", Identity);

// (2) an INDEPENDENT contract-only engine: proves the seam. Different impl than
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
  Trigger: ({
    asChild,
    onClick,
    children,
    ref,
    disabled,
    id,
    "aria-controls": ariaControls,
    ...props
  }) => {
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
        data-state={ctx?.open ? "open" : "closed"}
        aria-controls={ariaControls === null ? undefined : ariaControls ?? ctx?.contentId}
        disabled={isDisabled}
        aria-disabled={asChild && isDisabled ? true : undefined}
        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
          if (isDisabled) {
            e.preventDefault();
            return;
          }
          onClick?.(e);
          if (!e.defaultPrevented) ctx?.toggle();
        }}
        {...props}
      >
        {children}
      </Comp>
    );
  },
  Content: ({ children, ref, id, hidden, "aria-labelledby": ariaLabelledBy, ...props }) => {
    const ctx = React.useContext(AltCtx);
    const realizedId = id ?? ctx?.contentId;
    return (
      <div
        {...props}
        ref={ref}
        id={realizedId}
        aria-labelledby={ariaLabelledBy === null ? undefined : ariaLabelledBy ?? ctx?.triggerId}
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
