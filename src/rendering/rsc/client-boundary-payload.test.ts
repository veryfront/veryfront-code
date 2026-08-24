import { assertEquals } from "#veryfront/testing/assert.ts";
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

  it("materializes fragments and component-less server nodes through runtime.Fragment", async () => {
    const nodes: RSCNode[] = [
      { type: "fragment", children: [{ type: "html", text: "a" }] },
      { type: "server", children: [{ type: "html", text: "b" }] },
    ];
    const runtime = {
      Fragment: "Fragment",
      createElement(type: unknown, props: Record<string, unknown>, ...children: unknown[]) {
        return { type, props, children };
      },
    };

    const children = await materializeClientBoundaryChildren(
      nodes,
      runtime,
      () => Promise.resolve(null),
    );

    assertEquals(
      children,
      [
        { type: "Fragment", props: {}, children: ["a"] },
        { type: "Fragment", props: {}, children: ["b"] },
      ],
      "fragment and component-less server nodes both wrap children in runtime.Fragment",
    );
  });

  it("rejects malformed or unsupported payloads", () => {
    assertEquals(parseClientBoundaryChildren("not json"), []);
    assertEquals(parseClientBoundaryChildren('{"version":2,"nodes":[]}'), []);
    assertEquals(
      parseClientBoundaryChildren('{"version":1,"nodes":[{"type":"script"}]}'),
      [],
    );
    assertEquals(
      parseClientBoundaryChildren('{"version":1,"nodes":[{"type":"client"}]}'),
      [],
      "a client node without a string component is rejected",
    );
    assertEquals(
      parseClientBoundaryChildren('{"version":1,"nodes":[{"type":"html"}]}'),
      [],
      "an html node without text or html is rejected",
    );
    assertEquals(
      parseClientBoundaryChildren('{"version":1,"nodes":[{"type":"server","component":123}]}'),
      [],
      "a server node with a non-string component is rejected",
    );
    assertEquals(
      parseClientBoundaryChildren(
        '{"version":1,"nodes":[{"type":"server","component":"div","props":[1]}]}',
      ),
      [],
      "non-record props are rejected",
    );
    assertEquals(
      parseClientBoundaryChildren(
        '{"version":1,"nodes":[{"type":"server","component":"div","children":"nope"}]}',
      ),
      [],
      "non-array children are rejected",
    );
  });

  it("rejects payloads nested past the depth cap", () => {
    function chain(length: number): RSCNode {
      let node: RSCNode = { type: "html", text: "leaf" };
      for (let i = 0; i < length - 1; i += 1) {
        node = { type: "server", component: "div", children: [node] };
      }
      return node;
    }

    // The cap counts the root as depth 0, so a 101-node chain is the deepest
    // payload hydration accepts and one more node must be rejected outright.
    const atCap = encodeClientBoundaryChildren([chain(101)]);
    const pastCap = encodeClientBoundaryChildren([chain(102)]);

    assertEquals(
      parseClientBoundaryChildren(atCap).length,
      1,
      "a payload at the depth cap still parses",
    );
    assertEquals(
      parseClientBoundaryChildren(pastCap),
      [],
      "a payload nested past the depth cap is rejected before it can blow the stack",
    );
  });
});
