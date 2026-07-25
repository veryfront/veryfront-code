import "#veryfront/schemas/_test-setup.ts";
import React from "react";
import { renderToString } from "react-dom/server";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runWithHeadCollector } from "#veryfront/react/head-collector.ts";
import { Head } from "./core.ts";

/**
 * The SSR collection pass runs synchronously in the component body, so
 * rendering `<Head>` to string inside a head collector exposes exactly the
 * tags that would reach the document `<head>`.
 */
function collectFromHead(node: React.ReactElement) {
  return runWithHeadCollector(() => {
    renderToString(node);
  });
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

describe("Head SSR collection", () => {
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
});
