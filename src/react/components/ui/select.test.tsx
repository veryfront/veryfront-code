import type * as React from "react";
import { flushSync } from "react-dom";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "./select.tsx";

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
    HTMLButtonElement: window.HTMLButtonElement,
    MouseEvent: window.MouseEvent,
    KeyboardEvent: window.KeyboardEvent,
    FocusEvent: window.FocusEvent,
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

function createDom(): JSDOM {
  return new JSDOM(
    '<!doctype html><html><body><div data-vf-ui><div id="root"></div></div></body></html>',
    {
      pretendToBeVisual: true,
      url: "https://example.com/",
    },
  );
}

async function waitFor(
  condition: () => boolean,
  message = "Select state",
  timeoutMs = 3000,
): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function press(
  element: HTMLElement,
  key: string,
  options: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
    ...options,
  });
  flushSync(() => element.dispatchEvent(event));
  return event;
}

function optionByText(text: string): HTMLElement {
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    .find((candidate) => candidate.textContent?.trim() === text);
  assert(option, `Expected option "${text}"`);
  return option;
}

function selectedText(trigger: HTMLElement): string | undefined {
  const activeId = trigger.getAttribute("aria-activedescendant");
  return activeId ? trigger.ownerDocument.getElementById(activeId)?.textContent?.trim() : undefined;
}

