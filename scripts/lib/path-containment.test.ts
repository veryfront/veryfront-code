import { assertEquals } from "#std/assert";
import {
  isPathContained,
  type PathContainmentImplementation,
} from "./path-containment.ts";

Deno.test("path containment rejects every relative escape form with injected semantics", () => {
  const root = "virtual-root";
  const relativePaths = new Map([
    ["same", ""],
    ["child", String.raw`nested\file.ts`],
    ["dot-dot-name", String.raw`..cache\file.ts`],
    ["parent", ".."],
    ["sibling", String.raw`..\sibling\file.ts`],
    ["absolute", String.raw`D:\other\file.ts`],
  ]);
  const implementation: PathContainmentImplementation = {
    relative(from, candidate) {
      assertEquals(from, root);
      const relativePath = relativePaths.get(candidate);
      if (relativePath === undefined) throw new Error(`unknown ${candidate}`);
      return relativePath;
    },
    isAbsolute: (path) => /^[A-Z]:\\/.test(path),
    separator: "\\",
  };

  for (
    const [candidate, expected] of [
      ["same", true],
      ["child", true],
      ["dot-dot-name", true],
      ["parent", false],
      ["sibling", false],
      ["absolute", false],
    ] as const
  ) {
    assertEquals(
      isPathContained(root, candidate, implementation),
      expected,
      candidate,
    );
  }
});
