import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  extractImports,
  findBroadBarrelViolations,
  findCyclicEdges,
  findRegressions,
  resolveLocalImport,
} from "./check-module-boundaries.ts";

describe("check-module-boundaries", () => {
  it("extracts static, type-only, dynamic, and re-export imports", () => {
    const references = extractImports(
      "src/example.ts",
      [
        'import { value, type Value } from "./value.ts";',
        'import type { TypeOnly } from "./types.ts";',
        'export { output } from "./output.ts";',
        'export type { OutputType } from "./output-types.ts";',
        'await import("./lazy.ts");',
      ].join("\n"),
    );

    assertEquals(
      references.map(({ specifier, kind }) => ({ specifier, kind })),
      [
        { specifier: "./value.ts", kind: "runtime" },
        { specifier: "./types.ts", kind: "type" },
        { specifier: "./output.ts", kind: "runtime" },
        { specifier: "./output-types.ts", kind: "type" },
        { specifier: "./lazy.ts", kind: "dynamic" },
      ],
    );
  });

  it("resolves exact aliases before prefixes and resolves relative indexes", () => {
    const files = new Set([
      "src/errors/index.ts",
      "src/errors/veryfront-error.ts",
      "src/example/dependency/index.ts",
    ]);
    const imports = {
      "#veryfront/errors": "./src/errors/index.ts",
      "#veryfront/": "./src/",
    };

    assertEquals(
      resolveLocalImport(
        "src/example/main.ts",
        "#veryfront/errors",
        imports,
        files,
      ),
      "src/errors/index.ts",
    );
    assertEquals(
      resolveLocalImport(
        "src/example/main.ts",
        "#veryfront/errors/veryfront-error.ts",
        imports,
        files,
      ),
      "src/errors/veryfront-error.ts",
    );
    assertEquals(
      resolveLocalImport("src/example/main.ts", "./dependency", imports, files),
      "src/example/dependency/index.ts",
    );
  });

  it("rejects broad barrels, including type-only imports, in sensitive modules", () => {
    const imports = [
      { specifier: "#veryfront/errors", kind: "type" as const, line: 1 },
      {
        specifier: "#veryfront/errors/veryfront-error.ts",
        kind: "runtime" as const,
        line: 2,
      },
    ];

    assertEquals(
      findBroadBarrelViolations("src/config/loader.ts", imports).map((item) =>
        item.zone
      ),
      ["cycle-sensitive"],
    );
    assertEquals(
      findBroadBarrelViolations("src/routing/client/router.ts", imports).map((
        item,
      ) => item.zone),
      ["browser"],
    );
    assertEquals(
      findBroadBarrelViolations("src/server/bootstrap.ts", imports),
      [],
    );
  });

  it("reports only edges that participate in a cycle", () => {
    const graph = new Map<string, ReadonlySet<string>>([
      ["src/a.ts", new Set(["src/b.ts"])],
      ["src/b.ts", new Set(["src/a.ts", "src/c.ts"])],
      ["src/c.ts", new Set()],
      ["src/self.ts", new Set(["src/self.ts"])],
    ]);

    assertEquals(findCyclicEdges(graph), [
      "src/a.ts -> src/b.ts",
      "src/b.ts -> src/a.ts",
      "src/self.ts -> src/self.ts",
    ]);
  });

  it("ratchets exact baseline fingerprints", () => {
    assertEquals(
      findRegressions(["existing", "new"], ["existing", "removed"]),
      ["new"],
    );
  });
});
