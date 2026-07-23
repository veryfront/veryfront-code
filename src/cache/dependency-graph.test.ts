import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import {
  computeDepsHash,
  createDependencyHashCache,
  DependencyGraph,
  extractImports,
  filterLocalImports,
  normalizeSpecifierToPath,
} from "./dependency-graph.ts";

describe("DependencyGraph", () => {
  describe("addModule and getDirectDependencies", () => {
    it("should track direct dependencies", () => {
      const graph = new DependencyGraph();
      graph.addModule("/a.ts", ["/b.ts", "/c.ts"]);

      expect(graph.getDirectDependencies("/a.ts")).toEqual(["/b.ts", "/c.ts"]);
    });

    it("should return empty array for unknown module", () => {
      const graph = new DependencyGraph();
      expect(graph.getDirectDependencies("/unknown.ts")).toEqual([]);
    });

    it("enforces configured module and edge bounds atomically", () => {
      const graph = new DependencyGraph({
        maxModules: 1,
        maxDependenciesPerModule: 1,
        maxEdges: 1,
      });
      graph.addModule("/a.ts", ["/b.ts"]);

      expect(() => graph.addModule("/c.ts", [])).toThrow();
      expect(() => graph.addModule("/a.ts", ["/b.ts", "/c.ts"])).toThrow();
      expect(graph.getDirectDependencies("/a.ts")).toEqual(["/b.ts"]);
    });

    it("removes empty reverse-index entries when dependencies change", () => {
      const graph = new DependencyGraph();
      graph.addModule("/entry.ts", ["/old.ts"]);

      graph.addModule("/entry.ts", ["/new.ts"]);

      const internals = graph as unknown as {
        dependents: Map<string, Set<string>>;
      };
      expect(internals.dependents.has("/old.ts")).toBe(false);
      expect(internals.dependents.get("/new.ts")).toEqual(new Set(["/entry.ts"]));
    });
  });

  describe("getTransitiveDependencies", () => {
    it("should return all transitive dependencies", () => {
      const graph = new DependencyGraph();
      graph.addModule("/a.ts", ["/b.ts"]);
      graph.addModule("/b.ts", ["/c.ts"]);
      graph.addModule("/c.ts", ["/d.ts"]);
      graph.addModule("/d.ts", []);

      const deps = graph.getTransitiveDependencies("/a.ts");
      expect(deps).toContain("/b.ts");
      expect(deps).toContain("/c.ts");
      expect(deps).toContain("/d.ts");
      expect(deps).not.toContain("/a.ts");
    });

    it("should handle cycles gracefully", () => {
      const graph = new DependencyGraph();
      graph.addModule("/a.ts", ["/b.ts"]);
      graph.addModule("/b.ts", ["/c.ts"]);
      graph.addModule("/c.ts", ["/a.ts"]); // Cycle: c -> a

      const deps = graph.getTransitiveDependencies("/a.ts");
      expect(deps).toContain("/b.ts");
      expect(deps).toContain("/c.ts");
    });

    it("should handle self-reference", () => {
      const graph = new DependencyGraph();
      graph.addModule("/a.ts", ["/a.ts"]); // Self-reference

      expect(graph.getTransitiveDependencies("/a.ts")).toEqual([]);
    });
  });

  describe("getDependents", () => {
    it("should return all modules that depend on a file", () => {
      const graph = new DependencyGraph();
      graph.addModule("/a.ts", ["/shared.ts"]);
      graph.addModule("/b.ts", ["/shared.ts"]);
      graph.addModule("/c.ts", ["/a.ts"]);

      const dependents = graph.getDependents("/shared.ts");
      expect(dependents).toContain("/a.ts");
      expect(dependents).toContain("/b.ts");
      expect(dependents).toContain("/c.ts"); // Transitive through /a.ts
    });
  });

  describe("removeModule", () => {
    it("removes outgoing edges without dropping other modules' incoming edges", () => {
      const graph = new DependencyGraph();
      graph.addModule("/entry.ts", ["/shared.ts"]);
      graph.addModule("/other.ts", ["/entry.ts"]);

      graph.removeModule("/entry.ts");

      expect(graph.getDirectDependencies("/entry.ts")).toEqual([]);
      expect(graph.getDependents("/shared.ts")).not.toContain("/entry.ts");
      expect(graph.getDependents("/entry.ts")).toContain("/other.ts");
    });
  });

  describe("wouldCreateCycle", () => {
    it("should detect potential cycles", () => {
      const graph = new DependencyGraph();
      graph.addModule("/a.ts", ["/b.ts"]);
      graph.addModule("/b.ts", ["/c.ts"]);

      expect(graph.wouldCreateCycle("/c.ts", "/a.ts")).toBe(true);
      expect(graph.wouldCreateCycle("/d.ts", "/a.ts")).toBe(false);
    });

    it("short-circuits once the target dependency is found", () => {
      class ThrowingDependencySet extends Set<string> {
        override [Symbol.iterator](): SetIterator<string> {
          throw new Error("unvisited dependency branch should not be traversed");
        }
      }

      const graph = new DependencyGraph();
      graph.addModule("/entry.ts", ["/target.ts", "/unvisited.ts"]);

      const internals = graph as unknown as {
        dependencies: Map<string, Set<string>>;
      };
      internals.dependencies.set(
        "/unvisited.ts",
        new ThrowingDependencySet(["/too-late.ts"]),
      );

      expect(graph.wouldCreateCycle("/target.ts", "/entry.ts")).toBe(true);
    });

    it("detects a new self-cycle", () => {
      const graph = new DependencyGraph();
      expect(graph.wouldCreateCycle("/self.ts", "/self.ts")).toBe(true);
    });
  });
});

