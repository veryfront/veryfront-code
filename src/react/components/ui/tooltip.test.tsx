import type { RefCallback } from "react";
import { flushSync } from "react-dom";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type ComponentDomOptions, installComponentDom } from "#veryfront/testing/dom-globals.ts";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip.tsx";

const DOM_OPTIONS: ComponentDomOptions = {
  windowGlobals: [
    "self",
    "HTMLButtonElement",
    "KeyboardEvent",
    "FocusEvent",
    "MutationObserver",
  ],
};

function createDom(): JSDOM {
  return new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    {
      pretendToBeVisual: true,
      url: "https://example.com/",
    },
  );
}

async function waitFor(
  condition: () => boolean,
  message = "Timed out waiting for tooltip state",
  timeoutMs = 3000,
): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function hover(window: JSDOM["window"], element: Element): void {
  element.dispatchEvent(
    new window.MouseEvent("mouseover", {
      bubbles: true,
      cancelable: true,
      relatedTarget: window.document.body,
    }),
  );
}

function unhover(window: JSDOM["window"], element: Element): void {
  element.dispatchEvent(
    new window.MouseEvent("mouseout", {
      bubbles: true,
      cancelable: true,
      relatedTarget: window.document.body,
    }),
  );
}

function escape(window: JSDOM["window"], target: EventTarget): KeyboardEvent {
  const event = new window.KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "Escape",
  });
  target.dispatchEvent(event);
  return event;
}

/**
 * Wait for the Escape dismissal layer to be registered.
 *
 * `tooltip.tsx` picks its effect hook at module load, and `document` only
 * exists once a test installs a JSDOM, so under Deno every one of its "layout"
 * effects is really a passive effect. The tooltip node therefore lands one
 * commit before `registerDismissableLayer` runs. A keydown is one-shot -- an
 * Escape dispatched in that window is dropped for good -- so yield the
 * macrotask React's scheduler queued at commit time before pressing it.
 *
 * Browsers define `document` at module load, bind `useLayoutEffect`, and
 * register within the commit, so this gap is a test-environment artifact.
 */
