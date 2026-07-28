import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  aggregateManagedHeadDescriptors,
  descriptorFromHeadProps,
  escapeManagedHeadRawText,
  managedHeadContentHash,
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
});
