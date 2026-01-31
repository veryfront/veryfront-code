import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import {
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

  describe("wouldCreateCycle", () => {
    it("should detect potential cycles", () => {
      const graph = new DependencyGraph();
      graph.addModule("/a.ts", ["/b.ts"]);
      graph.addModule("/b.ts", ["/c.ts"]);

      expect(graph.wouldCreateCycle("/c.ts", "/a.ts")).toBe(true);
      expect(graph.wouldCreateCycle("/d.ts", "/a.ts")).toBe(false);
    });
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
