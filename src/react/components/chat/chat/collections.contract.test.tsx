/**
 * Collection-conformance contract.
 *
 * Participating chat collections ship the same four access points off one
 * implementation. See
 * docs/architecture/22-chat-collection-composition-contract.md:
 *
 *   1. data hook   `useX()`      — throws outside its provider (fail-fast)
 *   2. leaf        `<X.Item>`    — one row, an addressable dumb consumer
 *   3. list        `<X.List>`    — `children ?? items.map(<X.Item/>)`
 *   4. batteries   `<X>`         — provider + default layout, zero-config
 *
 * This is the shared conformance template. `Sources` is the reference and
 * `AttachmentsPanel` proves the contract applies to a second collection.
 */
import { renderToString } from "react-dom/server";
import { assert } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { Sources, useSources } from "./components/sources.tsx";
import { AttachmentsPanel, useAttachmentsPanel } from "./components/attachments-panel.tsx";

interface CollectionSpec {
  name: string;
  // deno-lint-ignore no-explicit-any
  compound: any;
  /** The data hook that must throw outside its provider. */
  hook: () => unknown;
  /** Names of the tier-2/3 leaves that must hang off the compound. */
  leaves: string[];
  /** Render the batteries with two items whose text appears in the output. */
  renderBatteries: () => React.ReactElement;
  /** Two item labels that must appear in the batteries output. */
  expectedText: [string, string];
  /** Render the composed form with a custom leaf that outputs `marker`. */
  renderComposedCustom: (marker: string) => React.ReactElement;
}

const COLLECTIONS: CollectionSpec[] = [
  {
    name: "Sources",
    compound: Sources,
    hook: useSources,
    leaves: ["List", "Pill"],
    renderBatteries: () => <Sources sources={[{ title: "Alpha" }, { title: "Beta" }]} />,
    expectedText: ["Alpha", "Beta"],
    renderComposedCustom: (marker) => (
      <Sources.Root sources={[{ title: "Alpha" }]}>
        <Sources.List>
          <span data-marker={marker}>{marker}</span>
        </Sources.List>
      </Sources.Root>
    ),
  },
  {
    name: "AttachmentsPanel",
    compound: AttachmentsPanel,
    hook: useAttachmentsPanel,
    leaves: ["List", "Item"],
    renderBatteries: () => (
      <AttachmentsPanel
        uploads={[
          { id: "a", name: "alpha.pdf" },
          { id: "b", name: "beta.png" },
        ]}
      />
    ),
    expectedText: ["alpha.pdf", "beta.png"],
    renderComposedCustom: (marker) => (
      <AttachmentsPanel.Root uploads={[{ id: "a", name: "alpha.pdf" }]}>
        <AttachmentsPanel.List>
          <span data-marker={marker}>{marker}</span>
        </AttachmentsPanel.List>
      </AttachmentsPanel.Root>
    ),
  },
];

describe("chat collections — 4-tier conformance", () => {
  for (const spec of COLLECTIONS) {
    it(`${spec.name}: data hook throws outside its provider`, () => {
      function Orphan() {
        spec.hook();
        return null;
      }
      let threw = false;
      try {
        renderToString(<Orphan />);
      } catch {
        threw = true;
      }
      assert(threw, `use${spec.name} must fail fast outside <${spec.name}>`);
    });

    it(`${spec.name}: exposes its list + item leaves`, () => {
      for (const leaf of spec.leaves) {
        assert(
          typeof spec.compound[leaf] === "function" ||
            typeof spec.compound[leaf] === "object",
          `${spec.name}.${leaf} must be addressable`,
        );
      }
    });

    it(`${spec.name}: batteries render the items by default`, () => {
      const html = renderToString(spec.renderBatteries());
      for (const text of spec.expectedText) {
        assert(html.includes(text), `${spec.name} batteries must render "${text}"`);
      }
    });

    it(`${spec.name}: composed List renders custom children instead of the default`, () => {
      const marker = `vf-${spec.name}-custom`;
      const html = renderToString(spec.renderComposedCustom(marker));
      assert(
        html.includes(marker),
        `${spec.name}.List must render composed children`,
      );
    });
  }
});