function escapeLayerRegistered(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Tooltip", () => {
  it("gives the default trigger a keyboard path and honors an explicit tab index", async () => {
    const dom = createDom();
    const restore = installComponentDom(dom, DOM_OPTIONS);
    const root = createRoot(document.getElementById("root")!);

    try {
      flushSync(() => {
        root.render(
          <>
            <Tooltip>
              <TooltipTrigger data-default-trigger="">Help</TooltipTrigger>
              <TooltipContent>Help details</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger data-explicit-trigger="" tabIndex={-1}>
                Programmatic help
              </TooltipTrigger>
              <TooltipContent>Programmatic details</TooltipContent>
            </Tooltip>
          </>,
        );
      });
      const defaultTrigger = document.querySelector<HTMLElement>(
        "[data-default-trigger]",
      );
      const explicitTrigger = document.querySelector<HTMLElement>(
        "[data-explicit-trigger]",
      );
      assert(defaultTrigger);
      assert(explicitTrigger);
      assertEquals(defaultTrigger.tabIndex, 0);
      assertEquals(explicitTrigger.tabIndex, -1);

      flushSync(() => defaultTrigger.focus());
      await waitFor(() => document.querySelector('[role="tooltip"]') !== null);
      const tooltipId = document.querySelector<HTMLElement>('[role="tooltip"]')?.id;
      assert(tooltipId);
      assertEquals(defaultTrigger.getAttribute("aria-describedby"), tooltipId);
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("hydrates stable IDs and composes caller descriptions while open", async () => {
    let triggerFocusCalls = 0;
    let childFocusCalls = 0;
    const tree = (
      <div data-vf-ui="" data-tooltip-scope="">
        <p id="caller-description">Caller description</p>
        <p id="child-description">Child description</p>
        <Tooltip>
          <TooltipTrigger
            asChild
            aria-describedby="caller-description"
            onFocus={() => {
              triggerFocusCalls += 1;
            }}
          >
            <button
              type="button"
              aria-describedby="child-description"
              onFocus={() => {
                childFocusCalls += 1;
              }}
            >
              Inspect
            </button>
          </TooltipTrigger>
          <TooltipContent id="inspect-tooltip">Inspect details</TooltipContent>
        </Tooltip>
      </div>
    );
    const serverMarkup = renderToString(tree);
    const serverDom = new JSDOM(serverMarkup);
    const serverTrigger = serverDom.window.document.querySelector("button");
    assert(serverTrigger);
    const serverTriggerId = serverTrigger.id;
    assert(serverTriggerId.startsWith("vf-tooltip-trigger-"));
    assertEquals(
      serverTrigger.getAttribute("aria-describedby"),
      "child-description caller-description",
    );
    assert(serverDom.window.document.querySelector('[role="tooltip"]') === null);
    serverDom.window.close();

    const dom = new JSDOM(
      `<!doctype html><html><body><div id="root">${serverMarkup}</div></body></html>`,
      {
        pretendToBeVisual: true,
        url: "https://example.com/",
      },
    );
    const restore = installComponentDom(dom, DOM_OPTIONS);
    let root: ReturnType<typeof hydrateRoot> | undefined;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement);
      const recoverableErrors: unknown[] = [];
      root = hydrateRoot(rootElement, tree, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });
      await waitFor(() => document.querySelector("button")?.id === serverTriggerId);

      const trigger = document.querySelector<HTMLButtonElement>("button");
      assert(trigger);
      flushSync(() => trigger.focus());
      await waitFor(() => document.getElementById("inspect-tooltip") !== null);

      const tooltip = document.getElementById("inspect-tooltip");
      const scope = document.querySelector("[data-tooltip-scope]");
      assert(tooltip);
      assert(scope);
      assertEquals(tooltip.getAttribute("role"), "tooltip");
      assertEquals(tooltip.parentElement, scope);
      assertEquals(
        trigger.getAttribute("aria-describedby"),
        "child-description caller-description inspect-tooltip",
      );
      assertEquals(triggerFocusCalls, 1);
      assertEquals(childFocusCalls, 1);
      assertEquals(recoverableErrors, []);
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("honors provider delay and keeps the tooltip open while hover or focus remains", async () => {
    const dom = createDom();
    const restore = installComponentDom(dom, DOM_OPTIONS);
    const root = createRoot(document.getElementById("root")!);

    try {
      flushSync(() => {
        root.render(
          <TooltipProvider delayDuration={30}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button">Delayed</button>
              </TooltipTrigger>
              <TooltipContent>Delayed tooltip</TooltipContent>
            </Tooltip>
          </TooltipProvider>,
        );
      });
      const trigger = document.querySelector<HTMLButtonElement>("button");
      assert(trigger);

      flushSync(() => hover(dom.window, trigger));
      assertEquals(document.querySelector('[role="tooltip"]'), null);
      await waitFor(() => document.querySelector('[role="tooltip"]') !== null);

      flushSync(() => trigger.focus());
      flushSync(() => unhover(dom.window, trigger));
      assert(document.querySelector('[role="tooltip"]'));

      flushSync(() => trigger.blur());
      await waitFor(() => document.querySelector('[role="tooltip"]') === null);
      assertEquals(trigger.hasAttribute("aria-describedby"), false);
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("dismisses on Escape and waits for a fresh interaction before reopening", async () => {
    const dom = createDom();
    const restore = installComponentDom(dom, DOM_OPTIONS);
    const root = createRoot(document.getElementById("root")!);

    try {
      flushSync(() => {
        root.render(
          <Tooltip>
            <TooltipTrigger
              asChild
              onKeyDown={(event) => {
                if (event.key === "Escape") event.preventDefault();
              }}
            >
              <button type="button">Dismiss</button>
            </TooltipTrigger>
            <TooltipContent>Dismiss tooltip</TooltipContent>
          </Tooltip>,
        );
      });
      const trigger = document.querySelector<HTMLButtonElement>("button");
      assert(trigger);
      flushSync(() => hover(dom.window, trigger));
      await waitFor(() => document.querySelector('[role="tooltip"]') !== null);
      await escapeLayerRegistered();

      const cancelledEscape = escape(dom.window, trigger);
      assertEquals(cancelledEscape.defaultPrevented, true);
      assert(document.querySelector('[role="tooltip"]'));

      flushSync(() => escape(dom.window, document));
      await waitFor(() => document.querySelector('[role="tooltip"]') === null);
      assertEquals(trigger.hasAttribute("aria-describedby"), false);

      flushSync(() => trigger.focus());
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert(document.querySelector('[role="tooltip"]') === null);

      flushSync(() => {
        unhover(dom.window, trigger);
        trigger.blur();
        hover(dom.window, trigger);
      });
      await waitFor(() => document.querySelector('[role="tooltip"]') !== null);
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("runs child and trigger handlers before honoring cancellation", async () => {
    const dom = createDom();
    const restore = installComponentDom(dom, DOM_OPTIONS);
    const root = createRoot(document.getElementById("root")!);
    const calls: string[] = [];

    try {
      flushSync(() => {
        root.render(
          <Tooltip>
            <TooltipTrigger
              asChild
              onMouseEnter={() => {
                calls.push("trigger");
              }}
            >
              <button
                type="button"
                onMouseEnter={(event) => {
                  calls.push("child");
                  event.preventDefault();
                }}
              >
                Cancel
              </button>
            </TooltipTrigger>
            <TooltipContent>Cancelled tooltip</TooltipContent>
          </Tooltip>,
        );
      });
      const trigger = document.querySelector<HTMLButtonElement>("button");
      assert(trigger);
      flushSync(() => hover(dom.window, trigger));
      await new Promise((resolve) => setTimeout(resolve, 20));

      assertEquals(calls, ["child", "trigger"]);
      assert(document.querySelector('[role="tooltip"]') === null);
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("preserves internal handlers when an asChild handler is explicitly undefined", async () => {
    const dom = createDom();
    const restore = installComponentDom(dom, DOM_OPTIONS);
    const root = createRoot(document.getElementById("root")!);

    try {
      flushSync(() => {
        root.render(
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onMouseEnter={undefined}
                onMouseLeave={undefined}
              >
                Optional handlers
              </button>
            </TooltipTrigger>
            <TooltipContent>Optional-handler tooltip</TooltipContent>
          </Tooltip>,
        );
      });
      const trigger = document.querySelector<HTMLButtonElement>("button");
      assert(trigger);

      flushSync(() => hover(dom.window, trigger));
      await waitFor(() => document.querySelector('[role="tooltip"]') !== null);
      flushSync(() => unhover(dom.window, trigger));
      await waitFor(() => document.querySelector('[role="tooltip"]') === null);
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("closes when disabled and cancels delayed work on disable or unmount", async () => {
    const dom = createDom();
    const restore = installComponentDom(dom, DOM_OPTIONS);
    const root = createRoot(document.getElementById("root")!);
    let rootMounted = true;

    const renderTooltip = (disabled: boolean, delayDuration: number) => (
      <TooltipProvider delayDuration={delayDuration}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" disabled={disabled}>Toggle</button>
          </TooltipTrigger>
          <TooltipContent>Toggle tooltip</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    try {
      flushSync(() => root.render(renderTooltip(false, 30)));
      const pendingTrigger = document.querySelector<HTMLButtonElement>("button");
      assert(pendingTrigger);
      flushSync(() => hover(dom.window, pendingTrigger));
      flushSync(() => root.render(renderTooltip(true, 30)));
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert(document.querySelector('[role="tooltip"]') === null);

      flushSync(() => root.render(renderTooltip(false, 0)));
      const enabledTrigger = document.querySelector<HTMLButtonElement>("button");
      assert(enabledTrigger);
      flushSync(() => hover(dom.window, enabledTrigger));
      await waitFor(() => document.querySelector('[role="tooltip"]') !== null);
      flushSync(() => root.render(renderTooltip(true, 0)));
      await waitFor(() => document.querySelector('[role="tooltip"]') === null);

      flushSync(() => root.render(renderTooltip(false, 30)));
      const unmountedTrigger = document.querySelector<HTMLButtonElement>("button");
      assert(unmountedTrigger);
      flushSync(() => hover(dom.window, unmountedTrigger));
      await unmountReactRoot(root);
      rootMounted = false;
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert(document.querySelector('[role="tooltip"]') === null);
    } finally {
      if (rootMounted) await unmountReactRoot(root);
      restore();
    }
  });

  it("uses the trigger document for portals, listeners, and viewport collisions", async () => {
    const globalDom = createDom();
    const targetDom = new JSDOM(
      '<!doctype html><html><body><div id="scope" data-vf-ui=""><div id="target"></div></div></body></html>',
      {
        pretendToBeVisual: true,
        url: "https://frame.example.com/",
      },
    );
    const restore = installComponentDom(globalDom, DOM_OPTIONS);
    const targetDocument = targetDom.window.document;
    const target = targetDocument.getElementById("target");
    assert(target);
    const root = createRoot(target);

    try {
      Object.defineProperty(targetDom.window, "innerWidth", {
        configurable: true,
        value: 200,
      });
      Object.defineProperty(targetDom.window, "innerHeight", {
        configurable: true,
        value: 120,
      });
      flushSync(() => {
        root.render(
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button">Frame trigger</button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              Frame tooltip
            </TooltipContent>
          </Tooltip>,
        );
      });
      const trigger = targetDocument.querySelector<HTMLButtonElement>("button");
      assert(trigger);
      trigger.getBoundingClientRect = () =>
        ({
          bottom: 22,
          height: 20,
          left: 180,
          right: 200,
          top: 2,
          width: 20,
          x: 180,
          y: 2,
          toJSON: () => ({}),
        }) as DOMRect;

      flushSync(() => hover(targetDom.window, trigger));
      await waitFor(() => targetDocument.querySelector('[role="tooltip"]') !== null);
      const tooltip = targetDocument.querySelector<HTMLElement>('[role="tooltip"]');
      assert(tooltip);
      Object.defineProperties(tooltip, {
        offsetHeight: { configurable: true, value: 30 },
        offsetWidth: { configurable: true, value: 80 },
      });
      targetDom.window.dispatchEvent(new targetDom.window.Event("resize"));
      await waitFor(() => tooltip.style.left === "112px" && tooltip.style.top === "28px");

      assertEquals(tooltip.parentElement, targetDocument.getElementById("scope"));
      assert(globalDom.window.document.querySelector('[role="tooltip"]') === null);
      const arrow = tooltip.lastElementChild as HTMLElement | null;
      assert(arrow);
      assert(arrow.className.includes("bottom-full"));
      assertEquals(arrow.style.left, "72px");
      assertEquals(tooltip.style.maxWidth, "min(20rem, calc(100vw - 1rem))");
      assertEquals(tooltip.style.overflowWrap, "anywhere");
      assertEquals(tooltip.style.whiteSpace, "normal");

      Object.defineProperty(tooltip, "offsetWidth", {
        configurable: true,
        value: 184,
      });
      targetDom.window.dispatchEvent(new targetDom.window.Event("resize"));
      await waitFor(() => tooltip.style.left === "8px");
      assertEquals(Number.parseFloat(tooltip.style.left) + tooltip.offsetWidth, 192);
      assertEquals(arrow.style.left, "176px");

      flushSync(() => escape(globalDom.window, globalDom.window.document));
      assert(targetDocument.querySelector('[role="tooltip"]'));
      flushSync(() => escape(targetDom.window, targetDocument));
      await waitFor(() => targetDocument.querySelector('[role="tooltip"]') === null);
    } finally {
      await unmountReactRoot(root);
      targetDom.window.close();
      restore();
    }
  });

  it("preserves caller style overrides on tooltip content", async () => {
    const dom = createDom();
    const restore = installComponentDom(dom, DOM_OPTIONS);
    const root = createRoot(document.getElementById("root")!);

    try {
      flushSync(() => {
        root.render(
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button">Styled trigger</button>
            </TooltipTrigger>
            <TooltipContent
              style={{
                maxWidth: "12rem",
                overflowWrap: "normal",
                whiteSpace: "pre-wrap",
              }}
            >
              Styled tooltip
            </TooltipContent>
          </Tooltip>,
        );
      });
      const trigger = document.querySelector<HTMLButtonElement>("button");
      assert(trigger);
      flushSync(() => hover(dom.window, trigger));
      await waitFor(() => document.querySelector('[role="tooltip"]') !== null);

      const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]');
      assert(tooltip);
      assertEquals(tooltip.style.maxWidth, "12rem");
      assertEquals(tooltip.style.overflowWrap, "normal");
      assertEquals(tooltip.style.whiteSpace, "pre-wrap");
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("clamps invalid negative provider delays to immediate opening", async () => {
    const dom = createDom();
    const restore = installComponentDom(dom, DOM_OPTIONS);
    const root = createRoot(document.getElementById("root")!);

    try {
      flushSync(() => {
        root.render(
          <TooltipProvider delayDuration={-100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button">Bounded delay</button>
              </TooltipTrigger>
              <TooltipContent>Bounded tooltip</TooltipContent>
            </Tooltip>
          </TooltipProvider>,
        );
      });
      const trigger = document.querySelector<HTMLButtonElement>("button");
      assert(trigger);
      flushSync(() => hover(dom.window, trigger));
      await waitFor(() => document.querySelector('[role="tooltip"]') !== null);
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("caps excessive provider delays and cancels the owner-window timer", async () => {
    const dom = createDom();
    const restore = installComponentDom(dom, DOM_OPTIONS);
    const root = createRoot(document.getElementById("root")!);
    const setTimeoutDescriptor = Object.getOwnPropertyDescriptor(
      dom.window,
      "setTimeout",
    );
    const clearTimeoutDescriptor = Object.getOwnPropertyDescriptor(
      dom.window,
      "clearTimeout",
    );
    let scheduledDelay: number | undefined;
    const clearedHandles: number[] = [];

    try {
      flushSync(() => {
        root.render(
          <TooltipProvider delayDuration={Number.MAX_SAFE_INTEGER}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button">Maximum delay</button>
              </TooltipTrigger>
              <TooltipContent>Maximum-delay tooltip</TooltipContent>
            </Tooltip>
          </TooltipProvider>,
        );
      });
      Object.defineProperty(dom.window, "setTimeout", {
        configurable: true,
        value: (_handler: () => void, delay: number) => {
          scheduledDelay = delay;
          return 47;
        },
      });
      Object.defineProperty(dom.window, "clearTimeout", {
        configurable: true,
        value: (handle: number) => {
          clearedHandles.push(handle);
        },
      });
      const trigger = document.querySelector<HTMLButtonElement>("button");
      assert(trigger);

      flushSync(() => hover(dom.window, trigger));
      assertEquals(scheduledDelay, 5_000);
      assert(document.querySelector('[role="tooltip"]') === null);
      flushSync(() => unhover(dom.window, trigger));
      assertEquals(clearedHandles, [47]);
    } finally {
      await unmountReactRoot(root);
      if (setTimeoutDescriptor) {
        Object.defineProperty(dom.window, "setTimeout", setTimeoutDescriptor);
      } else delete (dom.window as unknown as Record<string, unknown>).setTimeout;
      if (clearTimeoutDescriptor) {
        Object.defineProperty(dom.window, "clearTimeout", clearTimeoutDescriptor);
      } else delete (dom.window as unknown as Record<string, unknown>).clearTimeout;
      restore();
    }
  });

  it("preserves an asChild callback ref across state changes and runs its cleanup", async () => {
    const dom = createDom();
    const restore = installComponentDom(dom, DOM_OPTIONS);
    const root = createRoot(document.getElementById("root")!);
    let attachedElement: HTMLButtonElement | null = null;
    let cleanupCalls = 0;
    let nullCalls = 0;
    const childRef: RefCallback<HTMLButtonElement> = (element) => {
      if (!element) {
        nullCalls += 1;
        return;
      }
      attachedElement = element;
      return () => {
        attachedElement = null;
        cleanupCalls += 1;
      };
    };

    try {
      flushSync(() => {
        root.render(
          <Tooltip>
            <TooltipTrigger asChild>
              <button ref={childRef} type="button">Referenced trigger</button>
            </TooltipTrigger>
            <TooltipContent>Referenced tooltip</TooltipContent>
          </Tooltip>,
        );
      });
      const trigger = document.querySelector<HTMLButtonElement>("button");
      assert(trigger);
      assertEquals(attachedElement, trigger);

      flushSync(() => hover(dom.window, trigger));
      await waitFor(() => document.querySelector('[role="tooltip"]') !== null);
      assertEquals(cleanupCalls, 0);
      assertEquals(nullCalls, 0);
    } finally {
      await unmountReactRoot(root);
      assertEquals(attachedElement, null);
      assertEquals(cleanupCalls, 1);
      assertEquals(nullCalls, 0);
      restore();
    }
  });

  it("keeps an open tooltip stable when an inline child ref changes identity", async () => {
    const dom = createDom();
    const restore = installComponentDom(dom, DOM_OPTIONS);
    const root = createRoot(document.getElementById("root")!);
    const refCalls: string[] = [];

    const renderTooltip = (render: number) => (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            data-render={render}
            ref={(element) => {
              if (!element) {
                refCalls.push(`null:${render}`);
                return;
              }
              refCalls.push(`attach:${render}`);
              return () => {
                refCalls.push(`cleanup:${render}`);
              };
            }}
            type="button"
          >
            Inline ref
          </button>
        </TooltipTrigger>
        <TooltipContent>Inline-ref tooltip</TooltipContent>
      </Tooltip>
    );

    try {
      flushSync(() => root.render(renderTooltip(1)));
      const trigger = document.querySelector<HTMLButtonElement>("button");
      assert(trigger);
      flushSync(() => hover(dom.window, trigger));
      await waitFor(() => document.querySelector('[role="tooltip"]') !== null);

      flushSync(() => root.render(renderTooltip(2)));
      assertEquals(document.querySelector("button"), trigger);
      assert(document.querySelector('[role="tooltip"]'));
      assertEquals(refCalls, ["attach:1", "cleanup:1", "attach:2"]);
    } finally {
      await unmountReactRoot(root);
      assertEquals(refCalls, [
        "attach:1",
        "cleanup:1",
        "attach:2",
        "cleanup:2",
      ]);
      restore();
    }
  });
});
