import "#veryfront/schemas/_test-setup.ts";
import React from "react";
import { renderToString } from "react-dom/server";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  deserializeManagedHeadPayload,
  HEAD_SSR_PAYLOAD_ATTRIBUTE,
} from "#veryfront/html/managed-head-protocol.ts";
import { Head } from "./core.ts";

/**
 * Reads the client transport payload to exercise Head normalization. The HTML
 * generator separately requires a request-scoped commit registration before
 * treating any serialized payload as trusted server head state.
 */
function collectFromHead(node: React.ReactElement) {
  const html = renderToString(node);
  const payload = html.match(
    new RegExp(`${HEAD_SSR_PAYLOAD_ATTRIBUTE}="([A-Za-z0-9_-]*)"`),
  )?.[1];
  const entries = deserializeManagedHeadPayload(payload ?? "");
  const head = {
    title: undefined as string | undefined,
    metas: [] as Record<string, string>[],
    links: [] as Record<string, string>[],
    styles: [] as Array<string | Record<string, string>>,
    scripts: [] as Record<string, string>[],
  };
  for (const entry of entries) {
    const record = Object.fromEntries(entry.attributes) as Record<string, string>;
    if (entry.content !== undefined) record.content = entry.content;
    switch (entry.tagName) {
      case "title":
        head.title = entry.content ?? "";
        break;
      case "meta":
        head.metas.push(record);
        break;
      case "link":
        head.links.push(record);
        break;
      case "style":
        head.styles.push(entry.attributes.length === 0 ? (entry.content ?? "") : record);
        break;
      case "script":
        head.scripts.push(record);
        break;
    }
  }
  return { head, html };
}

/**
 * Builds a `React.Fragment` element. Written with `createElement` rather than
 * `<>…</>` so the tests exercise fragment *unwrapping* without tripping the
 * `jsx-no-useless-fragment` lint (which — correctly, for production code —
 * objects to the very fragment shape under test here).
 */
function frag(key: string, ...children: React.ReactNode[]) {
  return React.createElement(React.Fragment, { key }, ...children);
}

describe("Head SSR committed payload", () => {
  it("collects direct children and .map() output", async () => {
    const multi = ["one", "two", "three"];
    const { head } = await collectFromHead(
      <Head>
        <meta name="sibling" content="direct" />
        {multi.map((t) => <meta key={t} name={`multi-${t}`} content={t} />)}
      </Head>,
    );

    const names = head.metas.map((m) => m.name);
    assertEquals(names.includes("sibling"), true);
    assertEquals(names.includes("multi-one"), true);
    assertEquals(names.includes("multi-two"), true);
    assertEquals(names.includes("multi-three"), true);
  });

  it("unwraps fragment-wrapped children (#210)", async () => {
    const { head } = await collectFromHead(
      <Head>
        <meta name="frag-sibling" content="direct" />
        {frag(
          "group",
          <meta key="a" name="frag-a" content="A" />,
          <meta key="b" name="frag-b" content="B" />,
        )}
      </Head>,
    );

    const names = head.metas.map((m) => m.name);
    assertEquals(names.includes("frag-sibling"), true);
    assertEquals(names.includes("frag-a"), true);
    assertEquals(names.includes("frag-b"), true);
  });

  it("unwraps nested fragments", async () => {
    const { head } = await collectFromHead(
      <Head>
        <meta name="direct" content="D" />
        {frag(
          "outer-group",
          <meta key="o" name="outer" content="O" />,
          frag(
            "inner-group",
            <meta key="ia" name="inner-a" content="IA" />,
            <meta key="ib" name="inner-b" content="IB" />,
          ),
        )}
      </Head>,
    );

    const names = head.metas.map((m) => m.name);
    assertEquals(names.includes("direct"), true);
    assertEquals(names.includes("outer"), true);
    assertEquals(names.includes("inner-a"), true);
    assertEquals(names.includes("inner-b"), true);
  });

  it("collects conditional fragment groups", async () => {
    const show = true;
    const { head } = await collectFromHead(
      <Head>
        {show &&
          frag(
            "cond",
            <meta key="og" property="og:title" content="Conditional" />,
            <link key="c" rel="canonical" href="https://example.com/x" />,
          )}
      </Head>,
    );

    assertEquals(head.metas.some((m) => m.property === "og:title"), true);
    assertEquals(head.links.some((l) => l.rel === "canonical"), true);
  });

  it("uses the shared attribute/content protocol for SSR collection", async () => {
    const { head } = await collectFromHead(
      <Head>
        <meta
          name="robots"
          content=""
          onLoad={() => {
            throw new Error("must not serialize");
          }}
        />
        <link
          rel="preload"
          href="/font.woff2"
          crossOrigin="anonymous"
          onLoad={() => {
            throw new Error("must not serialize");
          }}
        />
        <style media="print" dangerouslySetInnerHTML={{ __html: ".print{}" }} />
        <script
          id="boot"
          src="/boot.js"
          async={false}
          defer
          onLoad={() => {
            throw new Error("must not serialize");
          }}
          data-vf-react-head-owner="spoofed"
        />
      </Head>,
    );

    assertEquals(head.metas, [{ name: "robots", content: "" }]);
    assertEquals(head.links, [{
      crossorigin: "anonymous",
      href: "/font.woff2",
      rel: "preload",
    }]);
    assertEquals(head.styles, [{
      media: "print",
      content: ".print{}",
    }]);
    assertEquals(head.scripts, [{
      defer: "",
      id: "boot",
      src: "/boot.js",
    }]);
  });

  it("joins primitive child arrays for title and style content", async () => {
    const { head } = await collectFromHead(
      <Head>
        <title>{["Hello", " ", 42]}</title>
        <style>{[".a{", "color:red", "}"]}</style>
      </Head>,
    );

    assertEquals(head.title, "Hello 42");
    assertEquals(head.styles, [".a{color:red}"]);
  });

  it("keeps charset shell-owned and preserves absent meta content", async () => {
    const { head } = collectFromHead(
      <Head>
        <meta charSet="utf-8" />
        <meta name="custom-flag" />
      </Head>,
    );

    assertEquals(head.metas, [{ name: "custom-flag" }]);
  });
});
