import "#veryfront/schemas/_test-setup.ts";
import "../../plugins/__tests__/code-parser-setup.ts";
import * as babelTypes from "npm:@babel/types@7.29.0";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { CodeParser } from "#veryfront/extensions/parser/index.ts";
import {
  DEFAULT_REFERENCE_CLASS,
  DEFAULT_TS_REFERENCE_CLASS,
  isReferenceChildKey,
  NODE_REFERENCE_CLASSES,
  referenceChildren,
  referenceClassOf,
  unclassifiedNodeTypes,
} from "./reference-classification.ts";

/**
 * The specifiers this test pins.
 *
 * `@babel/types` is the guard's oracle: it defines the node types the
 * classification has to cover. `@babel/parser` is what actually EMITS the nodes
 * the walkers meet, and the manifest pins the two separately, so they can drift
 * apart. A parser-only bump is the dangerous half: a new `TS`-prefixed node
 * type would reach `DEFAULT_TS_REFERENCE_CLASS`, be treated as erased, and its
 * identifiers would stop keeping bindings alive. That is the over-DELETE
 * direction, and the oracle would stay green because `@babel/types` never
 * moved.
 *
 * So both pins are asserted. Bumping either one in the manifest must fail here,
 * and whoever bumps it has to re-run the guard against the new package rather
 * than discover the gap in a browser.
 */
const PINNED_BABEL_TYPES = "npm:@babel/types@7.29.0";
const PINNED_BABEL_PARSER = "npm:@babel/parser@7.29.2";

/** Paths that cover every branch of the parser extension's plugin choice. */
const PARSER_PATHS: readonly (string | undefined)[] = [
  "page.tsx",
  "page.ts",
  "page.jsx",
  "page.js",
  "page.mjs",
  "page.cjs",
  "page.md",
  "page.mdx",
  undefined,
];

/** TypeScript-only syntax. Flow has no `satisfies`. */
const TYPESCRIPT_ONLY = "const a = 1 satisfies number;";

/** Flow-only syntax. TypeScript has no `opaque type` and no `%checks`. */
const FLOW_ONLY: readonly string[] = [
  "opaque type A = number;",
  "declare module.exports: number;",
];

function codeParser(): CodeParser {
  const found = tryResolve<CodeParser>("CodeParser");
  if (!found) throw new Error("no CodeParser extension is registered");
  return found;
}

/** Whether the parser accepts `code` on the plugin set it picks for `filePath`. */
async function parses(code: string, filePath: string | undefined): Promise<boolean> {
  try {
    await codeParser().parse({ code, filePath });
    return true;
  } catch {
    return false;
  }
}

const EXTENSION_MANIFEST = new URL(
  "../../../../extensions/ext-parser-babel/deno.json",
  import.meta.url,
);

/**
 * Every node type the pinned `@babel/types` defines, minus the two families
 * this pass can never meet.
 *
 * Flow nodes need the `flow` parser plugin, which `pickPlugins` in
 * `extensions/ext-parser-babel/src/parser-only.ts` never enables: it always
 * enables `typescript`, and the two plugins are mutually exclusive. The
 * deprecated aliases (`NumberLiteral`, `RestProperty`, …) are builder-only
 * spellings the parser never emits.
 *
 * Everything else is in scope, including node types no enabled plugin can
 * produce today. Classifying those too is what lets this guard demand total
 * coverage of the package instead of coverage of a hand-maintained subset.
 */
function parseableNodeTypes(): string[] {
  const flow = new Set<string>(babelTypes.FLIPPED_ALIAS_KEYS.Flow ?? []);
  const deprecated = new Set(Object.keys(babelTypes.DEPRECATED_KEYS));
  return Object.keys(babelTypes.NODE_FIELDS)
    .filter((type) => !flow.has(type) && !deprecated.has(type))
    .sort();
}

