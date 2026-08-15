import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { NumberField } from "./number-field.tsx";

function mount(props: React.ComponentProps<typeof NumberField>) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "https://example.com/",
  });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const replacements: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
  };
  for (const [key, value] of Object.entries(replacements)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value, writable: true });
  }
  const root = createRoot(document.getElementById("root")!);
  flushSync(() => root.render(<NumberField {...props} />));
  const input = document.querySelector<HTMLInputElement>('input[role="spinbutton"]');
  assert(input);
  const reactProps = () => {
    const reactPropsKey = Object.keys(input).find((key) => key.startsWith("__reactProps$"));
    assert(reactPropsKey, "React props are attached to the rendered input");
    return (input as unknown as Record<string, {
      onBlur?: (event: unknown) => void;
      onChange?: (event: unknown) => void;
      onKeyDown?: (event: unknown) => void;
    }>)[reactPropsKey];
  };
  return {
    input,
    type: (value: string) => {
      const onChange = reactProps()?.onChange;
      assert(onChange, "NumberField wires an input change handler");
      flushSync(() => onChange({ target: { value } }));
    },
    append: (text: string) => {
      const onChange = reactProps()?.onChange;
      assert(onChange, "NumberField wires an input change handler");
      flushSync(() => onChange({ target: { value: input.value + text } }));
    },
    blur: () => {
      const onBlur = reactProps()?.onBlur;
      assert(onBlur, "NumberField wires an input blur handler");
      flushSync(() => onBlur({ defaultPrevented: false, target: input }));
    },
    keyDown: (key: string) => {
      const onKeyDown = reactProps()?.onKeyDown;
      assert(onKeyDown, "NumberField wires an input keydown handler");
      flushSync(() =>
        onKeyDown({
          defaultPrevented: false,
          key,
          preventDefault() {},
        })
      );
    },
    cleanup: () => {
      root.unmount();
      for (const key of Object.keys(replacements)) {
        const descriptor = previous.get(key);
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
      }
      dom.window.close();
    },
  };
}

describe("NumberField behaviour", () => {
  it("normalizes uncontrolled defaultValue before the first render", () => {
    const stepped = mount({ defaultValue: 3, step: 5 });
    try {
      assertEquals(stepped.input.value, "5");
      assertEquals(stepped.input.getAttribute("aria-valuenow"), "5");
    } finally {
      stepped.cleanup();
    }

    const clamped = mount({ defaultValue: 15, max: 10 });
    try {
      assertEquals(clamped.input.value, "10");
      assertEquals(clamped.input.getAttribute("aria-valuenow"), "10");
    } finally {
      clamped.cleanup();
    }
  });

  it("uses a decimal input mode for fractional steps and allows overrides", () => {
    const fractional = mount({ step: 0.1 });
    try {
      assertEquals(fractional.input.getAttribute("inputmode"), "decimal");
    } finally {
      fractional.cleanup();
    }

    const whole = mount({ step: 1 });
    try {
      assertEquals(whole.input.getAttribute("inputmode"), "numeric");
    } finally {
      whole.cleanup();
    }

    const override = mount({ step: 0.1, inputMode: "text" });
    try {
      assertEquals(override.input.getAttribute("inputmode"), "text");
    } finally {
      override.cleanup();
    }
  });

  it("quantizes typed values to step relative to the minimum", () => {
    let committed: number | null | undefined;
    const h = mount({ min: 2, max: 20, step: 5, onValueChange: (value) => committed = value });
    try {
      h.type("6");
      assertEquals(committed, 7);
      assertEquals(h.input.value, "7");
    } finally {
      h.cleanup();
    }
  });

  it("rounds a typed value to the nearest step from zero when no minimum exists", () => {
    let committed: number | null | undefined;
    const h = mount({ step: 5, onValueChange: (value) => committed = value });
    try {
      h.type("3");
      assertEquals(committed, 5);
      assertEquals(h.input.value, "5");
    } finally {
      h.cleanup();
    }
  });

  it("preserves an incomplete fractional draft until the number is complete", () => {
    const committed: Array<number | null> = [];
    const h = mount({ step: 0.1, onValueChange: (value) => committed.push(value) });
    try {
      h.type("1");
      h.append(".");
      assertEquals(h.input.value, "1.", "the decimal separator remains editable");
      assertEquals(committed, [1], "an incomplete fraction does not commit");

      h.append("5");
      assertEquals(h.input.value, "1.5", "the next digit extends the fractional draft");
      assertEquals(committed, [1, 1.5], "the completed number commits once");
    } finally {
      h.cleanup();
    }
  });

  it("commits a parseable fractional draft on blur", () => {
    const committed: Array<number | null> = [];
    const h = mount({ step: 0.1, onValueChange: (value) => committed.push(value) });
    try {
      h.type("2.");
      assertEquals(h.input.value, "2.");
      assertEquals(committed, []);

      h.blur();
      assertEquals(h.input.value, "2");
      assertEquals(committed, [2]);
    } finally {
      h.cleanup();
    }
  });

  it("steps from a parseable draft and clears the draft", () => {
    const committed: Array<number | null> = [];
    const h = mount({ step: 1, onValueChange: (value) => committed.push(value) });
    try {
      h.type("2.");
      h.keyDown("ArrowUp");
      assertEquals(h.input.value, "3");
      assertEquals(committed, [3]);
    } finally {
      h.cleanup();
    }
  });
});
