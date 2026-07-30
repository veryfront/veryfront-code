import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "./dropdown-menu.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./popover.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select.tsx";
import { Floating } from "./floating.tsx";

function installDom(dom: JSDOM): () => void {
  const window = dom.window;
  const replacements: Record<string, unknown> = {
    window,
    document: window.document,
    navigator: window.navigator,
    self: window,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    MouseEvent: window.MouseEvent,
    KeyboardEvent: window.KeyboardEvent,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();

  for (const [key, value] of Object.entries(replacements)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }

  return () => {
    for (const key of Object.keys(replacements)) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    dom.window.close();
  };
}

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
      const restore = installDom(dom);
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

        root.unmount();
        root = undefined;
        await waitFor(() =>
          document.querySelector(`[data-floating-surface="${surfaceId}"]`) === null
        );
      } finally {
        root?.unmount();
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
    const restore = installDom(dom);
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
      root?.unmount();
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
    const restore = installDom(globalDom);
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
      flushSync(() => root.unmount());
      restore();
      ownerDom.window.close();
    }
  });
});
