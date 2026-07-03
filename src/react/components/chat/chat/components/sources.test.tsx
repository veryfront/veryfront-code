import { renderToString } from "react-dom/server";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { Source } from "./sources.tsx";
import { Sources, useSources } from "./sources.tsx";

const sources: Source[] = [
  {
    title: "Agent guide",
    url: "/docs/guides/agents",
    score: 0.92,
    snippet: "Agents emit AG-UI events.",
  },
  {
    title: "Workflow guide",
    url: "/docs/guides/workflows",
    score: 0.76,
    snippet: "Workflows model durable steps.",
  },
];

describe("Sources", () => {
  it("renders nothing when the source list is empty", () => {
    const html = renderToString(<Sources sources={[]} />);
    assertEquals(html, "");
  });

  it("renders a numbered pill per source", () => {
    const html = renderToString(<Sources sources={sources} />);
    assertStringIncludes(html, "Agent guide");
    assertStringIncludes(html, "Workflow guide");
    assertStringIncludes(html, "flex flex-wrap gap-2");
  });
});

// The composability contract: a consuming developer must be able to recompose
// the row, and restyle a part. If these fail, `Sources` is not composable —
// these tests ARE the definition.
describe("Sources — composability contract", () => {
  it("recomposes: a caller can render Sources.Pill children directly", () => {
    const html = renderToString(
      <Sources sources={sources}>
        <Sources.List>
          <Sources.Pill source={sources[1]!} index={1} />
          <Sources.Pill source={sources[0]!} index={0} />
        </Sources.List>
      </Sources>,
    );
    // Custom order: the second source's pill renders before the first.
    assert(
      html.indexOf("Workflow guide") < html.indexOf("Agent guide"),
      "expected Workflow guide to render before Agent guide in the recomposed row",
    );
  });

  it("restyles: className on a sub-part is merged onto its wrapper", () => {
    const html = renderToString(
      <Sources sources={sources}>
        <Sources.List className="vf-custom-list-class" />
      </Sources>,
    );
    assertStringIncludes(html, "vf-custom-list-class");
  });

  it("useSources throws outside a Sources", () => {
    function Orphan() {
      useSources();
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
