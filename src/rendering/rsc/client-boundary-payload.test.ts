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

  it("rejects malformed or unsupported payloads", () => {
    assertEquals(parseClientBoundaryChildren("not json"), []);
    assertEquals(parseClientBoundaryChildren('{"version":2,"nodes":[]}'), []);
    assertEquals(
      parseClientBoundaryChildren('{"version":1,"nodes":[{"type":"script"}]}'),
      [],
    );
  });
});