describe("computeDepsHash failure semantics", () => {
  it("rejects dependency reads instead of caching an incomplete graph", async () => {
    const cache = createDependencyHashCache();
    let error: unknown;
    try {
      await computeDepsHash(
        "/project/entry.js",
        () => Promise.reject(new Error("PRIVATE_READ_ERROR_CANARY")),
        "/project",
        cache,
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    expect(String(error)).not.toContain("PRIVATE_READ_ERROR_CANARY");
    expect(cache.completedModules.has("/project/entry.js")).toBe(false);
    expect(cache.contentHashes.has("/project/entry.js")).toBe(false);
  });

  it("rolls back a parent graph entry when a transitive dependency fails", async () => {
    const cache = createDependencyHashCache();
    await expect(
      computeDepsHash(
        "/project/entry.js",
        (path) => {
          if (path === "/project/entry.js") {
            return Promise.resolve('import "./missing.js"; export const value = 1;');
          }
          return Promise.reject(new Error("missing dependency"));
        },
        "/project",
        cache,
      ),
    ).rejects.toThrow();

    expect(cache.graph.getDirectDependencies("/project/entry.js")).toEqual([]);
    expect(cache.contentHashes.has("/project/entry.js")).toBe(false);
    expect(cache.completedModules.has("/project/entry.js")).toBe(false);
  });
});

describe("extractImports", () => {
  it("should extract import specifiers from code", async () => {
    const code = `
      import React from "react";
      import { useState } from "./hooks.ts";
      import type { Foo } from "@/types/foo";
    `;

    const imports = await extractImports(code);
    expect(imports).toContain("react");
    expect(imports).toContain("./hooks.ts");
    expect(imports).toContain("@/types/foo");
  });

  it("should handle dynamic imports", async () => {
    const code = `const mod = await import("./dynamic.ts");`;
    const imports = await extractImports(code);
    expect(imports).toContain("./dynamic.ts");
  });
});

describe("filterLocalImports", () => {
  it("should filter to only local imports", () => {
    const specifiers = [
      "./local.ts",
      "../parent.ts",
      "@/alias.ts",
      "file:///absolute.ts",
      "react",
      "https://esm.sh/lodash",
      "@tanstack/react-query",
    ];

    const local = filterLocalImports(specifiers);
    expect(local).toContain("./local.ts");
    expect(local).toContain("../parent.ts");
    expect(local).toContain("@/alias.ts");
    expect(local).toContain("file:///absolute.ts");
    expect(local).not.toContain("react");
    expect(local).not.toContain("https://esm.sh/lodash");
    expect(local).not.toContain("@tanstack/react-query");
  });

  it("should exclude #veryfront/* framework imports", () => {
    const specifiers = [
      "#veryfront/utils",
      "#veryfront/platform/compat/runtime.ts",
      "#veryfront/react/head-collector.ts",
      "@/components/Button.tsx",
    ];

    const local = filterLocalImports(specifiers);
    expect(local).not.toContain("#veryfront/utils");
    expect(local).not.toContain("#veryfront/platform/compat/runtime.ts");
    expect(local).not.toContain("#veryfront/react/head-collector.ts");
    expect(local).toContain("@/components/Button.tsx");
  });
});

describe("normalizeSpecifierToPath", () => {
  it("should normalize @/ alias to project path", () => {
    const result = normalizeSpecifierToPath(
      "@/components/Button",
      "/project/pages/index.tsx",
      "/project",
    );
    expect(result).toBe("/project/components/Button");
  });

  it("should resolve relative imports", () => {
    const result = normalizeSpecifierToPath(
      "./utils/helpers",
      "/project/pages/index.tsx",
      "/project",
    );
    expect(result).toBe("/project/pages/utils/helpers");
  });

  it("should handle parent directory traversal", () => {
    const result = normalizeSpecifierToPath(
      "../shared/types",
      "/project/pages/home/index.tsx",
      "/project",
    );
    expect(result).toBe("/project/pages/shared/types");
  });

  it("should handle file:// URLs", () => {
    const result = normalizeSpecifierToPath(
      "file:///absolute/path.tsx",
      "/project/pages/index.tsx",
      "/project",
    );
    expect(result).toBe("/absolute/path.js");
  });

  it("should normalize extensions to .js", () => {
    expect(
      normalizeSpecifierToPath("@/Button.tsx", "/project/pages/index.tsx", "/project"),
    ).toMatch(/\.js$/);
    expect(
      normalizeSpecifierToPath("@/Button.ts", "/project/pages/index.tsx", "/project"),
    ).toMatch(/\.js$/);
    expect(
      normalizeSpecifierToPath("@/Button.jsx", "/project/pages/index.tsx", "/project"),
    ).toMatch(/\.js$/);
  });
});
