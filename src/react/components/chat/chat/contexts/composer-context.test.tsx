import { renderToString } from "react-dom/server";
import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  ComposerContextProvider,
  useChatInputContext,
  useComposerContext,
  useComposerContextOptional,
} from "./composer-context.tsx";
import type { ComposerContextValue } from "./composer-context.tsx";

const fakeContext: ComposerContextValue = {
  input: "draft message",
  setInput: () => {},
  onChange: () => {},
  attachments: [],
  onSubmit: () => {},
  isLoading: false,
  canSubmit: true,
  isListening: false,
  models: [],
};

describe("ComposerContextProvider / useComposerContext", () => {
  it("supplies the provided value to a descendant", () => {
    function Consumer() {
      const ctx = useComposerContext();
      return <div data-can-submit={String(ctx.canSubmit)}>{ctx.input}</div>;
    }
    const html = renderToString(
      <ComposerContextProvider value={fakeContext}>
        <Consumer />
      </ComposerContextProvider>,
    );
    assertStringIncludes(html, "draft message");
    assertStringIncludes(html, 'data-can-submit="true"');
  });

  it("fails fast when used outside a Composer", () => {
    function Orphan() {
      useComposerContext();
      return null;
    }
    let threw = false;
    try {
      renderToString(<Orphan />);
    } catch {
      threw = true;
    }
    assert(threw, "a misplaced useComposerContext is a loud error, not silent");
  });

  it("names the canonical hook and provider in missing-context errors", () => {
    function Orphan() {
      useChatInputContext();
      return null;
    }
    let detail = "";
    try {
      renderToString(<Orphan />);
    } catch (error) {
      detail = String(error);
    }
    assertStringIncludes(
      detail,
      "useChatInputContext must be used within a ChatInput or Chat component",
    );
  });

  it("useComposerContextOptional returns null outside a provider, without throwing", () => {
    function OptionalConsumer() {
      const ctx = useComposerContextOptional();
      return <div data-has-context={String(ctx !== null)} />;
    }
    const html = renderToString(<OptionalConsumer />);
    assertStringIncludes(html, 'data-has-context="false"');
  });
});
