import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RSCNode } from "./types.ts";
import {
  encodeClientBoundaryChildren,
  materializeClientBoundaryChildren,
  parseClientBoundaryChildren,
} from "./client-boundary-payload.ts";

describe("rendering/rsc/client-boundary-payload", () => {
  it("round-trips the versioned recursive child payload", () => {
    const nodes: RSCNode[] = [{
      type: "server",
      component: "section",
      props: { className: "content" },
      children: [
        { type: "html", text: "server text" },
        {
          type: "client",
          component: "NestedClient",
          props: { count: 2 },
          children: [{ type: "html", text: "nested text" }],
        },
      ],
    }];

    assertEquals(parseClientBoundaryChildren(encodeClientBoundaryChildren(nodes)), nodes);
  });

  it("materializes nested server and client elements through the supplied runtime", async () => {
    const nodes: RSCNode[] = [{
      type: "server",
      component: "section",
      props: { id: "server" },
      children: [
        { type: "html", text: "before" },
        {
          type: "client",
          component: "NestedClient",
          props: { count: 2 },
          children: [{ type: "html", text: "inside" }],
        },
      ],
    }];
    const created: unknown[] = [];
    const runtime = {
      Fragment: "Fragment",
      createElement(type: unknown, props: Record<string, unknown>, ...children: unknown[]) {
        const element = { type, props, children };
        created.push(element);
        return element;
      },
    };

    const children = await materializeClientBoundaryChildren(
      nodes,
      runtime,
      async (componentId) => componentId === "NestedClient" ? "NestedClientImpl" : null,
    );

    assertEquals(children, [{
      type: "section",
      props: { id: "server" },
      children: [
        "before",
        {
          type: "NestedClientImpl",
          props: { count: 2 },
          children: ["inside"],
        },
      ],
    }]);
    assertEquals(created.length, 2);
  });

  it("rejects malformed or unsupported payloads", () => {
    assertEquals(parseClientBoundaryChildren("not json"), []);
    assertEquals(parseClientBoundaryChildren('{"version":2,"nodes":[]}'), []);
    assertEquals(
      parseClientBoundaryChildren('{"version":1,"nodes":[{"type":"script"}]}'),
      [],
    );
  });

  it("rejects payloads that exceed the serialized byte budget before parsing", () => {
    const oversized = JSON.stringify({
      version: 1,
      nodes: [{ type: "html", text: "x".repeat(2 * 1024 * 1024) }],
    });

    assertEquals(parseClientBoundaryChildren(oversized), []);
    assertThrows(
      () =>
        encodeClientBoundaryChildren([{
          type: "html",
          text: "x".repeat(2 * 1024 * 1024),
        }]),
      RangeError,
      "byte limit",
    );
  });

  it("rejects oversized and over-deep node trees", () => {
    const oversizedNodes = Array.from(
      { length: 10_001 },
      (): RSCNode => ({ type: "html", text: "" }),
    );
    assertEquals(
      parseClientBoundaryChildren(JSON.stringify({ version: 1, nodes: oversizedNodes })),
      [],
    );
    assertThrows(
      () => encodeClientBoundaryChildren(oversizedNodes),
      RangeError,
      "node limit",
    );

    const root: RSCNode = { type: "fragment", children: [] };
    let cursor = root;
    for (let depth = 0; depth < 65; depth += 1) {
      const child: RSCNode = { type: "fragment", children: [] };
      cursor.children = [child];
      cursor = child;
    }

    assertEquals(
      parseClientBoundaryChildren(JSON.stringify({ version: 1, nodes: [root] })),
      [],
    );
    assertThrows(
      () => encodeClientBoundaryChildren([root]),
      RangeError,
      "depth limit",
    );
  });

  it("never invokes payload or prop accessors while encoding", () => {
    let getterCalls = 0;
    const props = Object.defineProperty({}, "secret", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "leaked";
      },
    });

    assertThrows(
      () =>
        encodeClientBoundaryChildren([{
          type: "client",
          component: "Counter",
          props,
        }]),
      TypeError,
      "data properties",
    );
    assertEquals(getterCalls, 0);
  });

  it("bounds client component resolution instead of creating unbounded work", async () => {
    const nodes = Array.from(
      { length: 32 },
      (_, index): RSCNode => ({
        type: "client",
        component: `Client${index}`,
      }),
    );
    let active = 0;
    let peak = 0;

    const children = await materializeClientBoundaryChildren(
      nodes,
      {
        Fragment: "Fragment",
        createElement(type) {
          return type;
        },
      },
      async (componentId) => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
        return componentId;
      },
    );

    assertEquals(children.length, 32);
    assertEquals(peak, 1);
  });

  it("validates direct materialization input before resolving components", async () => {
    let resolutions = 0;

    await assertRejects(
      () =>
        materializeClientBoundaryChildren(
          [{ type: "client", component: "" }],
          {
            Fragment: "Fragment",
            createElement() {
              return null;
            },
          },
          async () => {
            resolutions += 1;
            return null;
          },
        ),
      TypeError,
      "component identifier",
    );
    assertEquals(resolutions, 0);
  });
});
