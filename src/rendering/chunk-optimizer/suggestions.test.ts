import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CHUNK_SIZE_ESTIMATES } from "./limits.ts";
import { generateChunkSuggestions } from "./suggestions.ts";

describe("generateChunkSuggestions", () => {
  it("groups React packages from CDN package-prefix paths into the React vendor chunk", () => {
    const dependency = "https://cdn.jsdelivr.net/npm/react/index.js";
    const suggestions = generateChunkSuggestions(
      new Map([
        [
          "/app/page.tsx",
          {
            path: "/app/page.tsx",
            local: [],
            remote: [dependency],
            shared: [],
          },
        ],
      ]),
      new Map([[dependency, 1]]),
    );

    assertEquals(
      suggestions.find((suggestion) => suggestion.name === "react-vendor"),
      {
        name: "react-vendor",
        deps: [dependency],
        pages: ["/app/page.tsx"],
        benefit: CHUNK_SIZE_ESTIMATES.reactRuntime,
      },
      "react vendor chunk must list its deps, the pages that import them, and its benefit",
    );
  });

  it("does not group scoped packages containing react into the React vendor chunk", () => {
    const dependencies = [
      "@tanstack/react-query",
      "https://cdn.jsdelivr.net/npm/@tanstack/react-query/index.js",
      "https://cdn.jsdelivr.net/npm/@scope/react/index.js",
    ];
    const suggestions = generateChunkSuggestions(
      new Map([
        [
          "/app/page.tsx",
          {
            path: "/app/page.tsx",
            local: [],
            remote: [dependencies[1]!, dependencies[2]!],
            shared: [dependencies[0]!],
          },
        ],
      ]),
      new Map(dependencies.map((dependency) => [dependency, 1])),
    );

    assertEquals(
      suggestions.find((suggestion) => suggestion.name === "react-vendor"),
      undefined,
    );
  });

  it("groups framer-motion subpath imports into the UI vendor chunk", () => {
    const suggestions = generateChunkSuggestions(
      new Map([
        [
          "/app/page.tsx",
          {
            path: "/app/page.tsx",
            local: [],
            remote: [],
            shared: ["framer-motion/motion"],
          },
        ],
        [
          "/app/remote.tsx",
          {
            path: "/app/remote.tsx",
            local: [],
            remote: ["https://esm.sh/framer-motion/motion"],
            shared: [],
          },
        ],
      ]),
      new Map([
        ["framer-motion/motion", 1],
        ["https://esm.sh/framer-motion/motion", 1],
      ]),
    );

    assertEquals(
      suggestions.find((suggestion) => suggestion.name === "ui-vendor"),
      {
        name: "ui-vendor",
        deps: ["framer-motion/motion", "https://esm.sh/framer-motion/motion"],
        pages: ["/app/page.tsx", "/app/remote.tsx"],
        benefit: 2 * CHUNK_SIZE_ESTIMATES.uiLibrary,
      },
      "ui vendor chunk must list its deps, the union of the pages that import them, and its benefit",
    );
  });

  it("ranks suggestions by benefit descending", () => {
    const suggestions = generateChunkSuggestions(
      new Map([
        [
          "/a",
          {
            path: "/a",
            local: [],
            remote: [],
            shared: ["react", "framer-motion", "lodash"],
          },
        ],
        [
          "/b",
          {
            path: "/b",
            local: [],
            remote: [],
            shared: ["lodash"],
          },
        ],
      ]),
      new Map([
        ["react", 2],
        ["framer-motion", 1],
        ["lodash", 2],
      ]),
    );

    assertEquals(
      suggestions.map((suggestion) => suggestion.name),
      ["react-vendor", "ui-vendor", "common"],
      "suggestions must be ranked by benefit descending",
    );
    assertEquals(
      suggestions.map((suggestion) => suggestion.benefit),
      [200_000, 150_000, 50_000],
      "benefit must be reactRuntime, uiLibrary per ui dep, and dependency estimate times deps times pages",
    );
  });

  it("breaks a benefit tie by chunk name", () => {
    const shared = ["axios", "lodash", "zod"];
    const suggestions = generateChunkSuggestions(
      new Map([
        [
          "/a",
          {
            path: "/a",
            local: [],
            remote: [],
            shared: [...shared, "framer-motion"],
          },
        ],
        [
          "/b",
          {
            path: "/b",
            local: [],
            remote: [],
            shared,
          },
        ],
      ]),
      new Map([
        ["axios", 2],
        ["lodash", 2],
        ["zod", 2],
        ["framer-motion", 1],
      ]),
    );

    assertEquals(
      suggestions.map((suggestion) => suggestion.benefit),
      [150_000, 150_000],
      "this fixture must produce two chunks of equal benefit so the name tiebreak is observable",
    );
    assertEquals(
      suggestions.map((suggestion) => suggestion.name),
      ["common", "ui-vendor"],
      "chunks of equal benefit must be ordered by name ascending",
    );
  });
});
