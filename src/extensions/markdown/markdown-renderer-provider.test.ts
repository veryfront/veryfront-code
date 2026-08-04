import { assertEquals, assertThrows } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  createMarkdownRendererProvider,
  snapshotMarkdownRendererProvider,
} from "./markdown-renderer-provider.ts";

function Renderer(): null {
  return null;
}

describe("createMarkdownRendererProvider", () => {
  it("accepts a component renderer and freezes the provider", () => {
    const provider = createMarkdownRendererProvider("ext-markdown-react", Renderer);

    assertEquals(provider.id, "ext-markdown-react");
    assertEquals(provider.renderer, Renderer);
    assertEquals(Object.isFrozen(provider), true);
  });

  it("rejects a null renderer", () => {
    // `typeof null === "object"`, so null must be rejected explicitly rather
    // than registering a provider that can never render.
    assertThrows(
      () => createMarkdownRendererProvider("ext-broken", null),
      TypeError,
      "must supply a React component",
    );
  });

  it("rejects a non-component renderer", () => {
    assertThrows(
      () => createMarkdownRendererProvider("ext-broken", "renderer"),
      TypeError,
      "must supply a React component",
    );
  });

  it("rejects an empty id", () => {
    assertThrows(
      () => createMarkdownRendererProvider("  ", Renderer),
      TypeError,
      "non-empty id",
    );
  });

  it("snapshots a provider without exposing the component", () => {
    const snapshot = snapshotMarkdownRendererProvider(
      createMarkdownRendererProvider("ext-markdown-react", Renderer),
    );

    assertEquals(snapshot, { id: "ext-markdown-react", hasRenderer: true });
  });
});
