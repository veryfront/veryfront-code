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
  ChatInputContextProvider,
  type ChatInputContextValue,
} from "../contexts/composer-context.tsx";
import { mergeProps, useChatInput } from "./use-chat-input.ts";

function makeCtx(over: Partial<ChatInputContextValue> = {}): ChatInputContextValue {
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
      <ChatInputContextProvider value={makeCtx()}>
        <Fixture />
      </ChatInputContextProvider>,
    );
    assert(html.includes("hi"), "field renders the input value");
    assert(!html.includes("disabled"), "submit is enabled when canSubmit is true");
  });

  it("getSubmitProps disables the button when canSubmit is false", () => {
    const html = renderToString(
      <ChatInputContextProvider value={makeCtx({ canSubmit: false })}>
        <Fixture />
      </ChatInputContextProvider>,
    );
    assert(html.includes("disabled"), "submit is disabled when canSubmit is false");
  });

  it("getFieldProps mirrors loading and live dictation state", () => {
    let fieldProps: React.TextareaHTMLAttributes<HTMLTextAreaElement> = {};
    function Capture() {
      fieldProps = useChatInput().getFieldProps();
      return null;
    }

    renderToString(
      <ChatInputContextProvider
        value={makeCtx({ input: "draft", isListening: true, transcript: "live words" })}
      >
        <Capture />
      </ChatInputContextProvider>,
    );
    assertEquals(fieldProps.value, "live words");
    assertEquals(fieldProps.disabled, true);

    renderToString(
      <ChatInputContextProvider value={makeCtx({ input: "draft", isLoading: true })}>
        <Capture />
      </ChatInputContextProvider>,
    );
    assertEquals(fieldProps.value, "draft");
    assertEquals(fieldProps.disabled, true);
  });

  it("getAttachProps opens the provider-owned upload picker", () => {
    let pickerCalls = 0;
    let attachProps: React.ButtonHTMLAttributes<HTMLButtonElement> = {};
    function Capture() {
      attachProps = useChatInput().getAttachProps();
      return null;
    }
    renderToString(
      <ChatInputContextProvider
        value={makeCtx({ onOpenAttachmentPicker: () => pickerCalls += 1 })}
      >
        <Capture />
      </ChatInputContextProvider>,
    );

    Reflect.apply(attachProps.onClick!, undefined, [{ defaultPrevented: false }]);
    assertEquals(pickerCalls, 1);
  });

  it("exposes attachment availability and fails closed when no action exists", () => {
    let result: ReturnType<typeof useChatInput> | undefined;
    function Capture() {
      result = useChatInput();
      return null;
    }
    const capture = (context: ChatInputContextValue) => {
      renderToString(
        <ChatInputContextProvider value={context}>
          <Capture />
        </ChatInputContextProvider>,
      );
      assert(result);
      return result;
    };

    let input = capture(makeCtx());
    let attachProps = input.getAttachProps({ disabled: false });
    assertEquals(input.canAttach, false);
    assertEquals(attachProps.disabled, true, "an unavailable attachment action stays disabled");

    let selectCalls = 0;
    input = capture(makeCtx({ onSelectAttachment: () => selectCalls += 1 }));
    attachProps = input.getAttachProps();
    assertEquals(input.canAttach, true);
    assertEquals(attachProps.disabled, false);
    Reflect.apply(attachProps.onClick!, undefined, [{ defaultPrevented: false }]);
    assertEquals(selectCalls, 1);

    attachProps = input.getAttachProps({ disabled: true });
    assertEquals(attachProps.disabled, true, "consumer-disabled attachment actions stay disabled");
  });

  it("getFormProps cancels the native submit before delegating to onSubmit", () => {
    let submitted = false;
    let formProps: React.FormHTMLAttributes<HTMLFormElement> = {};
    function Capture() {
      formProps = useChatInput().getFormProps();
      return null;
    }
    renderToString(
      <ChatInputContextProvider value={makeCtx({ onSubmit: () => submitted = true })}>
        <Capture />
      </ChatInputContextProvider>,
    );

    let prevented = false;
    Reflect.apply(formProps.onSubmit!, undefined, [{
      defaultPrevented: false,
      preventDefault: () => prevented = true,
    }]);
    assertEquals(prevented, true, "spread onto a real <form>, submit never navigates");
    assertEquals(submitted, true, "ctx.onSubmit still runs after preventDefault");
  });

  it("blocks headless form and Enter submission when canSubmit is false", () => {
    let submissions = 0;
    let formProps: React.FormHTMLAttributes<HTMLFormElement> = {};
    let fieldProps: React.TextareaHTMLAttributes<HTMLTextAreaElement> = {};
    function Capture() {
      const input = useChatInput();
      formProps = input.getFormProps();
      fieldProps = input.getFieldProps();
      return null;
    }
    renderToString(
      <ChatInputContextProvider
        value={makeCtx({ canSubmit: false, onSubmit: () => submissions += 1 })}
      >
        <Capture />
      </ChatInputContextProvider>,
    );

    let formPrevented = false;
    Reflect.apply(formProps.onSubmit!, undefined, [{
      defaultPrevented: false,
      preventDefault: () => formPrevented = true,
    }]);
    let keyPrevented = false;
    Reflect.apply(fieldProps.onKeyDown!, undefined, [{
      key: "Enter",
      shiftKey: false,
      nativeEvent: { isComposing: false },
      defaultPrevented: false,
      preventDefault: () => keyPrevented = true,
    }]);

    assertEquals(formPrevented, true, "native form submission remains cancelled");
    assertEquals(keyPrevented, false, "a blocked Enter does not claim submission");
    assertEquals(submissions, 0, "blocked getters never delegate submission");
  });

  it("does not submit Enter while any browser IME composition signal is active", () => {
    let submissions = 0;
    let fieldProps: React.TextareaHTMLAttributes<HTMLTextAreaElement> = {};
    function Capture() {
      fieldProps = useChatInput().getFieldProps();
      return null;
    }
    renderToString(
      <ChatInputContextProvider value={makeCtx({ onSubmit: () => submissions += 1 })}>
        <Capture />
      </ChatInputContextProvider>,
    );

    const compositionSignals = [
      { nativeEvent: { isComposing: true } },
      { nativeEvent: { isComposing: false }, isComposing: true },
      { nativeEvent: { isComposing: false }, keyCode: 229 },
    ];
    for (const signal of compositionSignals) {
      let prevented = false;
      Reflect.apply(fieldProps.onKeyDown!, undefined, [{
        key: "Enter",
        shiftKey: false,
        defaultPrevented: false,
        preventDefault: () => prevented = true,
        ...signal,
      }]);
      assertEquals(prevented, false, "IME Enter remains available to finish composition");
    }
    assertEquals(submissions, 0, "no partial IME value is submitted");

    let prevented = false;
    Reflect.apply(fieldProps.onKeyDown!, undefined, [{
      key: "Enter",
      shiftKey: false,
      nativeEvent: { isComposing: false },
      defaultPrevented: false,
      preventDefault: () => prevented = true,
    }]);
    assertEquals(prevented, true, "ordinary Enter is claimed for submission");
    assertEquals(submissions, 1);
  });

  it("getVoiceProps mirrors built-in voice availability and pressed state", () => {
    let voiceCalls = 0;
    let result: ReturnType<typeof useChatInput> | undefined;
    function Capture() {
      result = useChatInput();
      return null;
    }
    const capture = (context: ChatInputContextValue) => {
      renderToString(
        <ChatInputContextProvider value={context}>
          <Capture />
        </ChatInputContextProvider>,
      );
      assert(result);
      return result;
    };

    let input = capture(makeCtx({ canSubmit: false, onVoice: () => voiceCalls += 1 }));
    let voiceProps = input.getVoiceProps();
    assertEquals(input.canUseVoice, true);
    assertEquals(voiceProps.disabled, false);
    Reflect.apply(voiceProps.onClick!, undefined, [{ defaultPrevented: false }]);
    assertEquals(voiceCalls, 1);

    input = capture(
      makeCtx({
        canSubmit: false,
        isListening: true,
        onVoice: () => voiceCalls += 1,
      }),
    );
    voiceProps = input.getVoiceProps();
    assertEquals(voiceProps["aria-pressed"], true);
    assertEquals(voiceProps["data-listening"], true);

    for (
      const unavailable of [
        makeCtx({ canSubmit: true, onVoice: () => voiceCalls += 1 }),
        makeCtx({ canSubmit: false, isLoading: true, onVoice: () => voiceCalls += 1 }),
        makeCtx({ canSubmit: false, onVoice: undefined }),
      ]
    ) {
      input = capture(unavailable);
      voiceProps = input.getVoiceProps({ disabled: false });
      assertEquals(input.canUseVoice, false);
      assertEquals(voiceProps.disabled, true, "unavailable voice cannot be re-enabled");
      Reflect.apply(voiceProps.onClick!, undefined, [{ defaultPrevented: false }]);
    }
    assertEquals(voiceCalls, 1, "unavailable controls never invoke voice input");

    input = capture(makeCtx({ canSubmit: false, onVoice: () => voiceCalls += 1 }));
    assertEquals(input.getVoiceProps({ disabled: true }).disabled, true);
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
    const base = {
      onClick: (_event: { defaultPrevented: boolean }) => order.push("internal"),
    };
    const composed = mergeProps(base, {
      onClick: (_event: { defaultPrevented: boolean }) => {
        order.push("consumer");
      },
    });
    composed.onClick({ defaultPrevented: false });
    assertEquals(order, ["consumer", "internal"], "consumer runs first, then internal");

    order.length = 0;
    const composed2 = mergeProps(base, {
      onClick: (_event: { defaultPrevented: boolean }) => order.push("consumer"),
    });
    composed2.onClick({ defaultPrevented: true });
    assertEquals(order, ["consumer"], "preventDefault (defaultPrevented) cancels internal");
  });

  it("mergeProps: undefined overrides preserve internal props", () => {
    const onSubmit = () => {};
    const base = { disabled: true, onSubmit };
    const overrides: Partial<typeof base> = { disabled: undefined, onSubmit: undefined };
    const merged = mergeProps(base, overrides);
    assertEquals(merged.disabled, true);
    assertEquals(merged.onSubmit, onSubmit);
  });
});
