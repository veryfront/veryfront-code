/** Authenticated release config must not enter tenant-modified shared intrinsics. */
import "../../_helpers/contract-init.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createStyleScopeProfile,
  filterFilesForStyleScope,
  shouldIncludeStylePath,
  shouldTraverseStyleDirectory,
} from "#veryfront/html/styles-builder/style-scope-profile.ts";
import { extractCandidatesFromFiles } from "#veryfront/html/styles-builder/candidate-extractor.ts";
import type { VeryfrontConfig } from "#veryfront/config";

const config = {
  directories: { components: ["knowledge\\release-components", "custom//components/"] },
  tailwind: { stylesheet: "/knowledge/release-style/globals.css" },
  layout: "/knowledge/release-layout/layout.tsx",
} as VeryfrontConfig;
const files = [
  {
    path: "knowledge/release-components/button.tsx",
    content: '<div className="release-component" />',
  },
  { path: "knowledge/reference.tsx", content: '<div className="excluded-reference" />' },
];

describe("authenticated release style profile intrinsic isolation", () => {
  for (const mode of ["iterator", "sort", "some", "replace", "set", "json"]) {
    it(`preserves config profile and candidate scope after tenant ${mode} replacement`, () => {
      const baseline = createStyleScopeProfile(config);
      assertEquals(
        baseline.hash,
        "8b1298718366147ad31ca55bc671754bd5b67b7683f72c511644ab9a142f148e",
      );
      const baselineCandidates = extractCandidatesFromFiles(files, { styleProfile: baseline });
      const iterator = Array.prototype[Symbol.iterator];
      const sort = Array.prototype.sort;
      const some = Array.prototype.some;
      const replace = String.prototype.replace;
      const add = Set.prototype.add;
      const stringify = JSON.stringify;
      const apply = Reflect.apply;
      let actual;
      let candidates;
      let included;
      let traversed;
      let filtered;
      try {
        if (mode === "iterator") {
          Array.prototype[Symbol.iterator] = function () {
            if (this === config.directories?.components) return apply(iterator, [], []);
            return apply(iterator, this, []);
          };
        }
        if (mode === "sort") {
          Array.prototype.sort = function () {
            return this;
          };
        }
        if (mode === "some") {
          Array.prototype.some = function () {
            return false;
          };
        }
        if (mode === "replace") {
          String.prototype.replace = function () {
            return "tenant-path";
          };
        }
        if (mode === "set") {
          Set.prototype.add = function () {
            return this;
          };
        }
        if (mode === "json") {
          JSON.stringify = function () {
            return '"tenant-profile"';
          };
        }
        actual = createStyleScopeProfile(config);
        included = shouldIncludeStylePath(actual, files[0]!.path);
        traversed = shouldTraverseStyleDirectory(actual, "knowledge");
        filtered = filterFilesForStyleScope(files, actual);
        candidates = extractCandidatesFromFiles(files, { styleProfile: actual });
      } finally {
        Array.prototype[Symbol.iterator] = iterator;
        Array.prototype.sort = sort;
        Array.prototype.some = some;
        String.prototype.replace = replace;
        Set.prototype.add = add;
        JSON.stringify = stringify;
      }
      assertEquals(actual, baseline);
      assertEquals(included, true);
      assertEquals(traversed, true);
      assertEquals(filtered, [files[0]]);
      assertEquals(candidates, baselineCandidates);
      assertEquals(candidates?.has("release-component"), true);
      assertEquals(candidates?.has("excluded-reference"), false);
    });
  }
});
