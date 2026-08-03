import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateChunkSuggestions } from "./suggestions.ts";

describe("generateChunkSuggestions", () => {
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
