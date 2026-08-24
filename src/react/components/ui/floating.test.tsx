import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type ComponentDomOptions, installComponentDom } from "#veryfront/testing/dom-globals.ts";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "./dropdown-menu.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./popover.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select.tsx";
import { Floating } from "./floating.tsx";

const DOM_OPTIONS: ComponentDomOptions = {
  windowGlobals: ["self", "KeyboardEvent", "innerWidth", "innerHeight"],
  windowBound: ["addEventListener", "removeEventListener"],
};

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for floating surface");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

interface SurfaceCase {
  name: string;
  render: (surfaceId: string) => React.ReactElement;
}

const surfaceCases: SurfaceCase[] = [
  {
    name: "Select",
    render: (surfaceId) => (
      <Select defaultOpen defaultValue="one">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent data-floating-surface={surfaceId}>
          <SelectItem value="one">One</SelectItem>
        </SelectContent>
      </Select>
    ),
  },
  {
    name: "Popover",
    render: (surfaceId) => (
      <Popover defaultOpen>
        <PopoverTrigger>Open popover</PopoverTrigger>
        <PopoverContent data-floating-surface={surfaceId}>Popover content</PopoverContent>
      </Popover>
    ),
  },
  {
    name: "DropdownMenu",
    render: (surfaceId) => (
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Open menu</DropdownMenuTrigger>
        <DropdownMenuContent data-floating-surface={surfaceId}>Menu content</DropdownMenuContent>
      </DropdownMenu>
    ),
  },
];

/**
 * Wait for the Escape dismissal layer to be registered.
 *
 * `Floating` registers its dismissable layer from a passive effect, so the
 * surface is committed one tick before the document listener exists. A keydown
 * is one-shot, so an Escape dispatched in that window is dropped for good and
 * the surface never closes. Yield the macrotask React's scheduler queued at
 * commit time first.
 */
