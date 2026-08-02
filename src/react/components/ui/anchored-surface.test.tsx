import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import { Command, CommandInput, CommandItem, CommandList } from "./command.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./popover.tsx";

function installDom(dom: JSDOM): () => void {
  const keys = [
    "window",
    "document",
    "navigator",
    "Node",
    "Element",
    "HTMLElement",
    "MouseEvent",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "innerWidth",
    "innerHeight",
  ] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of keys) previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const window = dom.window;
  const replacements = {
    window,
    document: window.document,
    navigator: window.navigator,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    MouseEvent: window.MouseEvent,
    requestAnimationFrame: (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (id: number) => window.clearTimeout(id),
    innerWidth: 1024,
    innerHeight: 768,
  };
  for (const [key, value] of Object.entries(replacements)) {
    Object.defineProperty(globalThis, key, { configurable: true, value, writable: true });
  }
  return () => {
    for (const key of keys) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    dom.window.close();
  };
}

describe("anchored surfaces anchor to the trigger ref", () => {
  it("Popover root renders no wrapper node", () => {
    const html = renderToString(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
      </Popover>,
    );

    // The trigger button is the outermost markup - no anchor <span> wrapper.
    assert(
      html.startsWith("<button"),
      `expected trigger-first markup, got: ${html.slice(0, 60)}`,
    );
    assertEquals(html.includes("relative inline-block"), false);
    assertStringIncludes(html, 'aria-haspopup="dialog"');
  });

  it("DropdownMenu root renders no wrapper node", () => {
    const html = renderToString(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
      </DropdownMenu>,
    );

    assert(
      html.startsWith("<button"),
      `expected trigger-first markup, got: ${html.slice(0, 60)}`,
    );
    assertEquals(html.includes("relative inline-block"), false);
    assertStringIncludes(html, 'aria-haspopup="menu"');
  });

  it("asChild trigger keeps the child as the outermost node", () => {
    const html = renderToString(
      <Popover>
        <PopoverTrigger asChild>
          <a href="#open">Open</a>
        </PopoverTrigger>
      </Popover>,
    );

    assert(
      html.startsWith("<a "),
      `expected the slotted child as outermost markup, got: ${html.slice(0, 60)}`,
    );
    assertStringIncludes(html, 'aria-haspopup="dialog"');
  });

  it("forwards consumer refs through portalled surfaces and command leaves", async () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      url: "https://example.com/",
    });
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);
    const popoverContentRef = React.createRef<HTMLDivElement>();
    const commandInputRef = React.createRef<HTMLInputElement>();
    const commandListRef = React.createRef<HTMLDivElement>();
    const commandItemRef = React.createRef<HTMLDivElement>();
    const menuContentRef = React.createRef<HTMLDivElement>();
    const menuItemRef = React.createRef<HTMLButtonElement>();

    try {
      flushSync(() => {
        root.render(
          <>
            <Popover defaultOpen>
              <PopoverTrigger>Search</PopoverTrigger>
              <PopoverContent ref={popoverContentRef}>
                <Command>
                  <CommandInput ref={commandInputRef} />
                  <CommandList ref={commandListRef}>
                    <CommandItem ref={commandItemRef} value="agent">Agent</CommandItem>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <DropdownMenu defaultOpen>
              <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
              <DropdownMenuContent ref={menuContentRef}>
                <DropdownMenuItem ref={menuItemRef}>Rename</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>,
        );
      });

      await waitFor(
        () =>
          popoverContentRef.current !== null &&
          commandInputRef.current !== null &&
          commandListRef.current !== null &&
          commandItemRef.current !== null &&
          menuContentRef.current !== null &&
          menuItemRef.current !== null,
        { message: "Timed out waiting for portalled surface refs" },
      );

      assertEquals(popoverContentRef.current?.getAttribute("role"), "dialog");
      assertEquals(commandInputRef.current?.tagName, "INPUT");
      assertEquals(commandListRef.current?.tagName, "DIV");
      assertEquals(commandItemRef.current?.getAttribute("role"), "option");
      assertEquals(menuContentRef.current?.getAttribute("role"), "menu");
      assertEquals(menuItemRef.current?.getAttribute("role"), "menuitem");
    } finally {
      flushSync(() => root.unmount());
      restore();
    }
  });
});
