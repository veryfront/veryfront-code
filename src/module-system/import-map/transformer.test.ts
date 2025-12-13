import { describe, it } from "std/testing/bdd.ts";
import { assert, assertEquals } from "std/assert/mod.ts";
import { transformImportsWithMap } from "./transformer.ts";
import type { ImportMapConfig } from "./types.ts";

describe("transformImportsWithMap", () => {
  it("should transform import statements with resolveBare", () => {
    const code = 'import React from "react";';
    const importMap: ImportMapConfig = {
      imports: {
        "react": "https://esm.sh/react@18",
      },
    };

    const result = transformImportsWithMap(code, importMap, undefined, { resolveBare: true });
    assertEquals(result, 'import React from "https://esm.sh/react@18";');
  });

  it("should transform dynamic imports with resolveBare", () => {
    const code = 'const mod = await import("react");';
    const importMap: ImportMapConfig = {
      imports: {
        "react": "https://esm.sh/react@18",
      },
    };

    const result = transformImportsWithMap(code, importMap, undefined, { resolveBare: true });
    assert(result.includes('import("https://esm.sh/react@18")'));
  });

  it("should skip bare dynamic imports when resolveBare is false", () => {
    const code = 'const mod = await import("react");';
    const importMap: ImportMapConfig = {
      imports: {
        "react": "https://esm.sh/react@18",
      },
    };

    const result = transformImportsWithMap(code, importMap);
    assertEquals(result, code);
  });

  it("should skip bare imports when resolveBare is false", () => {
    const code = 'import React from "react";';
    const importMap: ImportMapConfig = {
      imports: {
        "react": "https://esm.sh/react@18",
      },
    };

    const result = transformImportsWithMap(code, importMap, undefined, { resolveBare: false });
    assertEquals(result, 'import React from "react";');
  });

  it("should transform relative imports", () => {
    const code = 'import utils from "./utils";';
    const importMap: ImportMapConfig = {
      imports: {
        "./utils": "/dist/utils.js",
      },
    };

    const result = transformImportsWithMap(code, importMap);
    assertEquals(result, 'import utils from "/dist/utils.js";');
  });

  it("should not transform http URLs", () => {
    const code = 'import React from "https://esm.sh/react@18";';
    const importMap: ImportMapConfig = {
      imports: {},
    };

    const result = transformImportsWithMap(code, importMap);
    assertEquals(result, code);
  });

  it("should return original code when no matches", () => {
    const code = 'import React from "react";';
    const importMap: ImportMapConfig = {
      imports: {
        "vue": "https://esm.sh/vue@3",
      },
    };

    const result = transformImportsWithMap(code, importMap);
    // When resolveBare is not set, bare imports are not transformed
    assert(result.includes("react"));
  });

  it("should handle empty import map", () => {
    const code = 'import React from "react";';
    const importMap: ImportMapConfig = {};

    const result = transformImportsWithMap(code, importMap);
    assertEquals(result, code);
  });

  it("should not transform standalone from statements", () => {
    // Standalone 'from' without import/export is not valid ESM and should not be transformed
    const code = 'const x = 1;\nfrom "react"';
    const importMap: ImportMapConfig = {
      imports: {
        "react": "https://esm.sh/react@18",
      },
    };

    const result = transformImportsWithMap(code, importMap, undefined, { resolveBare: true });
    assertEquals(result, code); // No transformation for invalid syntax
  });

  it("should preserve code that doesn't have imports", () => {
    const code = 'const x = 1;\nfunction test() { return 42; }';
    const importMap: ImportMapConfig = {
      imports: {
        "react": "https://esm.sh/react@18",
      },
    };

    const result = transformImportsWithMap(code, importMap);
    assertEquals(result, code);
  });

  it("should handle multiple dynamic imports with resolveBare", () => {
    const code = `
const a = import("lib1");
const b = import("lib2");
`;
    const importMap: ImportMapConfig = {
      imports: {
        "lib1": "https://example.com/lib1.js",
        "lib2": "https://example.com/lib2.js",
      },
    };

    const result = transformImportsWithMap(code, importMap, undefined, { resolveBare: true });
    assert(result.includes('import("https://example.com/lib1.js")'));
    assert(result.includes('import("https://example.com/lib2.js")'));
  });
});