function escapeLayerRegistered(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Floating SSR and hydration", () => {
  for (const surfaceCase of surfaceCases) {
    it(`keeps default-open ${surfaceCase.name} deterministic and portals after hydration`, async () => {
      const surfaceId = surfaceCase.name.toLowerCase();
      const tree = (
        <div data-vf-ui="" data-floating-scope="">
          {surfaceCase.render(surfaceId)}
        </div>
      );

      const serverMarkup = renderToString(tree);
      assertStringIncludes(serverMarkup, 'aria-expanded="true"');
      assertEquals(serverMarkup.includes(`data-floating-surface="${surfaceId}"`), false);

      const dom = new JSDOM(
        `<!doctype html><html><body><div id="root">${serverMarkup}</div></body></html>`,
        { pretendToBeVisual: true, url: "https://example.com/" },
      );
      const restore = installComponentDom(dom, DOM_OPTIONS);
      let root: ReturnType<typeof hydrateRoot> | undefined;

      try {
        const rootElement = document.getElementById("root");
        const scope = document.querySelector<HTMLElement>("[data-floating-scope]");
        assert(rootElement);
        assert(scope);
        const recoverableErrors: unknown[] = [];

        root = hydrateRoot(rootElement, tree, {
          onRecoverableError: (error) => recoverableErrors.push(error),
        });

        await waitFor(() =>
          document.querySelector(`[data-floating-surface="${surfaceId}"]`) !== null
        );
        const surface = document.querySelector<HTMLElement>(
          `[data-floating-surface="${surfaceId}"]`,
        );
        assert(surface);
        assert(
          surface.parentElement === scope,
          `${surfaceCase.name} should portal into the nearest UI scope`,
        );
        assertEquals(recoverableErrors, []);

        await unmountReactRoot(root);
        root = undefined;
        await waitFor(() =>
          document.querySelector(`[data-floating-surface="${surfaceId}"]`) === null
        );
      } finally {
        if (root) await unmountReactRoot(root);
        restore();
      }
    });
  }

  it("falls back to document.body when no UI scope exists", async () => {
    const tree = (
      <Popover defaultOpen>
        <PopoverTrigger>Open popover</PopoverTrigger>
        <PopoverContent data-floating-surface="body">
          Body portal content
        </PopoverContent>
      </Popover>
    );
    const serverMarkup = renderToString(tree);
    assertEquals(serverMarkup.includes('data-floating-surface="body"'), false);

    const dom = new JSDOM(
      `<!doctype html><html><body><div id="root">${serverMarkup}</div></body></html>`,
      { pretendToBeVisual: true, url: "https://example.com/" },
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

      await waitFor(() => document.querySelector('[data-floating-surface="body"]') !== null);
      const surface = document.querySelector<HTMLElement>(
        '[data-floating-surface="body"]',
      );
      assert(surface);
      assert(surface.parentElement === document.body);
      assertEquals(rootElement.contains(surface), false);
      assertEquals(recoverableErrors, []);
    } finally {
      if (root) await unmountReactRoot(root);
      restore();
    }
  });

  it("hydrates against the slotted trigger geometry and restores focus to its composed ref", async () => {
    const triggerRef = React.createRef<HTMLButtonElement>();
    const tree = (
      <div data-vf-ui="" data-floating-scope="">
        <Popover defaultOpen>
          <PopoverTrigger asChild>
            <button ref={triggerRef} data-hydrated-trigger="" type="button">
              Open popover
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" data-floating-surface="geometry">
            <button data-floating-focus="" type="button">Inside</button>
          </PopoverContent>
        </Popover>
      </div>
    );
    const serverMarkup = renderToString(tree);
    assertEquals(serverMarkup.includes('data-floating-surface="geometry"'), false);

    const dom = new JSDOM(
      `<!doctype html><html><body><div id="root">${serverMarkup}</div></body></html>`,
      { pretendToBeVisual: true, url: "https://example.com/" },
    );
    const restore = installComponentDom(dom, DOM_OPTIONS);
    let root: ReturnType<typeof hydrateRoot> | undefined;

    try {
      const rootElement = document.getElementById("root");
      const trigger = document.querySelector<HTMLButtonElement>("[data-hydrated-trigger]");
      assert(rootElement && trigger);
      const anchorRect: DOMRect = {
        bottom: 50,
        height: 30,
        left: 100,
        right: 140,
        top: 20,
        width: 40,
        x: 100,
        y: 20,
        toJSON: () => ({}),
      };
      Object.defineProperty(trigger, "getBoundingClientRect", {
        configurable: true,
        value: () => anchorRect,
      });
      const recoverableErrors: unknown[] = [];

      root = hydrateRoot(rootElement, tree, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });

      await waitFor(() => {
        const surface = document.querySelector<HTMLElement>(
          '[data-floating-surface="geometry"]',
        );
        return surface?.style.visibility === "visible";
      });
      const surface = document.querySelector<HTMLElement>(
        '[data-floating-surface="geometry"]',
      );
      const inside = document.querySelector<HTMLButtonElement>("[data-floating-focus]");
      assert(surface && inside);
      assertEquals(triggerRef.current, trigger);
      assertEquals(surface.style.left, "100px");
      assertEquals(surface.style.top, "58px");
      assertEquals(recoverableErrors, []);

      inside.focus();
      assertEquals(document.activeElement, inside);
      await escapeLayerRegistered();
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Escape",
        }),
      );
      await waitFor(() => document.querySelector('[data-floating-surface="geometry"]') === null);
      await waitFor(() => document.activeElement === trigger);
    } finally {
      if (root) await unmountReactRoot(root);
      restore();
    }
  });

  it("rebinds positioning and dismissal when an open trigger is replaced", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { pretendToBeVisual: true, url: "https://example.com/" },
    );
    const restore = installComponentDom(dom, DOM_OPTIONS);
    const rootElement = document.getElementById("root");
    assert(rootElement);
    const root = createRoot(rootElement);
    let replaceTrigger = (): void => {
      throw new Error("replacement callback was not installed");
    };

    function ReanchoredPopover(): React.ReactElement {
      const [replacement, setReplacement] = React.useState(false);
      replaceTrigger = () => setReplacement(true);
      const triggerRef = React.useCallback(
        (element: HTMLButtonElement | null) => {
          if (!element) return;
          const left = replacement ? 200 : 10;
          Object.defineProperty(element, "getBoundingClientRect", {
            configurable: true,
            value: () => ({
              bottom: 50,
              height: 30,
              left,
              right: left + 40,
              top: 20,
              width: 40,
              x: left,
              y: 20,
              toJSON: () => ({}),
            }),
          });
        },
        [replacement],
      );
      return (
        <div data-vf-ui="">
          <Popover defaultOpen>
            <PopoverTrigger key={replacement ? "replacement" : "initial"} ref={triggerRef}>
              {replacement ? "Replacement" : "Initial"}
            </PopoverTrigger>
            <PopoverContent align="start" data-reanchored-surface="">
              Content
            </PopoverContent>
          </Popover>
        </div>
      );
    }

    try {
      flushSync(() => root.render(<ReanchoredPopover />));
      await waitFor(() =>
        document.querySelector<HTMLElement>("[data-reanchored-surface]")?.style.left === "10px"
      );

      flushSync(replaceTrigger);
      await waitFor(() =>
        document.querySelector<HTMLElement>("[data-reanchored-surface]")?.style.left === "200px"
      );
      const replacement = [...document.querySelectorAll("button")].find((button) =>
        button.textContent === "Replacement"
      );
      assert(replacement);
      replacement.dispatchEvent(
        new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
      assert(document.querySelector("[data-reanchored-surface]"));
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("uses the anchor owner document for portals and dismissal listeners", async () => {
    const globalDom = new JSDOM(
      '<!doctype html><html><body><div id="global-root"></div></body></html>',
      { pretendToBeVisual: true, url: "https://global.example/" },
    );
    const ownerDom = new JSDOM(
      '<!doctype html><html><body><div id="owner-root"></div></body></html>',
      { pretendToBeVisual: true, url: "https://owner.example/" },
    );
    const restore = installComponentDom(globalDom, DOM_OPTIONS);
    const ownerRoot = ownerDom.window.document.getElementById("owner-root");
    assert(ownerRoot);
    const root = createRoot(ownerRoot);
    const reasons: string[] = [];

    function CrossDocumentFloating(): React.ReactElement {
      const anchorRef = React.useRef<HTMLButtonElement | null>(null);
      const [open, setOpen] = React.useState(true);
      return (
        <div data-vf-ui="" data-owner-scope="">
          <button ref={anchorRef} type="button">Owner trigger</button>
          <Floating
            anchorRef={anchorRef}
            open={open}
            onDismiss={(reason) => {
              reasons.push(reason);
              setOpen(false);
            }}
            data-owner-surface=""
          >
            Owner surface
          </Floating>
        </div>
      );
    }

    try {
      flushSync(() => root.render(<CrossDocumentFloating />));
      await waitFor(() => ownerDom.window.document.querySelector("[data-owner-surface]") !== null);
      const surface = ownerDom.window.document.querySelector<HTMLElement>(
        "[data-owner-surface]",
      );
      const scope = ownerDom.window.document.querySelector<HTMLElement>(
        "[data-owner-scope]",
      );
      assert(surface && scope);
      assertEquals(surface.parentElement, scope);
      assertEquals(globalDom.window.document.querySelector("[data-owner-surface]"), null);

      await escapeLayerRegistered();
      ownerDom.window.document.dispatchEvent(
        new ownerDom.window.KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Escape",
        }),
      );
      await waitFor(() => ownerDom.window.document.querySelector("[data-owner-surface]") === null);
      assertEquals(reasons, ["escape"]);
    } finally {
      await unmountReactRoot(root);
      restore();
      ownerDom.window.close();
    }
  });
});
