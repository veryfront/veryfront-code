import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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
      suggestions.find((suggestion) => suggestion.name === "react-vendor")?.deps,
      [dependency],
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
      suggestions.find((suggestion) => suggestion.name === "ui-vendor")?.deps,
      ["framer-motion/motion", "https://esm.sh/framer-motion/motion"],
    );
  });
});
