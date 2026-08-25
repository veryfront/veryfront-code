import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import { type ComponentDomOptions, installComponentDom } from "#veryfront/testing/dom-globals.ts";
import { Command, CommandInput, CommandItem, CommandList } from "./command.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./popover.tsx";

const DOM_OPTIONS: ComponentDomOptions = {
  windowGlobals: ["innerWidth", "innerHeight"],
};

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

  it("does not inject button type into an opaque asChild anchor", () => {
    const OpaqueAnchor = React.forwardRef<
      HTMLAnchorElement,
      React.AnchorHTMLAttributes<HTMLAnchorElement>
    >((props, ref) => <a {...props} ref={ref} />);
    const html = renderToString(
      <Popover>
        <PopoverTrigger asChild>
          <OpaqueAnchor href="#open">Open</OpaqueAnchor>
        </PopoverTrigger>
      </Popover>,
    );

    assert(html.startsWith("<a "), `expected opaque anchor markup, got: ${html.slice(0, 60)}`);
    assert(!/<a\b[^>]*\btype=/.test(html), "opaque anchor must not receive button type");
  });

  it("forwards consumer refs through portalled surfaces and command leaves", async () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      url: "https://example.com/",
    });
    const restore = installComponentDom(dom, DOM_OPTIONS);
    const root = createRoot(document.getElementById("root")!);
    const popoverContentRef = React.createRef<HTMLDivElement>();
    const commandInputRef = React.createRef<HTMLInputElement>();
    const commandListRef = React.createRef<HTMLDivElement>();
    const commandItemRef = React.createRef<HTMLDivElement>();
    const menuContentRef = React.createRef<HTMLDivElement>();
    const menuItemRef = React.createRef<HTMLButtonElement>();
    const menuSlottedButtonRef = React.createRef<HTMLButtonElement>();
    const menuAnchorRef = React.createRef<HTMLAnchorElement>();
    const selectedAnchor = { current: null as HTMLAnchorElement | null };

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
                <DropdownMenuItem asChild ref={menuSlottedButtonRef}>
                  {React.createElement("button", null, "Duplicate")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  asChild
                  ref={menuAnchorRef}
                  onSelect={(event) => selectedAnchor.current = event.currentTarget}
                >
                  <a href="#archive">Archive</a>
                </DropdownMenuItem>
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
          menuItemRef.current !== null &&
          menuSlottedButtonRef.current !== null &&
          menuAnchorRef.current !== null,
        { message: "Timed out waiting for portalled surface refs" },
      );

      assertEquals(popoverContentRef.current?.getAttribute("role"), "dialog");
      assertEquals(commandInputRef.current?.tagName, "INPUT");
      assertEquals(commandListRef.current?.tagName, "DIV");
      assertEquals(commandItemRef.current?.getAttribute("role"), "option");
      assertEquals(menuContentRef.current?.getAttribute("role"), "menu");
      assertEquals(menuItemRef.current?.getAttribute("role"), "menuitem");
      assertEquals(menuSlottedButtonRef.current?.type, "button");
      assertEquals(menuAnchorRef.current?.tagName, "A");
      menuAnchorRef.current?.click();
      assertEquals(selectedAnchor.current?.tagName, "A");
    } finally {
      flushSync(() => root.unmount());
      await new Promise((resolve) => setTimeout(resolve, 0));
      restore();
    }
  });

  it("preserves keyboard activation across native and slotted menu items", async () => {
    type ItemKind = "native" | "button" | "anchor" | "custom";
    interface ActivationOptions {
      kind: ItemKind;
      key: "Enter" | " ";
      disabled?: boolean;
      composing?: boolean;
      preventDefault?: boolean;
      simulateNativeClick?: boolean;
    }

    async function activate(options: ActivationOptions): Promise<{
      selectedAfterKey: number;
      selectedAfterNativeClick: number;
      keyWasPrevented: boolean;
    }> {
      const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
        url: "https://example.com/",
      });
      const restore = installComponentDom(dom, DOM_OPTIONS);
      const root = createRoot(document.getElementById("root")!);
      let selected = 0;
      const child = options.kind === "button"
        ? <button type="button" data-menu-activation="">Action</button>
        : options.kind === "anchor"
        ? <a data-menu-activation="" href="#action">Action</a>
        : <div data-menu-activation="">Action</div>;
      const item = options.kind === "native"
        ? (
          <DropdownMenuItem
            data-menu-activation=""
            disabled={options.disabled}
            onKeyDown={options.preventDefault ? (event) => event.preventDefault() : undefined}
            onSelect={() => selected += 1}
          >
            Action
          </DropdownMenuItem>
        )
        : (
          <DropdownMenuItem
            asChild
            disabled={options.disabled}
            onKeyDown={options.preventDefault ? (event) => event.preventDefault() : undefined}
            onSelect={() => selected += 1}
          >
            {child}
          </DropdownMenuItem>
        );

      try {
        flushSync(() => {
          root.render(
            <DropdownMenu defaultOpen>
              <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
              <DropdownMenuContent>
                {item}
              </DropdownMenuContent>
            </DropdownMenu>,
          );
        });
        await waitFor(
          () => document.querySelector<HTMLElement>("[data-menu-activation]") !== null,
          { message: "Timed out waiting for the menu item" },
        );
        const itemElement = document.querySelector<HTMLElement>("[data-menu-activation]")!;
        itemElement.focus();
        const keyEvent = new dom.window.KeyboardEvent("keydown", {
          key: options.key,
          bubbles: true,
          cancelable: true,
          isComposing: options.composing,
        });
        flushSync(() => itemElement.dispatchEvent(keyEvent));
        const selectedAfterKey = selected;
        if (options.simulateNativeClick) flushSync(() => itemElement.click());
        return {
          selectedAfterKey,
          selectedAfterNativeClick: selected,
          keyWasPrevented: keyEvent.defaultPrevented,
        };
      } finally {
        flushSync(() => root.unmount());
        await new Promise((resolve) => setTimeout(resolve, 0));
        restore();
      }
    }

    for (const key of ["Enter", " "] as const) {
      const nativeItem = await activate({
        kind: "native",
        key,
        simulateNativeClick: true,
      });
      assertEquals(
        nativeItem.selectedAfterKey,
        0,
        `${key} leaves default button activation native`,
      );
      assertEquals(nativeItem.selectedAfterNativeClick, 1);
      assertEquals(nativeItem.keyWasPrevented, false);

      const nativeButton = await activate({
        kind: "button",
        key,
        simulateNativeClick: true,
      });
      assertEquals(
        nativeButton.selectedAfterKey,
        0,
        `${key} leaves native button activation native`,
      );
      assertEquals(
        nativeButton.selectedAfterNativeClick,
        1,
        `${key} does not double-fire a native button click`,
      );
      assertEquals(nativeButton.keyWasPrevented, false);

      const custom = await activate({ kind: "custom", key });
      assertEquals(custom.selectedAfterKey, 1, `${key} activates a non-native menu item`);
      assertEquals(custom.keyWasPrevented, true, `${key} prevents the non-native default`);
    }

    const anchorEnter = await activate({
      kind: "anchor",
      key: "Enter",
      simulateNativeClick: true,
    });
    assertEquals(anchorEnter.selectedAfterKey, 0, "Enter leaves anchor activation native");
    assertEquals(anchorEnter.selectedAfterNativeClick, 1, "Enter does not double-fire an anchor");
    assertEquals(anchorEnter.keyWasPrevented, false);

    const anchorSpace = await activate({ kind: "anchor", key: " " });
    assertEquals(anchorSpace.selectedAfterKey, 1, "Space activates an anchor menu item");
    assertEquals(anchorSpace.keyWasPrevented, true);

    assertEquals(
      (await activate({ kind: "custom", key: "Enter", preventDefault: true })).selectedAfterKey,
      0,
      "consumer preventDefault cancels synthetic activation",
    );
    assertEquals(
      (await activate({ kind: "custom", key: "Enter", disabled: true })).selectedAfterKey,
      0,
      "disabled items cannot be activated",
    );
    assertEquals(
      (await activate({ kind: "custom", key: "Enter", composing: true })).selectedAfterKey,
      0,
      "IME completion does not activate an item",
    );
  });
});