describe("Select", () => {
  it("links the combobox and listbox and supports the complete keyboard lifecycle", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);
    const values: string[] = [];
    const openChanges: boolean[] = [];

    try {
      flushSync(() => {
        root.render(
          <Select
            defaultValue="beta"
            onValueChange={(value) => values.push(value)}
            onOpenChange={(open) => openChanges.push(open)}
          >
            <SelectTrigger id="model-trigger">
              <SelectValue placeholder="Choose a model" />
            </SelectTrigger>
            <SelectContent id="model-list">
              <SelectItem value="alpha">Alpha</SelectItem>
              <SelectItem value="disabled" disabled>Disabled</SelectItem>
              <SelectItem value="beta">Beta</SelectItem>
              <SelectItem value="gamma">Gamma</SelectItem>
            </SelectContent>
          </Select>,
        );
      });

      const trigger = document.getElementById("model-trigger") as HTMLButtonElement;
      assert(trigger);
      trigger.focus();
      await waitFor(
        () => trigger.getAttribute("aria-controls") === "model-list",
        "combobox/listbox registration",
      );
      assertEquals(trigger.getAttribute("role"), "combobox");
      assertEquals(trigger.getAttribute("aria-haspopup"), "listbox");
      assertEquals(trigger.getAttribute("aria-expanded"), "false");
      assertEquals(trigger.hasAttribute("aria-activedescendant"), false);
      assertEquals(trigger.textContent?.includes("Beta"), true);

      const openingEvent = press(trigger, "ArrowDown");
      assertEquals(openingEvent.defaultPrevented, true);
      await waitFor(
        () => document.getElementById("model-list") !== null,
        "open listbox",
      );
      await waitFor(() => selectedText(trigger) === "Beta", "selected option activation");

      const listbox = document.getElementById("model-list");
      assert(listbox);
      assertEquals(trigger.getAttribute("aria-expanded"), "true");
      assertEquals(listbox.getAttribute("role"), "listbox");
      assertEquals(listbox.getAttribute("aria-labelledby"), "model-trigger");
      assertEquals(optionByText("Beta").getAttribute("aria-selected"), "true");
      assertEquals(optionByText("Disabled").getAttribute("aria-disabled"), "true");

      let scrollCalls = 0;
      const gamma = optionByText("Gamma");
      gamma.scrollIntoView = () => {
        scrollCalls += 1;
      };
      press(trigger, "ArrowDown");
      await waitFor(() => selectedText(trigger) === "Gamma", "next enabled option");
      assertEquals(scrollCalls, 1);

      press(trigger, "Home");
      await waitFor(() => selectedText(trigger) === "Alpha", "first option");
      press(trigger, "End");
      await waitFor(() => selectedText(trigger) === "Gamma", "last option");
      press(trigger, "Enter");
      await waitFor(() => trigger.getAttribute("aria-expanded") === "false", "selection close");

      assertEquals(values, ["gamma"]);
      assertEquals(openChanges, [true, false]);
      assertEquals(document.activeElement, trigger);
      assertEquals(trigger.hasAttribute("aria-activedescendant"), false);
      assertEquals(trigger.textContent?.includes("Gamma"), true);
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("composes caller handlers while protecting required semantics", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);
    const calls: string[] = [];
    const triggerRef = { current: null } as React.RefObject<HTMLButtonElement | null>;
    const itemRef = { current: null } as React.RefObject<HTMLDivElement | null>;

    try {
      flushSync(() => {
        root.render(
          <Select defaultValue="alpha">
            <SelectTrigger
              ref={triggerRef}
              id="caller-trigger"
              type="submit"
              role="menu"
              aria-controls="caller-external"
              aria-expanded={false}
              aria-activedescendant="caller-active"
              onClick={(event) => {
                calls.push("cancel-trigger");
                event.preventDefault();
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  calls.push("cancel-key");
                  event.preventDefault();
                }
              }}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent id="caller-list" role="menu" tabIndex={0}>
              <SelectItem
                ref={itemRef}
                id="caller-alpha"
                value="alpha"
                role="menuitem"
                tabIndex={0}
                aria-selected={false}
                onClick={(event) => {
                  calls.push("cancel-item");
                  event.preventDefault();
                }}
              >
                Alpha
              </SelectItem>
              <SelectItem
                id="caller-beta"
                value="beta"
                onMouseMove={(event) => event.preventDefault()}
              >
                Beta
              </SelectItem>
            </SelectContent>
          </Select>,
        );
      });

      const trigger = document.getElementById("caller-trigger") as HTMLButtonElement;
      assert(trigger);
      assertEquals(triggerRef.current, trigger);
      await waitFor(
        () => trigger.getAttribute("aria-controls") === "caller-list",
        "caller list registration",
      );
      assertEquals(trigger.type, "submit");
      assertEquals(trigger.getAttribute("role"), "combobox");
      assertEquals(trigger.getAttribute("aria-expanded"), "false");
      assertEquals(trigger.getAttribute("aria-controls"), "caller-list");
      assertEquals(trigger.hasAttribute("aria-activedescendant"), false);

      flushSync(() => trigger.click());
      press(trigger, "ArrowDown");
      assertEquals(trigger.getAttribute("aria-expanded"), "false");
      assertEquals(calls, ["cancel-trigger", "cancel-key"]);

      flushSync(() => {
        root.render(
          <Select defaultValue="alpha">
            <SelectTrigger id="caller-trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent id="caller-list" role="menu" tabIndex={0}>
              <SelectItem
                ref={itemRef}
                id="caller-alpha"
                value="alpha"
                role="menuitem"
                aria-selected={false}
                onClick={(event) => {
                  calls.push("cancel-item");
                  event.preventDefault();
                }}
              >
                Alpha
              </SelectItem>
              <SelectItem
                id="caller-beta"
                value="beta"
                onMouseMove={(event) => event.preventDefault()}
              >
                Beta
              </SelectItem>
            </SelectContent>
          </Select>,
        );
      });
      press(trigger, "ArrowDown");
      await waitFor(() => optionByText("Alpha") !== null, "caller options");
      const alpha = optionByText("Alpha");
      const beta = optionByText("Beta");
      assertEquals(itemRef.current, alpha);
      const callerList = document.getElementById("caller-list");
      assertEquals(callerList?.getAttribute("role"), "listbox");
      assertEquals(callerList?.hasAttribute("tabindex"), false);
      assertEquals(alpha.getAttribute("role"), "option");
      assertEquals(alpha.getAttribute("aria-selected"), "true");
      assertEquals(alpha.hasAttribute("tabindex"), false);
      await waitFor(
        () => selectedText(trigger) === "Alpha",
        "selected option registration",
      );

      flushSync(() => beta.dispatchEvent(new MouseEvent("mousemove", { bubbles: true })));
      assertEquals(selectedText(trigger), "Alpha");
      flushSync(() => alpha.click());
      assertEquals(calls, ["cancel-trigger", "cancel-key", "cancel-item"]);
      assertEquals(trigger.getAttribute("aria-expanded"), "true");
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("retains combobox focus through primary-pointer selection", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);
    const values: string[] = [];
    let mouseDownCalls = 0;

    try {
      flushSync(() => {
        root.render(
          <Select onValueChange={(value) => values.push(value)}>
            <SelectTrigger id="pointer-trigger">
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
            <SelectContent id="pointer-list">
              <SelectItem value="alpha">Alpha</SelectItem>
              <SelectItem
                value="beta"
                onMouseDown={() => {
                  mouseDownCalls += 1;
                }}
              >
                Beta
              </SelectItem>
            </SelectContent>
          </Select>,
        );
      });

      const trigger = document.getElementById(
        "pointer-trigger",
      ) as HTMLButtonElement;
      assert(trigger);
      trigger.focus();
      flushSync(() => trigger.click());
      await waitFor(
        () => document.getElementById("pointer-list") !== null,
        "pointer list",
      );
      const beta = optionByText("Beta");
      const mouseDown = new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        cancelable: true,
      });
      flushSync(() => beta.dispatchEvent(mouseDown));
      assertEquals(mouseDownCalls, 1);
      assertEquals(mouseDown.defaultPrevented, true);
      assertEquals(document.activeElement, trigger);

      flushSync(() => beta.click());
      await waitFor(
        () => trigger.getAttribute("aria-expanded") === "false",
        "pointer selection close",
      );
      assertEquals(values, ["beta"]);
      assertEquals(document.activeElement, trigger);
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("skips disabled options and honors composition, typeahead, Escape, and Tab", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);
    const openChanges: boolean[] = [];
    let disabledClicks = 0;

    try {
      flushSync(() => {
        root.render(
          <Select defaultValue="alpha" onOpenChange={(open) => openChanges.push(open)}>
            <SelectTrigger id="typeahead-trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent id="typeahead-list">
              <SelectItem value="alpha">Alpha</SelectItem>
              <SelectItem value="beta" disabled onClick={() => disabledClicks += 1}>
                Beta disabled
              </SelectItem>
              <SelectItem value="bravo">Bravo</SelectItem>
              <SelectItem value="beryl" textValue="Beryl search">
                <span aria-label="Beryl search">Beryl</span>
              </SelectItem>
              <SelectItem value="fox">🦊 Fox</SelectItem>
            </SelectContent>
          </Select>,
        );
      });

      const trigger = document.getElementById("typeahead-trigger") as HTMLButtonElement;
      assert(trigger);
      trigger.focus();
      const composing = press(trigger, "ArrowDown", { isComposing: true });
      assertEquals(composing.defaultPrevented, false);
      assertEquals(trigger.getAttribute("aria-expanded"), "false");

      press(trigger, "b");
      await waitFor(() => selectedText(trigger) === "Bravo", "initial typeahead match");
      press(trigger, "b");
      await waitFor(() => selectedText(trigger) === "Beryl", "repeated-key cycling");
      press(trigger, "e");
      assertEquals(selectedText(trigger), "Beryl");

      flushSync(() => optionByText("Beta disabled").click());
      assertEquals(disabledClicks, 0);
      assertEquals(trigger.getAttribute("aria-expanded"), "true");

      const escape = press(trigger, "Escape");
      assertEquals(escape.defaultPrevented, true);
      assertEquals(trigger.getAttribute("aria-expanded"), "false");
      assertEquals(document.activeElement, trigger);
      assertEquals(openChanges, [true, false]);

      press(trigger, " ");
      await waitFor(() => trigger.getAttribute("aria-expanded") === "true", "Space opening");
      press(trigger, "🦊");
      await waitFor(() => selectedText(trigger) === "🦊 Fox", "Unicode typeahead");
      const tab = press(trigger, "Tab");
      assertEquals(tab.defaultPrevented, false);
      assertEquals(trigger.getAttribute("aria-expanded"), "false");
      assertEquals(openChanges, [true, false, true, false]);
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("suppresses controlled content and requests closure when root disabled", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);
    const valueChanges: string[] = [];
    const openChanges: boolean[] = [];
    const renderSelect = (disabled: boolean) => (
      <Select
        disabled={disabled}
        value="alpha"
        open
        onValueChange={(value) => valueChanges.push(value)}
        onOpenChange={(open) => openChanges.push(open)}
      >
        <SelectTrigger id="disabled-trigger">
          <SelectValue />
        </SelectTrigger>
        <SelectContent id="disabled-list">
          <SelectItem value="alpha">Alpha</SelectItem>
          <SelectItem value="beta">Beta</SelectItem>
        </SelectContent>
      </Select>
    );

    try {
      flushSync(() => root.render(renderSelect(false)));
      const trigger = document.getElementById("disabled-trigger") as HTMLButtonElement;
      assert(trigger);
      await waitFor(
        () => document.getElementById("disabled-list") !== null,
        "initial controlled list",
      );

      flushSync(() => root.render(renderSelect(true)));
      assertEquals(trigger.disabled, true);
      assertEquals(trigger.getAttribute("aria-expanded"), "false");
      await waitFor(
        () => document.getElementById("disabled-list") === null,
        "disabled content suppression",
      );
      await waitFor(() => openChanges.length === 1, "controlled close request");
      assertEquals(openChanges, [false]);
      assertEquals(document.querySelectorAll('[role="option"]').length, 0);

      flushSync(() => trigger.click());
      press(trigger, "ArrowDown");
      assertEquals(valueChanges, []);
      assertEquals(openChanges, [false]);

      flushSync(() => root.render(renderSelect(false)));
      assertEquals(trigger.disabled, false);
      await waitFor(
        () => document.getElementById("disabled-list") !== null,
        "controlled owner re-enables its still-open value",
      );
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("commits an uncontrolled close when root transitions to disabled", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);
    const openChanges: boolean[] = [];
    const renderSelect = (disabled: boolean) => (
      <Select
        defaultOpen
        disabled={disabled}
        onOpenChange={(open) => openChanges.push(open)}
      >
        <SelectTrigger id="root-transition-trigger">
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent id="root-transition-list">
          <SelectItem value="alpha">Alpha</SelectItem>
        </SelectContent>
      </Select>
    );

    try {
      flushSync(() => root.render(renderSelect(false)));
      await waitFor(
        () => document.getElementById("root-transition-list") !== null,
        "initial root-transition list",
      );
      flushSync(() => root.render(renderSelect(true)));
      await waitFor(
        () => document.getElementById("root-transition-list") === null,
        "root-disabled list suppression",
      );
      await waitFor(() => openChanges.length === 1, "root-disabled close event");
      assertEquals(openChanges, [false]);

      flushSync(() => root.render(renderSelect(false)));
      const trigger = document.getElementById(
        "root-transition-trigger",
      ) as HTMLButtonElement;
      assert(trigger);
      assertEquals(trigger.disabled, false);
      assertEquals(trigger.getAttribute("aria-expanded"), "false");
      assertEquals(document.getElementById("root-transition-list"), null);
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("treats trigger-local disabled as root-wide and closes uncontrolled content", async () => {
    const disabledServerMarkup = renderToString(
      <Select defaultOpen>
        <SelectTrigger disabled>
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="alpha">Alpha</SelectItem>
        </SelectContent>
      </Select>,
    );
    assertEquals(disabledServerMarkup.includes('aria-expanded="false"'), true);
    assertEquals(disabledServerMarkup.includes(" disabled"), true);

    const dom = createDom();
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);
    const openChanges: boolean[] = [];
    const renderSelect = (triggerDisabled: boolean) => (
      <Select
        defaultOpen
        onOpenChange={(open) => openChanges.push(open)}
      >
        <SelectTrigger id="local-disabled-trigger" disabled={triggerDisabled}>
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent id="local-disabled-list">
          <SelectItem value="alpha">Alpha</SelectItem>
          <SelectItem value="beta">Beta</SelectItem>
        </SelectContent>
      </Select>
    );

    try {
      flushSync(() => root.render(renderSelect(false)));
      const trigger = document.getElementById(
        "local-disabled-trigger",
      ) as HTMLButtonElement;
      assert(trigger);
      await waitFor(
        () => document.getElementById("local-disabled-list") !== null,
        "initial uncontrolled list",
      );

      flushSync(() => root.render(renderSelect(true)));
      await waitFor(() => trigger.disabled, "trigger-disabled registration");
      await waitFor(
        () => document.getElementById("local-disabled-list") === null,
        "trigger-disabled content suppression",
      );
      await waitFor(() => openChanges.length === 1, "uncontrolled close event");
      assertEquals(openChanges, [false]);
      assertEquals(document.querySelectorAll('[role="option"]').length, 0);

      flushSync(() => root.render(renderSelect(false)));
      await waitFor(() => !trigger.disabled, "trigger re-enable");
      assertEquals(document.getElementById("local-disabled-list"), null);
      flushSync(() => trigger.click());
      await waitFor(
        () => document.getElementById("local-disabled-list") !== null,
        "explicit reopen after re-enable",
      );
      assertEquals(openChanges, [false, true]);
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("reconciles keyed DOM reordering and active-option removal", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);

    const renderItems = (items: Array<{ value: string; disabled?: boolean }>) => (
      <Select defaultOpen>
        <SelectTrigger id="reorder-trigger">
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent id="reorder-list">
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value} disabled={item.disabled}>
              {item.value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );

    try {
      flushSync(() =>
        root.render(
          renderItems([
            { value: "Alpha" },
            { value: "Beta" },
            { value: "Gamma" },
          ]),
        )
      );
      const trigger = document.getElementById("reorder-trigger") as HTMLButtonElement;
      assert(trigger);
      await waitFor(() => selectedText(trigger) === "Alpha", "initial active option");
      press(trigger, "ArrowDown");
      await waitFor(() => selectedText(trigger) === "Beta", "moved active option");

      flushSync(() =>
        root.render(
          renderItems([
            { value: "Gamma" },
            { value: "Alpha" },
            { value: "Beta", disabled: true },
          ]),
        )
      );
      await waitFor(() => selectedText(trigger) === "Gamma", "disabled active fallback");

      press(trigger, "End");
      await waitFor(() => selectedText(trigger) === "Alpha", "reordered final option");
      press(trigger, "Home");
      await waitFor(() => selectedText(trigger) === "Gamma", "reordered first option");
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("coalesces 100-item DOM order reconciliation to one sort per commit", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);
    const nodePrototype = dom.window.Node.prototype;
    const compareDocumentPosition = nodePrototype.compareDocumentPosition;
    let comparisons = 0;
    nodePrototype.compareDocumentPosition = function (
      other: Node,
    ): number {
      comparisons += 1;
      return compareDocumentPosition.call(this, other);
    };
    const values = Array.from(
      { length: 100 },
      (_, index) => `Item ${String(index).padStart(3, "0")}`,
    );
    const comparisonBudget = values.length * Math.ceil(Math.log2(values.length));
    const renderItems = (orderedValues: string[]) => (
      <Select defaultOpen>
        <SelectTrigger id="budget-trigger">
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent id="budget-list">
          {orderedValues.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
        </SelectContent>
      </Select>
    );

    try {
      flushSync(() => root.render(renderItems(values)));
      const trigger = document.getElementById("budget-trigger");
      assert(trigger);
      await waitFor(
        () => selectedText(trigger) === "Item 000",
        "initial 100-item order",
      );
      await Promise.resolve();
      assert(
        comparisons <= comparisonBudget,
        `Expected one O(n log n) 100-item sort, received ${comparisons} comparisons`,
      );

      comparisons = 0;
      flushSync(() => root.render(renderItems([...values].reverse())));
      await waitFor(
        () => selectedText(trigger) === "Item 099",
        "reversed 100-item order",
      );
      await Promise.resolve();
      assert(
        comparisons <= comparisonBudget,
        `Expected one O(n log n) reorder sort, received ${comparisons} comparisons`,
      );
    } finally {
      nodePrototype.compareDocumentPosition = compareDocumentPosition;
      await unmountReactRoot(root);
      restore();
    }
  });

  it("keeps controlled state owned by the caller while reporting each request", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);
    const openChanges: boolean[] = [];
    const valueChanges: string[] = [];

    const controlled = (
      <Select
        value="alpha"
        open={false}
        onOpenChange={(open) => openChanges.push(open)}
        onValueChange={(value) => valueChanges.push(value)}
      >
        <SelectTrigger id="controlled-trigger">
          <SelectValue />
        </SelectTrigger>
        <SelectContent id="controlled-list">
          <SelectItem value="alpha">Alpha</SelectItem>
          <SelectItem value="beta">Beta</SelectItem>
        </SelectContent>
      </Select>
    );

    try {
      flushSync(() => root.render(controlled));
      const trigger = document.getElementById("controlled-trigger") as HTMLButtonElement;
      assert(trigger);
      flushSync(() => trigger.click());
      await Promise.resolve();
      flushSync(() => trigger.click());
      assertEquals(openChanges, [true, true]);
      assertEquals(trigger.getAttribute("aria-expanded"), "false");
      assertEquals(trigger.textContent?.includes("Alpha"), true);
      assertEquals(valueChanges, []);

      flushSync(() => {
        root.render(
          <Select
            value="alpha"
            open
            onOpenChange={(open) => openChanges.push(open)}
            onValueChange={(value) => valueChanges.push(value)}
          >
            <SelectTrigger id="controlled-trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent id="controlled-list">
              <SelectItem value="alpha">Alpha</SelectItem>
              <SelectItem value="beta">Beta</SelectItem>
            </SelectContent>
          </Select>,
        );
      });
      await waitFor(
        () => document.getElementById("controlled-list") !== null,
        "controlled open list",
      );
      const outside = document.createElement("button");
      document.body.append(outside);
      trigger.focus();
      flushSync(() => {
        outside.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
        );
        outside.focus();
      });
      await Promise.resolve();
      assertEquals(openChanges, [true, true, false]);
      assertEquals(document.activeElement, outside);
      outside.remove();
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("closes on focus departure without stealing the new focus target", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const rootElement = document.getElementById("root")!;
    const outside = document.createElement("button");
    outside.textContent = "Outside";
    document.body.append(outside);
    const root = createRoot(rootElement);

    try {
      flushSync(() => {
        root.render(
          <Select>
            <SelectTrigger id="blur-trigger">
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
            <SelectContent id="blur-list">
              <SelectItem value="alpha">Alpha</SelectItem>
            </SelectContent>
          </Select>,
        );
      });
      const trigger = document.getElementById("blur-trigger") as HTMLButtonElement;
      assert(trigger);
      trigger.focus();
      flushSync(() => trigger.click());
      await waitFor(() => trigger.getAttribute("aria-expanded") === "true", "open before blur");
      flushSync(() => outside.focus());
      await waitFor(() => trigger.getAttribute("aria-expanded") === "false", "blur close");
      assertEquals(document.activeElement, outside);
    } finally {
      await unmountReactRoot(root);
      outside.remove();
      restore();
    }
  });

  it("hydrates default-open markup with stable ids and named groups", async () => {
    const tree = (
      <div data-vf-ui="">
        <Select defaultOpen defaultValue="beta">
          <SelectTrigger id="hydrated-trigger">
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent id="hydrated-list">
            <SelectGroup data-group="">
              <SelectLabel id="models-label">Models</SelectLabel>
              <SelectItem id="hydrated-alpha" value="alpha">Alpha</SelectItem>
              <SelectItem id="hydrated-beta" value="beta">Beta</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    );
    const serverMarkup = renderToString(tree);
    assertEquals(serverMarkup.includes('aria-expanded="true"'), true);
    assertEquals(serverMarkup.includes('id="hydrated-list"'), false);

    const dom = new JSDOM(
      `<!doctype html><html><body><div id="root">${serverMarkup}</div></body></html>`,
      {
        pretendToBeVisual: true,
        url: "https://example.com/",
      },
    );
    const restore = installDom(dom);
    const recoverableErrors: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement);
      root = hydrateRoot(rootElement, tree, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });
      await waitFor(() => document.getElementById("hydrated-list") !== null, "hydrated listbox");
      const trigger = document.getElementById("hydrated-trigger");
      const listbox = document.getElementById("hydrated-list");
      const group = document.querySelector<HTMLElement>("[data-group]");
      assert(trigger);
      assert(listbox);
      assert(group);
      await waitFor(() => group.getAttribute("role") === "group", "group label registration");

      assertEquals(recoverableErrors, []);
      assertEquals(trigger.getAttribute("aria-controls"), "hydrated-list");
      assertEquals(trigger.getAttribute("aria-activedescendant"), "hydrated-beta");
      assertEquals(listbox.getAttribute("aria-labelledby"), "hydrated-trigger");
      assertEquals(group.getAttribute("aria-labelledby"), "models-label");
    } finally {
      if (root) await unmountReactRoot(root);
      restore();
    }
  });

  it("rejects inspectable duplicate values and ids while still closed", () => {
    const duplicateValues = (defaultOpen: boolean) => (
      <Select defaultOpen={defaultOpen}>
        <SelectTrigger id="duplicate-trigger">
          <SelectValue />
        </SelectTrigger>
        <SelectContent id="duplicate-list">
          <SelectItem value="same">First</SelectItem>
          <SelectItem value="same">Second</SelectItem>
        </SelectContent>
      </Select>
    );

    assertThrows(
      () => renderToString(duplicateValues(false)),
      Error,
      'SelectItem values must be unique; received "same" twice',
    );
    assertThrows(
      () => renderToString(duplicateValues(true)),
      Error,
      'SelectItem values must be unique; received "same" twice',
    );
    assertThrows(
      () =>
        renderToString(
          <Select>
            <SelectTrigger id="duplicate-part">
              <SelectValue />
            </SelectTrigger>
            <SelectContent id="duplicate-part">
              <SelectItem value="unique">Unique</SelectItem>
            </SelectContent>
          </Select>,
        ),
      Error,
      'Select part ids must be unique; received "duplicate-part" twice',
    );
  });

  it("does not inspect Select parts discarded by opaque components", () => {
    function OmitChildren(
      _props: { children: React.ReactNode },
    ): React.ReactElement | null {
      return null;
    }

    const markup = renderToString(
      <Select>
        <OmitChildren>
          <SelectTrigger id="real-trigger" disabled>
            <SelectValue />
          </SelectTrigger>
          <SelectContent id="real-list">
            <SelectItem value="real">Hidden first</SelectItem>
            <SelectItem value="real">Hidden second</SelectItem>
          </SelectContent>
        </OmitChildren>
        <SelectTrigger id="real-trigger">
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent id="real-list">
          <SelectItem value="real">Rendered</SelectItem>
        </SelectContent>
      </Select>,
    );
    const dom = new JSDOM(`<!doctype html><body>${markup}</body>`);
    try {
      const trigger = dom.window.document.querySelector(
        '[role="combobox"]',
      ) as HTMLButtonElement | null;
      assert(trigger);
      assertEquals(trigger.disabled, false);
      assertEquals(trigger.getAttribute("aria-expanded"), "false");
    } finally {
      dom.window.close();
    }
  });

  it("fails dynamic closed duplicates without tearing down the root", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const rootElement = document.getElementById("root")!;
    const root = createRoot(rootElement);
    const openChanges: boolean[] = [];

    function DynamicDuplicateItems(): React.ReactElement {
      return (
        <>
          <SelectItem value="dynamic">First</SelectItem>
          <SelectItem value="dynamic">Second</SelectItem>
        </>
      );
    }

    try {
      flushSync(() => {
        root.render(
          <Select onOpenChange={(open) => openChanges.push(open)}>
            <SelectTrigger id="dynamic-trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent id="dynamic-list">
              <DynamicDuplicateItems />
            </SelectContent>
          </Select>,
        );
      });
      const trigger = document.getElementById("dynamic-trigger") as HTMLButtonElement;
      assert(trigger);
      flushSync(() => trigger.click());
      await waitFor(
        () => trigger.getAttribute("aria-invalid") === "true",
        "dynamic duplicate failure",
      );
      await waitFor(
        () => document.getElementById("dynamic-list") === null,
        "dynamic duplicate content suppression",
      );
      await waitFor(
        () => openChanges.length === 2 && openChanges[1] === false,
        "dynamic duplicate close notification",
      );
      assertEquals(rootElement.contains(trigger), true);
      assertEquals(trigger.disabled, true);
      assertEquals(trigger.getAttribute("aria-expanded"), "false");
      assertEquals(openChanges, [true, false]);
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("fails default-open dynamic duplicates before user interaction", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const rootElement = document.getElementById("root")!;
    const root = createRoot(rootElement);
    const openChanges: boolean[] = [];

    function DynamicDuplicateItems(): React.ReactElement {
      return (
        <>
          <SelectItem value="dynamic">First</SelectItem>
          <SelectItem value="dynamic">Second</SelectItem>
        </>
      );
    }

    try {
      flushSync(() => {
        root.render(
          <Select
            defaultOpen
            onOpenChange={(open) => openChanges.push(open)}
          >
            <SelectTrigger id="dynamic-default-trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent id="dynamic-default-list">
              <DynamicDuplicateItems />
            </SelectContent>
          </Select>,
        );
      });
      const trigger = document.getElementById(
        "dynamic-default-trigger",
      ) as HTMLButtonElement;
      assert(trigger);
      await waitFor(
        () => trigger.getAttribute("aria-invalid") === "true",
        "default-open dynamic duplicate failure",
      );
      await waitFor(
        () => document.getElementById("dynamic-default-list") === null,
        "default-open duplicate content suppression",
      );
      // Suppression is synchronous with the invalid render; the close request
      // to the owner is an effect that lands afterwards.
      await waitFor(
        () => openChanges.length === 1,
        "default-open close request",
      );
      assertEquals(rootElement.contains(trigger), true);
      assertEquals(trigger.disabled, true);
      assertEquals(openChanges, [false]);
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("fails closed when an item is composed outside SelectContent", () => {
    assertThrows(
      () =>
        renderToString(
          <Select>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectItem value="orphan">Orphan</SelectItem>
          </Select>,
        ),
      Error,
      "SelectItem must be used within <SelectContent>",
    );
  });

  it("uses explicit display contracts without duplicating arbitrary item nodes", () => {
    const buildIdFixture = (...segments: string[]): string => segments.join(" ");
    const spacedTriggerId = buildIdFixture("invalid", "trigger", "id");
    const emptyContentId = buildIdFixture();
    assertEquals(spacedTriggerId.includes(" "), true);
    assertEquals(emptyContentId, "");
    const markup = renderToString(
      <>
        <Select value="opaque" onValueChange={() => {}}>
          <SelectTrigger id={spacedTriggerId}>
            <SelectValue className="custom-value">Friendly name</SelectValue>
          </SelectTrigger>
          <SelectContent id={emptyContentId}>
            <SelectItem value="opaque">Opaque fallback</SelectItem>
          </SelectContent>
        </Select>
        <Select defaultValue="interactive">
          <SelectTrigger data-text-trigger="">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="interactive">
              <button type="button">Nested action</button>
              <span>Safe label</span>
            </SelectItem>
          </SelectContent>
        </Select>
        <Select defaultValue="rich">
          <SelectTrigger data-rich-trigger="">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              value="rich"
              displayValue={<span data-explicit-display="">Explicit display</span>}
            >
              Arbitrary option body
            </SelectItem>
          </SelectContent>
        </Select>
      </>,
    );
    const dom = new JSDOM(`<!doctype html><body>${markup}</body>`);
    try {
      const trigger = dom.window.document.querySelector('[role="combobox"]');
      const value = dom.window.document.querySelector(".custom-value");
      const textTrigger = dom.window.document.querySelector<HTMLElement>(
        "[data-text-trigger]",
      );
      const richTrigger = dom.window.document.querySelector<HTMLElement>(
        "[data-rich-trigger]",
      );
      assert(trigger);
      assert(value);
      assert(textTrigger);
      assert(richTrigger);
      assertEquals(trigger.id.includes(" "), false);
      assertEquals(value.textContent, "Friendly name");
      assertEquals(textTrigger.querySelector("button"), null);
      assertEquals(textTrigger.textContent?.includes("Nested action Safe label"), true);
      assert(richTrigger.querySelector("[data-explicit-display]"));
    } finally {
      dom.window.close();
    }
  });

  it("runs React 19 callback-ref cleanup for trigger and item refs", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);
    const calls: string[] = [];

    try {
      flushSync(() => {
        root.render(
          <Select defaultOpen>
            <SelectTrigger
              ref={(element) => {
                if (!element) {
                  calls.push("trigger:null");
                  return;
                }
                calls.push("trigger:attach");
                return () => {
                  calls.push("trigger:cleanup");
                };
              }}
            >
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                value="alpha"
                ref={(element) => {
                  if (!element) {
                    calls.push("item:null");
                    return;
                  }
                  calls.push("item:attach");
                  return () => {
                    calls.push("item:cleanup");
                  };
                }}
              >
                Alpha
              </SelectItem>
            </SelectContent>
          </Select>,
        );
      });
      await waitFor(
        () => document.querySelector('[role="option"]') !== null,
        "callback-ref option",
      );
      assertEquals(calls, ["trigger:attach", "item:attach"]);

      await unmountReactRoot(root);
      assertEquals(calls, [
        "trigger:attach",
        "item:attach",
        "trigger:cleanup",
        "item:cleanup",
      ]);
    } finally {
      restore();
    }
  });
});
