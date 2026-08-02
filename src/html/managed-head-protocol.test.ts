import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  aggregateManagedHeadDescriptors,
  descriptorFromHeadProps,
  descriptorFromManagedHeadRecord,
  descriptorFromManagedHeadTransportEntry,
  deserializeManagedHeadPayload,
  escapeManagedHeadRawText,
  managedHeadContentHash,
  managedHeadDescriptorToTransportEntry,
  MAX_MANAGED_HEAD_ENTRIES,
  serializeManagedHeadPayload,
} from "./managed-head-protocol.ts";

describe("managed head protocol", () => {
  it("normalizes React host props identically for SSR and the client", () => {
    const descriptor = descriptorFromHeadProps("SCRIPT", {
      id: "analytics",
      src: "/analytics.js",
      async: false,
      defer: "defer",
      crossOrigin: "anonymous",
      "aria-hidden": true,
      "data-enabled": false,
      onLoad: () => {},
      onload: "alert(1)",
      "DATA-VF-HEAD": "spoofed",
      "data-vf-react-head-owner": "spoofed",
      children: ["const a=1;", null, "const b=2;"],
    });

    assertEquals(descriptor?.tagName, "script");
    assertEquals(descriptor?.attributes, [
      ["aria-hidden", "true"],
      ["crossorigin", "anonymous"],
      ["data-enabled", "false"],
      ["defer", ""],
      ["id", "analytics"],
      ["src", "/analytics.js"],
    ]);
    assertEquals(descriptor?.content, "const a=1;const b=2;");
    assertEquals(descriptor?.scriptKeys, [
      "script:id:analytics",
      "script:src:/analytics.js",
    ]);
  });

  it("joins primitive title/style child arrays without serializing React objects", () => {
    const title = descriptorFromHeadProps("title", {
      children: ["A", 2, false, ["B", null]],
    });
    const style = descriptorFromHeadProps("style", {
      children: [".a{", "color:red", "}"],
    });

    assertEquals(title?.content, "A2B");
    assertEquals(style?.content, ".a{color:red}");
  });

  it("uses last-wins singletons and either script identity alias", () => {
    const descriptors = [
      descriptorFromHeadProps("title", { children: "Layout" }),
      descriptorFromHeadProps("script", { id: "a", src: "/shared.js" }),
      descriptorFromHeadProps("title", { children: "Page" }),
      descriptorFromHeadProps("script", { id: "b", src: "/shared.js" }),
      descriptorFromHeadProps("script", { id: "a", src: "/other.js" }),
    ].filter((value): value is NonNullable<typeof value> => value !== null);

    const result = aggregateManagedHeadDescriptors(descriptors);
    assertEquals(result.map((descriptor) => descriptor.tagName), [
      "title",
      "script",
    ]);
    assertEquals(result[0]?.content, "Page");
    assertEquals(result[1]?.attributes, [
      ["id", "a"],
      ["src", "/shared.js"],
    ]);
  });

  it("normalizes semantic singleton values and scopes theme colors by media", () => {
    const descriptors = [
      descriptorFromHeadProps("meta", {
        name: "Viewport",
        content: "width=400",
      }),
      descriptorFromHeadProps("meta", {
        name: "viewport",
        content: "width=900",
      }),
      descriptorFromHeadProps("meta", {
        name: "theme-color",
        content: "white",
      }),
      descriptorFromHeadProps("meta", {
        name: "THEME-COLOR",
        content: "black",
        media: "(prefers-color-scheme: dark)",
      }),
      descriptorFromHeadProps("meta", {
        name: "theme-color",
        content: "blue",
      }),
      descriptorFromHeadProps("link", {
        rel: "CANONICAL",
        href: "https://example.com/old",
      }),
      descriptorFromHeadProps("link", {
        rel: "canonical",
        href: "https://example.com/current",
      }),
    ].filter((value): value is NonNullable<typeof value> => value !== null);

    const result = aggregateManagedHeadDescriptors(descriptors);
    assertEquals(
      result.map((descriptor) => descriptor.singletonKey),
      [
        "meta:viewport",
        "meta:theme-color:",
        "meta:theme-color:(prefers-color-scheme: dark)",
        "link:canonical",
      ],
    );
    assertEquals(
      result.map((descriptor) => descriptor.attributes),
      [
        [["content", "width=900"], ["name", "viewport"]],
        [["content", "blue"], ["name", "theme-color"]],
        [
          ["content", "black"],
          ["media", "(prefers-color-scheme: dark)"],
          ["name", "THEME-COLOR"],
        ],
        [
          ["href", "https://example.com/current"],
          ["rel", "canonical"],
        ],
      ],
    );
  });

  it("keeps charset shell-owned and rejects unsupported host tags", () => {
    assertEquals(
      descriptorFromHeadProps("meta", { charSet: "utf-8" }),
      null,
    );
    assertEquals(
      descriptorFromHeadProps("meta", {
        httpEquiv: "Content-Type",
        content: "text/html; charset=windows-1252",
      }),
      null,
    );
    assertEquals(
      descriptorFromManagedHeadRecord("meta", {
        "HTTP-EQUIV": "content-type",
        content: "text/html; charset=ISO-8859-1",
      }),
      null,
    );
    assertEquals(
      descriptorFromHeadProps("base", { href: "https://example.com/" }),
      null,
    );
    assertEquals(descriptorFromHeadProps("meta", {}), null);
    assertEquals(descriptorFromHeadProps("link", {}), null);
  });

  it("lets the response nonce override an authored script or style nonce", () => {
    const descriptor = descriptorFromHeadProps(
      "style",
      { nonce: "authored", children: ".safe{}" },
      "response",
    );

    assertEquals(descriptor?.attributes, [["nonce", "response"]]);
  });

  it("does not grant the ambient nonce to external scripts", () => {
    const descriptor = descriptorFromHeadProps(
      "script",
      { nonce: "authored", src: "https://cdn.example/app.js" },
      "response",
    );

    assertEquals(descriptor?.attributes, [["src", "https://cdn.example/app.js"]]);
  });

  it("treats an empty src attribute as external for nonce purposes", () => {
    const descriptor = descriptorFromHeadProps("script", { src: "" }, "response");

    assertEquals(descriptor?.attributes, [["src", ""]]);
  });

  it("normalizes font preload CORS semantics for both runtimes", () => {
    const descriptor = descriptorFromHeadProps("link", {
      rel: "preload",
      as: "font",
      href: "/font.woff2",
    });

    assertEquals(descriptor?.attributes, [
      ["as", "font"],
      ["crossorigin", "anonymous"],
      ["href", "/font.woff2"],
      ["rel", "preload"],
    ]);
  });

  it("normalizes HTML parser newlines in attributes and raw text", () => {
    const meta = descriptorFromHeadProps("meta", {
      name: "author",
      content: "A\r\nB\rC",
    });
    const style = descriptorFromHeadProps("style", {
      children: ".a{\r\ncolor:red\r}",
    });

    assertEquals(meta?.attributes, [
      ["content", "A\nB\nC"],
      ["name", "author"],
    ]);
    assertEquals(style?.content, ".a{\ncolor:red\n}");
  });

  it("canonicalizes raw-text closing tags and hashes deterministically", () => {
    assertEquals(
      escapeManagedHeadRawText('x="</ScRiPt>";', "script"),
      'x="<\\/ScRiPt>";',
    );
    assertEquals(
      escapeManagedHeadRawText('x="</STYLE>";', "style"),
      'x="<\\/STYLE>";',
    );
    assertEquals(managedHeadContentHash("same"), managedHeadContentHash("same"));
  });

  it("ignores malformed, event, and framework-owned attribute names", () => {
    const descriptor = descriptorFromHeadProps("meta", {
      name: "description",
      content: "safe",
      "bad name": "ignored",
      onload: "ignored",
      "data-vf-shell-head": "spoofed",
      "data-vf-route-head": "spoofed",
      "data-vf-server-head-commit": "spoofed",
    });

    assertEquals(descriptor?.attributes, [
      ["content", "safe"],
      ["name", "description"],
    ]);
  });

  it("fails closed without invoking prop or raw-content accessors", () => {
    let propAccessorCalls = 0;
    const props = { name: "description" } as Record<string, unknown>;
    Object.defineProperty(props, "content", {
      enumerable: true,
      get() {
        propAccessorCalls++;
        return "unsafe";
      },
    });

    let rawAccessorCalls = 0;
    const raw = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(raw, "__html", {
      enumerable: true,
      get() {
        rawAccessorCalls++;
        return "unsafe";
      },
    });

    assertEquals(descriptorFromHeadProps("meta", props), null);
    assertEquals(
      descriptorFromManagedHeadRecord("script", raw, {
        contentProperty: "__html",
      }),
      null,
    );
    assertEquals(
      descriptorFromHeadProps("script", { dangerouslySetInnerHTML: raw }),
      null,
    );
    assertEquals(propAccessorCalls, 0);
    assertEquals(rawAccessorCalls, 0);
  });

  it("rejects oversized records, values, and cyclic child trees", () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: 129 }, (_, index) => [`data-${index}`, "x"]),
    );
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);

    assertEquals(descriptorFromHeadProps("meta", tooMany), null);
    assertEquals(
      descriptorFromHeadProps("meta", {
        name: "description",
        content: "x".repeat(64 * 1024 + 1),
      }),
      null,
    );
    assertEquals(descriptorFromHeadProps("title", { children: cyclic }), null);
  });

  it("round-trips transport payloads without carrying response nonces", () => {
    const descriptors = [
      descriptorFromHeadProps("title", { children: "Route" }),
      descriptorFromHeadProps("style", { nonce: "response-a", children: ".route{}" }),
      descriptorFromHeadProps("script", { nonce: "response-a", src: "/route.js" }),
    ].filter((value): value is NonNullable<typeof value> => value !== null);

    const restored = deserializeManagedHeadPayload(
      serializeManagedHeadPayload(descriptors),
      "response-b",
    );

    assertEquals(restored.map(managedHeadDescriptorToTransportEntry), [
      { tagName: "title", attributes: [], content: "Route" },
      { tagName: "style", attributes: [], content: ".route{}" },
      { tagName: "script", attributes: [["src", "/route.js"]] },
    ]);
    assertEquals(restored[1]?.attributes, [["nonce", "response-b"]]);
    assertEquals(restored[2]?.attributes, [["src", "/route.js"]]);
  });

  it("rejects non-canonical transport entries and base64url encodings", () => {
    assertThrows(
      () =>
        descriptorFromManagedHeadTransportEntry({
          tagName: "meta",
          attributes: [["Name", "description"]],
        }),
      TypeError,
      "not canonical",
    );
    assertThrows(
      () =>
        descriptorFromManagedHeadTransportEntry({
          tagName: "script",
          attributes: [["nonce", "stale"]],
        }),
      TypeError,
      "not canonical",
    );
    assertThrows(
      () => deserializeManagedHeadPayload("Zh"),
      TypeError,
      "non-canonical trailing bits",
    );
  });

  it("enforces aggregate entry and byte budgets", () => {
    const entries = Array.from(
      { length: MAX_MANAGED_HEAD_ENTRIES + 1 },
      (_, index) =>
        descriptorFromHeadProps("meta", {
          name: `repeatable-${index}`,
          content: String(index),
        }),
    ).filter((value): value is NonNullable<typeof value> => value !== null);
    assertThrows(
      () => serializeManagedHeadPayload(entries),
      TypeError,
      "entry request limit",
    );

    const large = ["a", "b", "c"].map((prefix) =>
      descriptorFromHeadProps("style", {
        children: prefix + "x".repeat(800_000),
      })
    ).filter((value): value is NonNullable<typeof value> => value !== null);
    assertThrows(
      () => serializeManagedHeadPayload(large),
      TypeError,
      "byte request limit",
    );
  });
});
