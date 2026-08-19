import * as babelTypes from "npm:@babel/types@7.29.0";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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
 * The specifier this test pins. It must stay equal to the one the parser
 * extension resolves, or the guard below would certify a package the parser
 * does not use.
 */
const PINNED_BABEL_TYPES = "npm:@babel/types@7.29.0";

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

    it("reads nothing of a directive", () => {
      assertEquals(
        referenceChildren({
          type: "Directive",
          value: { type: "DirectiveLiteral", value: "use strict" },
        }),
        [],
      );
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
