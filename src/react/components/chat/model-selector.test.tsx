import { renderToString } from "react-dom/server";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ModelOption, ModelSelectorProps } from "./model-selector.tsx";
import { ModelSelector, useModelSelector } from "./model-selector.tsx";

const models: ModelOption[] = [
  { value: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4", provider: "anthropic" },
  { value: "openai/gpt-4o", label: "GPT-4o", provider: "openai" },
];

// NOTE: the popover surface (Content / List / Item) portals through `Floating`
// into the DOM, so it does NOT appear in `renderToString` output. These tests
// exercise the parts that DO render server-side — the trigger, the provider,
// and the hook-throws contract. See the reported limitation.

describe("ModelSelector preset", () => {
  it("renders the pill trigger with the selected model label", () => {
    const html = renderToString(
      <ModelSelector
        models={models}
        value="anthropic/claude-sonnet-4"
        onChange={() => {}}
      />,
    );
    assertStringIncludes(html, "Claude Sonnet 4");
  });

  it("renders the icon trigger with an aria-label", () => {
    const html = renderToString(
      <ModelSelector
        models={models}
        value="openai/gpt-4o"
        onChange={() => {}}
        variant="icon"
      />,
    );
    assertStringIncludes(html, "GPT-4o");
  });

  it("accepts the canonical collection item renderer", () => {
    const renderItem: NonNullable<ModelSelectorProps["renderItem"]> = ({ item, index }) => (
      <span>{index}: {item.label}</span>
    );
    const html = renderToString(
      <ModelSelector
        models={models}
        value="openai/gpt-4o"
        onChange={() => {}}
        renderItem={renderItem}
      />,
    );
    assertStringIncludes(html, "GPT-4o");
  });
});

describe("ModelSelector — composability contract", () => {
  it("recomposes: a caller can supply their own Trigger + Content", () => {
    const html = renderToString(
      <ModelSelector
        models={models}
        value="anthropic/claude-sonnet-4"
        onChange={() => {}}
      >
        <ModelSelector.Trigger />
        <ModelSelector.Content>
          <ModelSelector.Search />
          <ModelSelector.List>
            <ModelSelector.Item model={models[0]!} />
          </ModelSelector.List>
        </ModelSelector.Content>
      </ModelSelector>,
    );
    // Only the (non-portalled) trigger renders server-side.
    assertStringIncludes(html, "Claude Sonnet 4");
  });

  it("restyles: className on the Trigger is merged onto the pill", () => {
    const html = renderToString(
      <ModelSelector
        models={models}
        value="anthropic/claude-sonnet-4"
        onChange={() => {}}
      >
        <ModelSelector.Trigger className="vf-custom-trigger-class" />
      </ModelSelector>,
    );
    assertStringIncludes(html, "vf-custom-trigger-class");
  });

  it("exposes every documented sub-part off the compound", () => {
    for (const part of ["Root", "Trigger", "Content", "Search", "List", "Item"]) {
      assertEquals(
        typeof (ModelSelector as unknown as Record<string, unknown>)[part] !==
          "undefined",
        true,
      );
    }
  });

  it("useModelSelector throws outside a ModelSelector", () => {
    function Orphan() {
      useModelSelector();
      return null;
    }
    let threw = false;
    try {
      renderToString(<Orphan />);
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  });
});
