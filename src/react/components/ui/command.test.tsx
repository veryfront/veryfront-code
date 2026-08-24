import type * as React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  commandItemMatches,
  CommandList,
  getNextCommandItemId,
  handleCommandInputChange,
  handleCommandInputKeyDown,
} from "./command.tsx";

function installDom(dom: JSDOM): () => void {
  const window = dom.window;
  const replacements = {
    window,
    document: window.document,
    navigator: window.navigator,
    self: window,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    MouseEvent: window.MouseEvent,
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();

  for (const key of Object.keys(replacements)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
  for (const [key, value] of Object.entries(replacements)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }

  return () => {
    for (const [key, descriptor] of previous) {
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
      throw new Error("Timed out waiting for Command state");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function createKeyboardEvent(
  key: string,
  options: { composing?: boolean; keyCode?: number } = {},
): React.KeyboardEvent<HTMLInputElement> {
  const event = {
    key,
    defaultPrevented: false,
    nativeEvent: {
      isComposing: options.composing ?? false,
      keyCode: options.keyCode ?? 0,
    },
    preventDefault() {
      event.defaultPrevented = true;
    },
  };
  return event as unknown as React.KeyboardEvent<HTMLInputElement>;
}

function createChangeEvent(value: string): React.ChangeEvent<HTMLInputElement> {
  const event = {
    currentTarget: { value },
    defaultPrevented: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
  };
  return event as unknown as React.ChangeEvent<HTMLInputElement>;
}

// Unmounting leaves a scheduler callback queued; drain it so the leak
// sanitizer does not attribute that timer to the test.
async function unmount(root: Root): Promise<void> {
  flushSync(() => root.unmount());
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Command", () => {
  it("exposes a listbox contract and tracks pointer-active options", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);
    const selected: string[] = [];

    try {
      flushSync(() => {
        root.render(
          <Command>
            <CommandInput placeholder="Find a model" />
            <CommandList id="models-list">
              <CommandItem value="Alpha" onSelect={() => selected.push("alpha")}>
                Alpha
              </CommandItem>
              <CommandItem
                value="Disabled"
                disabled
                onSelect={() => selected.push("disabled")}
              >
                Disabled
              </CommandItem>
              <CommandItem value="Beta" onSelect={() => selected.push("beta")}>
                Beta
              </CommandItem>
            </CommandList>
          </Command>,
        );
      });

      const input = document.querySelector<HTMLInputElement>("input");
      const list = document.querySelector<HTMLElement>('[role="listbox"]');
      assert(input);
      assert(list);
      await waitFor(() => input.getAttribute("aria-controls") === list.id);
      assertEquals(input.getAttribute("role"), "combobox");
      assertEquals(input.getAttribute("aria-controls"), list.id);
      assertEquals(input.getAttribute("aria-label"), "Find a model");
      assertEquals(list.id, "models-list");
      assertEquals(list.getAttribute("aria-label"), "Command results");

      await waitFor(() => input.getAttribute("aria-activedescendant") !== null);
      const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
      const alpha = options[0];
      const disabled = options[1];
      const beta = options[2];
      assert(alpha);
      assert(disabled);
      assert(beta);
      assertEquals(input.getAttribute("aria-activedescendant"), alpha.id);

      let scrollCalls = 0;
      beta.scrollIntoView = () => {
        scrollCalls += 1;
      };
      flushSync(() => {
        beta.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      });
      await waitFor(() => input.getAttribute("aria-activedescendant") === beta.id);
      await waitFor(() => scrollCalls === 1);
      assertEquals(scrollCalls, 1);
      flushSync(() => {
        disabled.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      });
      assertEquals(input.getAttribute("aria-activedescendant"), beta.id);

      flushSync(() => beta.click());
      flushSync(() => disabled.click());
      assertEquals(selected, ["beta"]);
    } finally {
      await unmount(root);
      restore();
    }
  });

  it("chains item click handlers and honors cancellation before selection", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);
    const calls: string[] = [];

    try {
      flushSync(() => {
        root.render(
          <Command>
            <CommandInput />
            <CommandList>
              <CommandItem
                value="Allowed"
                onClick={() => calls.push("click")}
                onSelect={() => calls.push("select")}
              >
                Allowed
              </CommandItem>
              <CommandItem
                value="Cancelled"
                onClick={(event) => {
                  calls.push("cancel-click");
                  event.preventDefault();
                }}
                onSelect={() => calls.push("cancel-select")}
              >
                Cancelled
              </CommandItem>
            </CommandList>
          </Command>,
        );
      });

      const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
      const allowed = options[0];
      const cancelled = options[1];
      assert(allowed);
      assert(cancelled);
      await waitFor(() => allowed.getAttribute("aria-selected") === "true");

      flushSync(() => allowed.click());
      flushSync(() => cancelled.click());
      assertEquals(calls, ["click", "select", "cancel-click"]);
    } finally {
      await unmount(root);
      restore();
    }
  });

  it("implements deterministic matching and cyclic navigation", () => {
    assertEquals(commandItemMatches("alp", "Alpha"), true);
    assertEquals(commandItemMatches("missing", "Alpha"), false);
    assertEquals(commandItemMatches("missing", ""), true);

    const ids = ["alpha", "beta", "gamma"];
    assertEquals(getNextCommandItemId(ids, undefined, "next"), "alpha");
    assertEquals(getNextCommandItemId(ids, undefined, "previous"), "gamma");
    assertEquals(getNextCommandItemId(ids, "alpha", "previous"), "gamma");
    assertEquals(getNextCommandItemId(ids, "gamma", "next"), "alpha");
    assertEquals(getNextCommandItemId(ids, "beta", "first"), "alpha");
    assertEquals(getNextCommandItemId(ids, "beta", "last"), "gamma");
    assertEquals(getNextCommandItemId([], undefined, "next"), undefined);
  });

  it("names headed groups and keeps unlabelled wrappers presentational", () => {
    const html = renderToString(
      <>
        <Command>
          <CommandInput aria-controls="external-list" aria-expanded={false} />
          <CommandList>
            <CommandGroup data-unlabelled="">
              <CommandItem value="Alpha">Alpha</CommandItem>
            </CommandGroup>
            <CommandGroup data-labelled="" heading="Models">
              <CommandItem value="Beta">Beta</CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
        <Command>
          <CommandInput
            data-string-collapsed=""
            aria-controls="external-list"
            aria-expanded="false"
          />
          <CommandList />
        </Command>
      </>,
    );
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
    try {
      const unlabelled = dom.window.document.querySelector("[data-unlabelled]");
      const labelled = dom.window.document.querySelector("[data-labelled]");
      assert(unlabelled);
      assert(labelled);
      const input = dom.window.document.querySelector("input");
      assert(input);
      assertEquals(input.getAttribute("aria-controls"), "external-list");
      assertEquals(input.getAttribute("aria-expanded"), "false");
      assertEquals(input.hasAttribute("aria-activedescendant"), false);
      const stringCollapsed = dom.window.document.querySelector(
        "[data-string-collapsed]",
      );
      assert(stringCollapsed);
      assertEquals(stringCollapsed.getAttribute("aria-expanded"), "false");
      assertEquals(stringCollapsed.hasAttribute("aria-activedescendant"), false);
      assertEquals(unlabelled.getAttribute("role"), "presentation");
      assertEquals(labelled.getAttribute("role"), "group");
      const headingId = labelled.getAttribute("aria-labelledby");
      assert(headingId);
      assertEquals(
        dom.window.document.getElementById(headingId)?.getAttribute("role"),
        "presentation",
      );
    } finally {
      dom.window.close();
    }
  });

  it("reconciles keyboard order after keyed options move in the DOM", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);
    const renderItems = (items: string[]) => (
      <Command>
        <CommandInput />
        <CommandList id="reorder-list">
          {items.map((item) => (
            <CommandItem key={item} value={item}>
              {item}
            </CommandItem>
          ))}
        </CommandList>
      </Command>
    );

    try {
      flushSync(() => root.render(renderItems(["Alpha", "Beta"])));
      const input = document.querySelector<HTMLInputElement>("input");
      assert(input);
      await waitFor(() => {
        const active = input.getAttribute("aria-activedescendant");
        return document.getElementById(active ?? "")?.textContent === "Alpha";
      });

      flushSync(() => root.render(renderItems(["Beta", "Alpha"])));
      await waitFor(() => {
        const active = input.getAttribute("aria-activedescendant");
        return document.getElementById(active ?? "")?.textContent === "Beta";
      });
    } finally {
      await unmount(root);
      restore();
    }
  });

  it("chains input handlers while respecting cancellation and composition", () => {
    const calls: string[] = [];
    const change = createChangeEvent("alpha");
    handleCommandInputChange(
      change,
      () => calls.push("change"),
      (value) => calls.push(`search:${value}`),
    );
    assertEquals(calls, ["change", "search:alpha"]);

    const cancelledChange = createChangeEvent("beta");
    handleCommandInputChange(
      cancelledChange,
      (event) => {
        calls.push("cancel-change");
        event.preventDefault();
      },
      (value) => calls.push(`search:${value}`),
    );
    assertEquals(calls, ["change", "search:alpha", "cancel-change"]);

    const moves: string[] = [];
    const actions = {
      moveActive: (direction: string) => moves.push(direction),
      selectActive: () => {
        moves.push("select");
        return true;
      },
    };
    const down = createKeyboardEvent("ArrowDown");
    handleCommandInputKeyDown(down, undefined, actions);
    assertEquals(moves, ["next"]);
    assertEquals(down.defaultPrevented, true);

    const enter = createKeyboardEvent("Enter");
    handleCommandInputKeyDown(enter, undefined, actions);
    assertEquals(moves, ["next", "select"]);
    assertEquals(enter.defaultPrevented, true);

    const cancelledKey = createKeyboardEvent("ArrowUp");
    handleCommandInputKeyDown(
      cancelledKey,
      (event) => event.preventDefault(),
      actions,
    );
    assertEquals(moves, ["next", "select"]);

    const composing = createKeyboardEvent("ArrowUp", { composing: true });
    handleCommandInputKeyDown(composing, undefined, actions);
    assertEquals(moves, ["next", "select"]);
    assertEquals(composing.defaultPrevented, false);
  });

  it("filters rendered items as the query narrows", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);

    try {
      flushSync(() => {
        root.render(
          <Command>
            <CommandInput />
            <CommandList>
              <CommandEmpty data-empty="">Nothing found</CommandEmpty>
              <CommandItem value="Alpha">Alpha</CommandItem>
              <CommandItem value="Beta">Beta</CommandItem>
            </CommandList>
          </Command>,
        );
      });

      const input = document.querySelector<HTMLInputElement>("input");
      assert(input);
      await waitFor(() => input.getAttribute("aria-activedescendant") !== null);

      const propsKey = Object.keys(input).find((name) => name.startsWith("__reactProps$"));
      assert(propsKey, "the rendered input exposes its React props");
      const inputProps = (input as unknown as Record<string, {
        onChange?: (event: unknown) => void;
      }>)[propsKey]!;
      const type = (value: string) => {
        flushSync(() =>
          inputProps.onChange?.({
            currentTarget: { value },
            defaultPrevented: false,
            preventDefault() {},
          })
        );
      };

      type("bet");
      const [alpha, beta] = [...document.querySelectorAll<HTMLElement>("[data-command-item]")];
      assert(alpha);
      assert(beta);
      assertEquals(
        alpha.hasAttribute("hidden"),
        true,
        "non-matching items are hidden from the listbox",
      );
      assertEquals(beta.hasAttribute("hidden"), false, "the matching item stays visible");
      assertEquals(
        input.getAttribute("aria-activedescendant"),
        beta.id,
        "the active option follows the filtered set",
      );
      assertEquals(
        document.querySelector("[data-empty]"),
        null,
        "a matching query keeps the empty state hidden",
      );

      type("zzz");
      assertEquals(
        [alpha, beta].map((item) => item.hasAttribute("hidden")),
        [true, true],
        "a no-match query hides every item",
      );
      assert(
        document.querySelector("[data-empty]"),
        "a no-match query announces the empty state",
      );
    } finally {
      await unmount(root);
      restore();
    }
  });

  it("suppresses the empty state while value-less items are registered", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);

    try {
      flushSync(() => {
        root.render(
          <Command>
            <CommandInput />
            <CommandList>
              <CommandEmpty data-empty="">Nothing found</CommandEmpty>
              <CommandItem data-always="">Always available</CommandItem>
            </CommandList>
          </Command>,
        );
      });

      await waitFor(() => document.querySelector("[data-empty]") === null);
      assert(document.querySelector("[data-always]"));
    } finally {
      await unmount(root);
      restore();
    }
  });

  it("announces an empty list only after registration settles", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);

    try {
      flushSync(() => {
        root.render(
          <Command>
            <CommandInput />
            <CommandList>
              <CommandEmpty data-empty="">Nothing found</CommandEmpty>
            </CommandList>
          </Command>,
        );
      });

      assertEquals(
        document.querySelector("[data-empty]"),
        null,
        "the empty state is withheld until the item registry settles",
      );
      await waitFor(() => document.querySelector("[data-empty]") !== null);
      const empty = document.querySelector<HTMLElement>("[data-empty]");
      assert(empty);
      assertEquals(empty.getAttribute("role"), "option");
      assertEquals(empty.getAttribute("aria-disabled"), "true");
      assertEquals(empty.getAttribute("aria-live"), "polite");
    } finally {
      await unmount(root);
      restore();
    }
  });
});
