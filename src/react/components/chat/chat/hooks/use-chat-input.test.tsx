/**
 * `useChatInput` behaviour — the L3 headless composer hook: prop-getters wire the
 * form/field/submit, merge semantics (handler compose, className merge, consumer-
 * wins), and it throws outside a `<ChatInput>` provider.
 */
import * as React from "react";
import { renderToString } from "react-dom/server";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  ComposerContextProvider,
  type ComposerContextValue,
} from "../contexts/composer-context.tsx";
import { mergeProps, useChatInput } from "./use-chat-input.ts";

function makeCtx(over: Partial<ComposerContextValue> = {}): ComposerContextValue {
  return {
    input: "hi",
    setInput: () => {},
    onChange: () => {},
    attachments: [],
    onSubmit: () => {},
    isLoading: false,
    canSubmit: true,
    isListening: false,
    models: [],
    ...over,
  };
}

function Fixture(): React.ReactElement {
  const ci = useChatInput();
  return (
    <form {...ci.getFormProps()}>
      <textarea {...ci.getFieldProps()} />
      <button {...ci.getSubmitProps()}>Send</button>
    </form>
  );
}

describe("useChatInput", () => {
  it("getFieldProps carries the input value; getSubmitProps enables when canSubmit", () => {
    const html = renderToString(
      <ComposerContextProvider value={makeCtx()}>
        <Fixture />
      </ComposerContextProvider>,
    );
    assert(html.includes("hi"), "field renders the input value");
    assert(!html.includes("disabled"), "submit is enabled when canSubmit is true");
  });

  it("getSubmitProps disables the button when canSubmit is false", () => {
    const html = renderToString(
      <ComposerContextProvider value={makeCtx({ canSubmit: false })}>
        <Fixture />
      </ComposerContextProvider>,
    );
    assert(html.includes("disabled"), "submit is disabled when canSubmit is false");
  });

  it("getFormProps cancels the native submit before delegating to onSubmit", () => {
    let submitted = false;
    let formProps: Record<string, unknown> = {};
    function Capture() {
      formProps = useChatInput().getFormProps();
      return null;
    }
    renderToString(
      <ComposerContextProvider value={makeCtx({ onSubmit: () => submitted = true })}>
        <Capture />
      </ComposerContextProvider>,
    );

    let prevented = false;
    (formProps.onSubmit as (e: unknown) => void)({
      defaultPrevented: false,
      preventDefault: () => prevented = true,
    });
    assertEquals(prevented, true, "spread onto a real <form>, submit never navigates");
    assertEquals(submitted, true, "ctx.onSubmit still runs after preventDefault");
  });

  it("throws when used outside a <ChatInput> provider", () => {
    function Orphan() {
      useChatInput();
      return null;
    }
    let threw = false;
    try {
      renderToString(<Orphan />);
    } catch {
      threw = true;
    }
    assertEquals(threw, true, "useChatInput must throw outside its provider");
  });

  it("mergeProps: className concatenates via cx, consumer appended last", () => {
    const merged = String(mergeProps({ className: "p-2 text-sm" }, { className: "p-4" }).className);
    // veryfront cx = clsx (no tailwind-merge): base + consumer concatenated,
    // consumer last so it wins by source order.
    assert(merged.includes("p-2"), "base class kept");
    assert(merged.includes("text-sm"), "base class kept");
    assert(merged.includes("p-4"), "consumer class present");
    assert(
      merged.indexOf("p-4") > merged.indexOf("p-2"),
      "consumer class comes last (wins by order)",
    );
  });

  it("mergeProps: handlers compose (consumer first), preventDefault cancels internal", () => {
    const order: string[] = [];
    const base = { onClick: () => order.push("internal") };
    const composed = mergeProps(base, {
      onClick: () => {
        order.push("consumer");
      },
    });
    (composed.onClick as (e: unknown) => void)({ defaultPrevented: false });
    assertEquals(order, ["consumer", "internal"], "consumer runs first, then internal");

    order.length = 0;
    const composed2 = mergeProps(base, { onClick: () => order.push("consumer") });
    (composed2.onClick as (e: unknown) => void)({ defaultPrevented: true });
    assertEquals(order, ["consumer"], "preventDefault (defaultPrevented) cancels internal");
  });
});