describe("reference classification", () => {
  describe("guard", () => {
    // The point of the exercise. Four review rounds each found a node type
    // nobody had classified reaching a descend-into-everything fallback and
    // having its identifiers counted as runtime reads. This converts the next
    // one from a silent misclassification into a failing build: a Babel
    // upgrade that adds a node type must break here, not leak a server-only
    // module into the browser artifact.
    it("classifies every node type the pinned @babel/types defines", () => {
      const missing = unclassifiedNodeTypes(parseableNodeTypes());

      assertEquals(
        missing,
        [],
        `unclassified node types. Add each to reference-classification.ts as a ` +
          `read, an erased node or a structural one, then extend the walkers' ` +
          `tests: ${missing.join(", ")}`,
      );
    });

    // The guard is only worth as much as the package it reads, so a parser
    // upgrade that leaves this pin behind has to fail too.
    it("pins the same @babel/types the parser extension resolves", async () => {
      const manifest = JSON.parse(await Deno.readTextFile(EXTENSION_MANIFEST)) as {
        imports?: Record<string, string>;
      };

      assertEquals(manifest.imports?.["@babel/types"], PINNED_BABEL_TYPES);
    });

    // The oracle and the node source are pinned separately in the same
    // manifest, so a parser-only bump would leave this guard green while a new
    // node type fell to the erased default. Pin the parser too.
    it("pins the @babel/parser the nodes are emitted by", async () => {
      const manifest = JSON.parse(await Deno.readTextFile(EXTENSION_MANIFEST)) as {
        imports?: Record<string, string>;
      };

      assertEquals(manifest.imports?.["@babel/parser"], PINNED_BABEL_PARSER);
    });

    // `parseableNodeTypes` removes the Flow family from the guard's scope. That
    // is sound only while the parser never enables the `flow` plugin. The
    // dependency is asserted rather than described: Babel refuses to enable
    // `flow` and `typescript` together, so a path that parses TypeScript-only
    // syntax and refuses Flow-only syntax cannot be emitting Flow nodes.
    it("never enables the Flow plugin the guard's filter depends on", async () => {
      const accepted: string[] = [];
      const refused: string[] = [];

      for (const filePath of PARSER_PATHS) {
        const label = filePath ?? "no path";
        if (!await parses(TYPESCRIPT_ONLY, filePath)) refused.push(label);
        for (const code of FLOW_ONLY) {
          if (await parses(code, filePath)) accepted.push(`${label}: ${code}`);
        }
      }

      assertEquals(
        refused,
        [],
        "a path refused TypeScript-only syntax, so `typescript` is no longer always enabled",
      );
      assertEquals(
        accepted,
        [],
        "a path accepted Flow-only syntax, so the guard's Flow filter now hides " +
          "node types nobody classified",
      );
    });

    // A filter that removes nothing would make the assertion above vacuous.
    it("filters a non-empty Flow family out of the guard's scope", () => {
      const flow = new Set<string>(babelTypes.FLIPPED_ALIAS_KEYS.Flow ?? []);
      const covered = new Set(parseableNodeTypes());

      assertEquals(flow.size > 0, true, "FLIPPED_ALIAS_KEYS.Flow must not be empty");
      assertEquals(
        [...flow].some((type) => covered.has(type)),
        false,
        "a Flow node type reached the guard's scope",
      );
    });

    // A guard that cannot fail proves nothing, so assert that it reports a
    // node type the classification does not name.
    it("reports a node type the classification does not cover", () => {
      assertEquals(
        unclassifiedNodeTypes(["Identifier", "VfUnclassifiedNode", "VfUnclassifiedNode"]),
        ["VfUnclassifiedNode"],
      );
    });
  });

  describe("defaults for an unrecognised node type", () => {
    // Stated so a reader does not have to infer it: an unknown node is
    // descended into and its identifiers count, which over-retains rather than
    // over-deletes. See the justification on DEFAULT_REFERENCE_CLASS.
    it("treats an unrecognised node as structural", () => {
      assertEquals(referenceClassOf({ type: "VfUnclassifiedNode" }), DEFAULT_REFERENCE_CLASS);
      assertEquals(DEFAULT_REFERENCE_CLASS, "structural");
    });

    it("treats an unrecognised TypeScript node as erased", () => {
      assertEquals(referenceClassOf({ type: "TSVfUnclassifiedType" }), DEFAULT_TS_REFERENCE_CLASS);
      assertEquals(DEFAULT_TS_REFERENCE_CLASS, "erased");
    });

    it("descends into an unrecognised node's children", () => {
      const child = { type: "Identifier", name: "loadUser" };
      assertEquals(referenceChildren({ type: "VfUnclassifiedNode", operand: child }), [child]);
    });
  });

  describe("classification", () => {
    it("names exactly two read positions", () => {
      const reads = [...NODE_REFERENCE_CLASSES]
        .filter(([, value]) => value === "read")
        .map(([type]) => type)
        .sort();

      assertEquals(reads, ["Identifier", "JSXIdentifier"]);
    });

    // Defect 4A. `isCompatTag` is only valid for a bare JSXIdentifier that IS
    // the element name. The object of `<motion.div>` is always a binding read.
    it("reads the object of a lowercase JSX member element name", () => {
      const object = { type: "JSXIdentifier", name: "motion" };
      const property = { type: "JSXIdentifier", name: "div" };
      const member = { type: "JSXMemberExpression", object, property };

      assertEquals(referenceChildren(member), [object]);
      assertEquals(
        referenceChildren({ type: "JSXOpeningElement", name: member, attributes: [] }),
        [member],
      );
    });

    it("does not read a lowercase bare JSX element name", () => {
      const name = { type: "JSXIdentifier", name: "table" };

      assertEquals(referenceChildren({ type: "JSXOpeningElement", name, attributes: [] }), []);
      assertEquals(referenceChildren({ type: "JSXClosingElement", name }), []);
    });

    // Defect 4B. With a source, both halves of every specifier name an export
    // of the source module, not a local binding.
    it("reads no specifier of a re-export that carries a source", () => {
      const specifiers = [{
        type: "ExportSpecifier",
        local: { type: "Identifier", name: "token" },
        exported: { type: "Identifier", name: "clientToken" },
      }];
      const source = { type: "StringLiteral", value: "./client-utils.js" };

      assertEquals(referenceChildren({ type: "ExportNamedDeclaration", specifiers, source }), []);
      assertEquals(
        isReferenceChildKey({ type: "ExportNamedDeclaration", specifiers, source }, "specifiers"),
        false,
      );
    });

    it("reads the local half of an export clause with no source", () => {
      const local = { type: "Identifier", name: "token" };
      const specifier = {
        type: "ExportSpecifier",
        local,
        exported: { type: "Identifier", name: "clientToken" },
      };

      assertEquals(
        referenceChildren({ type: "ExportNamedDeclaration", specifiers: [specifier] }),
        [specifier],
      );
      assertEquals(referenceChildren(specifier), [local]);
    });

    // `export v from "./m.js"` and `export * as ns from "./m.js"`. Both carry a
    // source by construction, so the parent guard already stops the walkers,
    // but the cell is pinned so the table stays correct on its own.
    it("reads the exported name of neither default nor namespace re-export", () => {
      assertEquals(
        referenceChildren({
          type: "ExportDefaultSpecifier",
          exported: { type: "Identifier", name: "token" },
        }),
        [],
      );
      assertEquals(
        referenceChildren({
          type: "ExportNamespaceSpecifier",
          exported: { type: "Identifier", name: "token" },
        }),
        [],
      );
    });

    // These three positions hold no identifier the walkers could report, so a
    // misclassification is invisible in an artifact. Asserted here instead, so
    // the cell is still pinned.
    it("reads nothing of an export-all declaration", () => {
      assertEquals(
        referenceChildren({
          type: "ExportAllDeclaration",
          source: { type: "StringLiteral", value: "./client-utils.js" },
          attributes: [{
            type: "ImportAttribute",
            key: { type: "Identifier", name: "type" },
            value: { type: "StringLiteral", value: "json" },
          }],
        }),
        [],
      );
    });

    it("reads neither half of an import attribute", () => {
      assertEquals(
        referenceChildren({
          type: "ImportAttribute",
          key: { type: "Identifier", name: "type" },
          value: { type: "StringLiteral", value: "json" },
        }),
        [],
      );
    });

    // Neither walker hands an import statement to `referenceChildren`: both
    // skip the statement outright. The cell is pinned anyway so the table stays
    // correct for a caller that does.
    it("reads neither half of an import specifier", () => {
      assertEquals(
        referenceChildren({
          type: "ImportSpecifier",
          local: { type: "Identifier", name: "token" },
          imported: { type: "Identifier", name: "token" },
        }),
        [],
      );
      assertEquals(
        referenceChildren({
          type: "ImportDefaultSpecifier",
          local: { type: "Identifier", name: "token" },
        }),
        [],
      );
      assertEquals(
        referenceChildren({
          type: "ImportNamespaceSpecifier",
          local: { type: "Identifier", name: "token" },
        }),
        [],
      );
      assertEquals(
        referenceChildren({
          type: "ImportDeclaration",
          specifiers: [{
            type: "ImportDefaultSpecifier",
            local: { type: "Identifier", name: "token" },
          }],
          source: { type: "StringLiteral", value: "./server-only.js" },
        }),
        [],
      );
    });

    // A parsed file carries its comments and tokens beside the program, and a
    // comment is node-shaped, so descending into them would walk text.
    it("reads neither the comments nor the tokens of a parsed file", () => {
      const program = { type: "Program", body: [] };

      assertEquals(
        referenceChildren({
          type: "File",
          program,
          comments: [{ type: "CommentLine", value: " token" }],
          tokens: [{ type: "Identifier", value: "token" }],
        }),
        [program],
      );
    });

    it("reads nothing of a directive", () => {
      assertEquals(
        referenceChildren({
          type: "Directive",
          value: { type: "DirectiveLiteral", value: "use strict" },
        }),
        [],
      );
    });

    // `Placeholder.name` is an Identifier node, unlike the string-valued
    // `V8IntrinsicIdentifier.name`. No enabled parser plugin produces either,
    // but the classification covers the whole package, so the cell is pinned.
    it("reads the name of neither placeholder form", () => {
      assertEquals(
        referenceChildren({
          type: "Placeholder",
          name: { type: "Identifier", name: "token" },
        }),
        [],
      );
      assertEquals(referenceChildren({ type: "V8IntrinsicIdentifier", name: "token" }), []);
    });

    it("reads a computed member property but not a fixed one", () => {
      const object = { type: "Identifier", name: "registry" };
      const property = { type: "Identifier", name: "hashOf" };

      assertEquals(referenceChildren({ type: "MemberExpression", object, property }), [object]);
      assertEquals(
        referenceChildren({ type: "MemberExpression", object, property, computed: true }),
        [object, property],
      );
    });
  });
});
