import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  MDX_SYNC_RENDER_DISABLED,
  MDXRenderer,
  mdxRenderer,
  type MDXSyncRenderResult,
} from "./index.ts";

describe("transforms/mdx/MDXRenderer", () => {
  it("marks the synchronous compatibility result as a failed render", () => {
    const result: MDXSyncRenderResult = new MDXRenderer().render(
      "export default function MDXContent() {}",
    );

    assertEquals(result.type, "div");
    assertEquals(result.props["data-veryfront-error"], MDX_SYNC_RENDER_DISABLED);
    assertEquals(result.props["data-veryfront-render-status"], "failed");
    assertEquals(result.props.role, "alert");
  });

  it("clears entries without destroying the reusable cache lifecycle", () => {
    const renderer = new MDXRenderer();
    const cache = (renderer as unknown as {
      moduleCache: { clear(): void; destroy(): void };
    }).moduleCache;
    let clearCalls = 0;
    let destroyCalls = 0;
    cache.clear = () => clearCalls++;
    cache.destroy = () => destroyCalls++;

    renderer.clearCache();

    assertEquals(clearCalls, 1);
    assertEquals(destroyCalls, 0);
  });

  it("keeps reflective definitions and property reads on the same lazy target", () => {
    const marker = Symbol("mdx-renderer-reflection");
    const renderer = mdxRenderer as unknown as Record<PropertyKey, unknown>;

    Object.defineProperty(mdxRenderer, marker, {
      configurable: true,
      enumerable: true,
      value: "defined",
      writable: true,
    });

    try {
      assertEquals(renderer[marker], "defined");
      assertEquals(Object.getOwnPropertyDescriptor(mdxRenderer, marker)?.value, "defined");
    } finally {
      Reflect.deleteProperty(mdxRenderer, marker);
    }
  });

  it("preserves the receiver when assigning through an inherited lazy renderer", () => {
    const marker = Symbol("mdx-renderer-receiver");
    const renderer = mdxRenderer as unknown as Record<PropertyKey, unknown>;
    const inheritedRenderer = Object.create(mdxRenderer) as Record<PropertyKey, unknown>;

    try {
      inheritedRenderer[marker] = "child";

      assertEquals(Object.hasOwn(inheritedRenderer, marker), true);
      assertEquals(renderer[marker], undefined);
    } finally {
      Reflect.deleteProperty(inheritedRenderer, marker);
      Reflect.deleteProperty(mdxRenderer, marker);
    }
  });
});
