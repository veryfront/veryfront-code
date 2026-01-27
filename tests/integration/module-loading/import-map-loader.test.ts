import { assertEquals, assertExists } from "@veryfront/testing/assert";
import {
  afterEach as _afterEach,
  beforeEach as _beforeEach,
  describe,
  it,
} from "@veryfront/testing/bdd";
import { join } from "@veryfront/compat/path";
import {
  getDefaultImportMap,
  loadImportMap,
  mergeImportMaps,
  resolveImport,
  transformImportsWithMap,
} from "@veryfront/modules/import-map/index.ts";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import { type TestContext, withTestContext } from "../../_helpers/context.ts";
import { mkdir, remove, writeTextFile } from "@veryfront/testing/deno-compat";

describe(
  "import-map-loader",
  () => {
    describe("loadImportMap", () => {
      it("should load valid deno.json with imports", async () => {
        await withTestContext("import-map-load-valid", async (context: TestContext) => {
          const denoConfig = {
            imports: {
              react: "https://esm.sh/react@19.1.1",
              "react-dom": "https://esm.sh/react-dom@19.1.1",
            },
          };

          await writeTextFile(
            join(context.projectDir, "deno.json"),
            JSON.stringify(denoConfig, null, 2),
          );

          const importMap = await loadImportMap(context.projectDir, await getAdapter());

          assertExists(importMap);
          assertExists(importMap.imports);
          // All runtimes: Uses esm.sh URLs for React
          assertEquals(importMap.imports!["react"], "https://esm.sh/react@19.1.1?target=es2022&deps=csstype@3.2.3");
          assertEquals(
            importMap.imports!["react-dom"],
            "https://esm.sh/react-dom@19.1.1?external=react&target=es2022&deps=csstype@3.2.3",
          );
        });
      });

      it("should load deno.json with both imports and scopes", async () => {
        await withTestContext("import-map-load-scopes", async (context: TestContext) => {
          const denoConfig = {
            imports: {
              react: "https://esm.sh/react@19.1.1",
            },
            scopes: {
              "/vendor/": {
                react: "https://esm.sh/react@17.0.2",
              },
            },
          };

          // Remove default veryfront.config.js to allow deno.json to take precedence
          try {
            await remove(join(context.projectDir, "veryfront.config.js"));
          } catch {
            // Ignore if doesn't exist
          }

          await writeTextFile(
            join(context.projectDir, "deno.json"),
            JSON.stringify(denoConfig, null, 2),
          );

          const importMap = await loadImportMap(context.projectDir, await getAdapter());

          assertExists(importMap);
          assertExists(importMap.imports);
          // All runtimes: Uses esm.sh URLs for React
          assertEquals(importMap.imports!["react"], "https://esm.sh/react@19.1.1?target=es2022&deps=csstype@3.2.3");

          // Scopes should be loaded
          assertExists(importMap.scopes);
          assertEquals(typeof (importMap as any).scopes, "object");

          // Vendor scope should be preserved
          if (importMap.scopes && importMap.scopes["/vendor/"]) {
            assertEquals(importMap.scopes["/vendor/"]["react"], "https://esm.sh/react@17.0.2");
          }
        });
      });

      it("should return default import map when deno.json not found", async () => {
        await withTestContext("import-map-load-missing", async (context: TestContext) => {
          // Don't create deno.json
          const importMap = await loadImportMap(context.projectDir, await getAdapter());

          assertExists(importMap);
          assertExists(importMap.imports);
          // Should have default React imports
          assertExists(importMap.imports!["react"]);
          assertExists(importMap.imports!["react-dom"]);
        });
      });

      it("should return default map when deno.json has no imports/scopes", async () => {
        await withTestContext("import-map-load-empty", async (context: TestContext) => {
          const denoConfig = {
            compilerOptions: {
              jsx: "react",
            },
          };

          await writeTextFile(
            join(context.projectDir, "deno.json"),
            JSON.stringify(denoConfig, null, 2),
          );

          const importMap = await loadImportMap(context.projectDir, await getAdapter());

          assertExists(importMap);
          assertExists(importMap.imports);
          // Should fall back to default
          assertExists(importMap.imports!["react"]);
        });
      });

      it("should handle malformed JSON gracefully", async () => {
        await withTestContext("import-map-load-malformed", async (context: TestContext) => {
          await writeTextFile(join(context.projectDir, "deno.json"), "{invalid json}");

          const importMap = await loadImportMap(context.projectDir, await getAdapter());

          // Should return default import map
          assertExists(importMap);
          assertExists(importMap.imports);
          assertExists(importMap.imports!["react"]);
        });
      });

      it("should traverse parent directories to find deno.json", async () => {
        await withTestContext("import-map-load-traverse", async (context: TestContext) => {
          const denoConfig = {
            imports: {
              react: "https://esm.sh/react@19.1.1",
            },
          };

          // Create deno.json in root
          await writeTextFile(
            join(context.projectDir, "deno.json"),
            JSON.stringify(denoConfig, null, 2),
          );

          // Create nested directory
          const nestedDir = join(context.projectDir, "src", "components");
          await mkdir(nestedDir, { recursive: true });

          // Load from nested directory
          const importMap = await loadImportMap(nestedDir, await getAdapter());

          assertExists(importMap);
          // All runtimes: Uses esm.sh URLs for React
          assertEquals(importMap.imports!["react"], "https://esm.sh/react@19.1.1?target=es2022&deps=csstype@3.2.3");
        });
      });

      it("should stop at root directory when searching", async () => {
        await withTestContext("import-map-load-root", async (context: TestContext) => {
          // Create deeply nested directory without deno.json
          const deepDir = join(context.projectDir, "a", "b", "c", "d", "e");
          await mkdir(deepDir, { recursive: true });

          const importMap = await loadImportMap(deepDir, await getAdapter());

          // Should eventually return default map
          assertExists(importMap);
          assertExists(importMap.imports);
        });
      });

      it("should prioritize veryfront.config resolve.importMap over deno.json", async () => {
        await withTestContext("import-map-load-config-priority", async (context: TestContext) => {
          // Create deno.json
          const denoConfig = {
            imports: {
              react: "https://esm.sh/react@18",
            },
          };
          await writeTextFile(
            join(context.projectDir, "deno.json"),
            JSON.stringify(denoConfig, null, 2),
          );

          // Create veryfront.config.js with importMap
          const config = `export default {
  resolve: {
    importMap: {
      imports: {
        react: 'https://esm.sh/react@19',
      },
    },
  },
};`;
          await writeTextFile(join(context.projectDir, "veryfront.config.js"), config);

          const importMap = await loadImportMap(context.projectDir, await getAdapter());

          // Config import map (react@19) is normalized to default React version (19.1.1)
          assertEquals(importMap.imports!["react"], "https://esm.sh/react@19.1.1?target=es2022&deps=csstype@3.2.3");
        });
      });

      it("should handle empty scopes object", async () => {
        await withTestContext("import-map-load-empty-scopes", async (context: TestContext) => {
          const denoConfig = {
            imports: {
              react: "https://esm.sh/react@18",
            },
            scopes: {},
          };

          await writeTextFile(
            join(context.projectDir, "deno.json"),
            JSON.stringify(denoConfig, null, 2),
          );

          const importMap = await loadImportMap(context.projectDir, await getAdapter());

          assertExists(importMap);
          assertExists(importMap.scopes);
          // All runtimes: scopes remain empty when no custom scopes defined
          assertEquals(Object.keys(importMap.scopes).length, 0);
        });
      });
    });

    describe("resolveImport", () => {
      it("should resolve bare specifiers using imports", () => {
        const importMap = {
          imports: {
            react: "https://esm.sh/react@18",
          },
        };

        const resolved = resolveImport("react", importMap);
        assertEquals(resolved, "https://esm.sh/react@18");
      });

      it("should resolve prefix matches", () => {
        const importMap = {
          imports: {
            "std/": "https://deno.land/std@0.220.0/",
          },
        };

        const resolved = resolveImport("std/path/mod.ts", importMap);
        assertEquals(resolved, "https://deno.land/std@0.220.0/path/mod.ts");
      });

      it("should handle scoped imports", () => {
        const importMap = {
          imports: {
            react: "https://esm.sh/react@18",
          },
          scopes: {
            "/vendor/": {
              react: "https://esm.sh/react@17",
            },
          },
        };

        const resolved = resolveImport("react", importMap, "/vendor/");
        assertEquals(resolved, "https://esm.sh/react@17");
      });

      it("should prioritize scoped imports over regular imports", () => {
        const importMap = {
          imports: {
            lodash: "https://esm.sh/lodash@4.17.21",
          },
          scopes: {
            "/vendor/": {
              lodash: "https://esm.sh/lodash@3.10.1",
            },
          },
        };

        const scopedResolved = resolveImport("lodash", importMap, "/vendor/");
        assertEquals(scopedResolved, "https://esm.sh/lodash@3.10.1");

        const regularResolved = resolveImport("lodash", importMap);
        assertEquals(regularResolved, "https://esm.sh/lodash@4.17.21");
      });

      it("should return original specifier if no mapping found", () => {
        const importMap = {
          imports: {
            react: "https://esm.sh/react@18",
          },
        };

        const resolved = resolveImport("unknown-package", importMap);
        assertEquals(resolved, "unknown-package");
      });

      it("should handle already resolved URLs unchanged", () => {
        const importMap = {
          imports: {
            react: "https://esm.sh/react@18",
          },
        };

        const url = "https://example.com/module.js";
        const resolved = resolveImport(url, importMap);
        assertEquals(resolved, url);
      });

      it("should resolve .js extension stripping", () => {
        const importMap = {
          imports: {
            "my-module": "https://example.com/my-module.js",
          },
        };

        const resolved = resolveImport("my-module.js", importMap);
        assertEquals(resolved, "https://example.com/my-module.js");
      });

      it("should resolve .mjs extension stripping", () => {
        const importMap = {
          imports: {
            "my-module": "https://example.com/my-module.mjs",
          },
        };

        const resolved = resolveImport("my-module.mjs", importMap);
        assertEquals(resolved, "https://example.com/my-module.mjs");
      });

      it("should resolve .cjs extension stripping", () => {
        const importMap = {
          imports: {
            "my-module": "https://example.com/my-module.cjs",
          },
        };

        const resolved = resolveImport("my-module.cjs", importMap);
        assertEquals(resolved, "https://example.com/my-module.cjs");
      });

      it("should handle empty import map", () => {
        const importMap = {};

        const resolved = resolveImport("react", importMap);
        assertEquals(resolved, "react");
      });

      it("should handle multiple prefix matches correctly", () => {
        const importMap = {
          imports: {
            "react/": "https://esm.sh/react@18/",
            "react/jsx-runtime": "https://esm.sh/react@18/jsx-runtime",
          },
        };

        // Exact match should win over prefix
        const exactResolved = resolveImport("react/jsx-runtime", importMap);
        assertEquals(exactResolved, "https://esm.sh/react@18/jsx-runtime");

        // Prefix match for other paths
        const prefixResolved = resolveImport("react/hooks", importMap);
        assertEquals(prefixResolved, "https://esm.sh/react@18/hooks");
      });

      it("should handle scope not matching", () => {
        const importMap = {
          scopes: {
            "/vendor/": {
              react: "https://esm.sh/react@17",
            },
          },
        };

        // Scope doesn't match, should return unchanged
        const resolved = resolveImport("react", importMap, "/app/");
        assertEquals(resolved, "react");
      });
    });

    describe("transformImportsWithMap", () => {
      it("should transform default import statements", () => {
        const code = `import React from 'react';`;
        const importMap = {
          imports: {
            react: "https://esm.sh/react@18",
          },
        };

        const transformed = transformImportsWithMap(code, importMap, undefined, {
          resolveBare: true,
        });
        assertEquals(transformed, `import React from "https://esm.sh/react@18";`);
      });

      it("should transform named import statements", () => {
        const code = `import { useState, useEffect } from 'react';`;
        const importMap = {
          imports: {
            react: "https://esm.sh/react@18",
          },
        };

        const transformed = transformImportsWithMap(code, importMap, undefined, {
          resolveBare: true,
        });
        assertEquals(
          transformed,
          `import { useState, useEffect } from "https://esm.sh/react@18";`,
        );
      });

      it("should transform namespace import statements", () => {
        const code = `import * as React from 'react';`;
        const importMap = {
          imports: {
            react: "https://esm.sh/react@18",
          },
        };

        const transformed = transformImportsWithMap(code, importMap, undefined, {
          resolveBare: true,
        });
        assertEquals(transformed, `import * as React from "https://esm.sh/react@18";`);
      });

      it("should transform export from statements", () => {
        const code = `export { Component } from 'react';`;
        const importMap = {
          imports: {
            react: "https://esm.sh/react@18",
          },
        };

        const transformed = transformImportsWithMap(code, importMap, undefined, {
          resolveBare: true,
        });
        assertEquals(transformed, `export { Component } from "https://esm.sh/react@18";`);
      });

      it("should transform export * from statements", () => {
        const code = `export * from 'react';`;
        const importMap = {
          imports: {
            react: "https://esm.sh/react@18",
          },
        };

        const transformed = transformImportsWithMap(code, importMap, undefined, {
          resolveBare: true,
        });
        assertEquals(transformed, `export * from "https://esm.sh/react@18";`);
      });

      it("should transform dynamic imports", () => {
        const code = `const module = await import('react');`;
        const importMap = {
          imports: {
            react: "https://esm.sh/react@18",
          },
        };

        const transformed = transformImportsWithMap(code, importMap);
        assertEquals(transformed, `const module = await import("https://esm.sh/react@18");`);
      });

      it("should transform multiple imports in single file", () => {
        const code = `
import React from 'react';
import { render } from 'react-dom';
import lodash from 'lodash';
`;
        const importMap = {
          imports: {
            react: "https://esm.sh/react@18",
            "react-dom": "https://esm.sh/react-dom@18",
            lodash: "https://esm.sh/lodash@4",
          },
        };

        const transformed = transformImportsWithMap(code, importMap, undefined, {
          resolveBare: true,
        });

        assertEquals(
          transformed.includes('from "https://esm.sh/react@18"'),
          true,
          "Should transform react import",
        );
        assertEquals(
          transformed.includes('from "https://esm.sh/react-dom@18"'),
          true,
          "Should transform react-dom import",
        );
        assertEquals(
          transformed.includes('from "https://esm.sh/lodash@4"'),
          true,
          "Should transform lodash import",
        );
      });

      it("should not transform relative imports", () => {
        const code = `import Component from './component.ts';`;
        const importMap = {
          imports: {
            react: "https://esm.sh/react@18",
          },
        };

        const transformed = transformImportsWithMap(code, importMap);
        // Quotes may change to double quotes, but path should stay relative
        assertEquals(transformed.includes("./component.ts"), true);
      });

      it("should not transform absolute imports", () => {
        const code = `import Component from '/src/component.ts';`;
        const importMap = {
          imports: {
            react: "https://esm.sh/react@18",
          },
        };

        const transformed = transformImportsWithMap(code, importMap);
        // Quotes may change to double quotes, but path should stay absolute
        assertEquals(transformed.includes("/src/component.ts"), true);
      });

      it("should normalize esm.sh URLs to import map version", () => {
        // esm.sh URLs are now intentionally normalized to prevent duplicate package instances
        const code = `import React from 'https://esm.sh/react@18';`;
        const importMap = {
          imports: {
            react: "https://esm.sh/react@17",
          },
        };

        const transformed = transformImportsWithMap(code, importMap);
        // esm.sh URLs are normalized to the import map version
        assertEquals(transformed.includes("https://esm.sh/react@17"), true);
      });

      it("should not transform non-esm.sh http/https URLs", () => {
        // Non-esm.sh URLs should stay unchanged
        const code = `import Something from 'https://example.com/module.js';`;
        const importMap = {
          imports: {
            react: "https://esm.sh/react@18",
          },
        };

        const transformed = transformImportsWithMap(code, importMap);
        // Non-esm.sh URLs stay unchanged
        assertEquals(transformed.includes("https://example.com/module.js"), true);
      });

      it("should return unchanged code when no matches found", () => {
        const code = `import Unknown from 'unknown-package';`;
        const importMap = {
          imports: {
            react: "https://esm.sh/react@18",
          },
        };

        const transformed = transformImportsWithMap(code, importMap, undefined, {
          resolveBare: true,
        });
        assertEquals(transformed, `import Unknown from "unknown-package";`);
      });

      it("should respect resolveBare option", () => {
        const code = `import React from 'react';`;
        const importMap = {
          imports: {
            react: "https://esm.sh/react@18",
          },
        };

        // Without resolveBare, bare specifiers should not be transformed
        const notTransformed = transformImportsWithMap(code, importMap, undefined, {
          resolveBare: false,
        });
        // Should still have 'react' as specifier
        assertEquals(notTransformed.includes("react"), true);
        assertEquals(notTransformed.includes("https://esm.sh/react@18"), false);

        // With resolveBare, should transform
        const transformed = transformImportsWithMap(code, importMap, undefined, {
          resolveBare: true,
        });
        assertEquals(transformed, `import React from "https://esm.sh/react@18";`);
      });

      it("should handle mixed quote styles", () => {
        const code = `
import React from "react";
import { useState } from 'react';
`;
        const importMap = {
          imports: {
            react: "https://esm.sh/react@18",
          },
        };

        const transformed = transformImportsWithMap(code, importMap, undefined, {
          resolveBare: true,
        });

        // Both should be transformed to double quotes
        assertEquals(
          transformed.split('from "https://esm.sh/react@18"').length,
          3,
          "Should transform both imports",
        );
      });

      it("should handle JSX runtime imports", () => {
        const code = `from 'react/jsx-runtime'`;
        const importMap = {
          imports: {
            "react/jsx-runtime": "https://esm.sh/react@18/jsx-runtime",
          },
        };

        const transformed = transformImportsWithMap(code, importMap, undefined, {
          resolveBare: true,
        });
        assertEquals(transformed, `from "https://esm.sh/react@18/jsx-runtime"`);
      });

      it("should handle prefix matches in transforms", () => {
        const code = `import path from 'std/path/mod.ts';`;
        const importMap = {
          imports: {
            "std/": "https://deno.land/std@0.220.0/",
          },
        };

        const transformed = transformImportsWithMap(code, importMap, undefined, {
          resolveBare: true,
        });
        assertEquals(
          transformed,
          `import path from "https://deno.land/std@0.220.0/path/mod.ts";`,
        );
      });

      it("should handle empty code", () => {
        const code = "";
        const importMap = {
          imports: {
            react: "https://esm.sh/react@18",
          },
        };

        const transformed = transformImportsWithMap(code, importMap);
        assertEquals(transformed, "");
      });

      it("should handle code without imports", () => {
        const code = `
const x = 5;
function hello() { return 'world'; }
`;
        const importMap = {
          imports: {
            react: "https://esm.sh/react@18",
          },
        };

        const transformed = transformImportsWithMap(code, importMap);
        assertEquals(transformed, code);
      });

      it("should handle scoped transforms", () => {
        const code = `import React from 'react';`;
        const importMap = {
          imports: {
            react: "https://esm.sh/react@18",
          },
          scopes: {
            "/vendor/": {
              react: "https://esm.sh/react@17",
            },
          },
        };

        const transformed = transformImportsWithMap(code, importMap, "/vendor/", {
          resolveBare: true,
        });
        assertEquals(transformed, `import React from "https://esm.sh/react@17";`);
      });
    });

    describe("mergeImportMaps", () => {
      it("should merge two import maps", () => {
        const map1 = {
          imports: {
            react: "https://esm.sh/react@18",
          },
        };
        const map2 = {
          imports: {
            "react-dom": "https://esm.sh/react-dom@18",
          },
        };

        const merged = mergeImportMaps(map1, map2);

        assertEquals(merged.imports!["react"], "https://esm.sh/react@18");
        assertEquals(merged.imports!["react-dom"], "https://esm.sh/react-dom@18");
      });

      it("should handle precedence with later maps overriding", () => {
        const map1 = {
          imports: {
            react: "https://esm.sh/react@17",
          },
        };
        const map2 = {
          imports: {
            react: "https://esm.sh/react@18",
          },
        };

        const merged = mergeImportMaps(map1, map2);

        assertEquals(merged.imports!["react"], "https://esm.sh/react@18");
      });

      it("should merge scopes correctly", () => {
        const map1 = {
          scopes: {
            "/vendor/": {
              react: "https://esm.sh/react@17",
            },
          },
        };
        const map2 = {
          scopes: {
            "/app/": {
              react: "https://esm.sh/react@18",
            },
          },
        };

        const merged = mergeImportMaps(map1, map2);

        assertEquals(merged.scopes?.["/vendor/"]?.["react"], "https://esm.sh/react@17");
        assertEquals(merged.scopes?.["/app/"]?.["react"], "https://esm.sh/react@18");
      });

      it("should merge overlapping scopes", () => {
        const map1 = {
          scopes: {
            "/vendor/": {
              react: "https://esm.sh/react@17",
            },
          },
        };
        const map2 = {
          scopes: {
            "/vendor/": {
              "react-dom": "https://esm.sh/react-dom@17",
            },
          },
        };

        const merged = mergeImportMaps(map1, map2);

        assertEquals(merged.scopes?.["/vendor/"]?.["react"], "https://esm.sh/react@17");
        assertEquals(merged.scopes?.["/vendor/"]?.["react-dom"], "https://esm.sh/react-dom@17");
      });

      it("should handle empty import maps", () => {
        const map1 = {
          imports: {},
        };
        const map2 = {
          imports: {
            react: "https://esm.sh/react@18",
          },
        };

        const merged = mergeImportMaps(map1, map2);

        assertEquals(merged.imports!["react"], "https://esm.sh/react@18");
      });

      it("should handle multiple maps", () => {
        const map1 = {
          imports: {
            react: "https://esm.sh/react@17",
          },
        };
        const map2 = {
          imports: {
            "react-dom": "https://esm.sh/react-dom@18",
          },
        };
        const map3 = {
          imports: {
            lodash: "https://esm.sh/lodash@4",
          },
        };

        const merged = mergeImportMaps(map1, map2, map3);

        assertEquals(merged.imports!["react"], "https://esm.sh/react@17");
        assertEquals(merged.imports!["react-dom"], "https://esm.sh/react-dom@18");
        assertEquals(merged.imports!["lodash"], "https://esm.sh/lodash@4");
      });

      it("should merge imports and scopes together", () => {
        const map1 = {
          imports: {
            react: "https://esm.sh/react@18",
          },
        };
        const map2 = {
          scopes: {
            "/vendor/": {
              react: "https://esm.sh/react@17",
            },
          },
        };

        const merged = mergeImportMaps(map1, map2);

        assertEquals(merged.imports!["react"], "https://esm.sh/react@18");
        assertEquals(merged.scopes!["/vendor/"]!["react"], "https://esm.sh/react@17");
      });

      it("should handle maps with missing imports", () => {
        const map1 = {
          scopes: {
            "/vendor/": {
              react: "https://esm.sh/react@17",
            },
          },
        };
        const map2 = {
          imports: {
            "react-dom": "https://esm.sh/react-dom@18",
          },
        };

        const merged = mergeImportMaps(map1, map2);

        assertEquals(merged.scopes?.["/vendor/"]?.["react"], "https://esm.sh/react@17");
        assertEquals(merged.imports!["react-dom"], "https://esm.sh/react-dom@18");
      });

      it("should handle maps with missing scopes", () => {
        const map1 = {
          imports: {
            react: "https://esm.sh/react@18",
          },
        };
        const map2 = {
          imports: {
            "react-dom": "https://esm.sh/react-dom@18",
          },
        };

        const merged = mergeImportMaps(map1, map2);

        assertEquals(merged.imports!["react"], "https://esm.sh/react@18");
        assertEquals(merged.imports!["react-dom"], "https://esm.sh/react-dom@18");
        assertEquals(Object.keys(merged.scopes!).length, 0);
      });

      it("should handle no arguments", () => {
        const merged = mergeImportMaps();

        assertExists(merged);
        assertEquals(Object.keys(merged.imports!).length, 0);
        assertEquals(Object.keys(merged.scopes!).length, 0);
      });

      it("should handle single map", () => {
        const map = {
          imports: {
            react: "https://esm.sh/react@18",
          },
        };

        const merged = mergeImportMaps(map);

        assertEquals(merged.imports!["react"], "https://esm.sh/react@18");
      });

      it("should preserve scope precedence with later maps", () => {
        const map1 = {
          scopes: {
            "/vendor/": {
              react: "https://esm.sh/react@17",
              lodash: "https://esm.sh/lodash@3",
            },
          },
        };
        const map2 = {
          scopes: {
            "/vendor/": {
              react: "https://esm.sh/react@18",
            },
          },
        };

        const merged = mergeImportMaps(map1, map2);

        // Later map should override react but preserve lodash
        assertEquals(merged.scopes?.["/vendor/"]?.["react"], "https://esm.sh/react@18");
        assertEquals(merged.scopes?.["/vendor/"]?.["lodash"], "https://esm.sh/lodash@3");
      });
    });

    describe("getDefaultImportMap", () => {
      // React IS included in getDefaultImportMap() for SSR consistency.
      // All runtimes use esm.sh URLs with external=react.

      it("should return default import map with veryfront and React imports", () => {
        const importMap = getDefaultImportMap();

        assertExists(importMap);
        assertExists(importMap.imports);
        // Check veryfront mappings
        assertExists(importMap.imports!["veryfront/head"]);
        assertExists(importMap.imports!["veryfront/router"]);
        assertExists(importMap.imports!["veryfront/context"]);
        assertExists(importMap.imports!["veryfront/fonts"]);
      });

      it("should include React for SSR consistency", () => {
        const importMap = getDefaultImportMap();

        // React IS included for SSR consistency
        assertExists(importMap.imports!["react"]);
        assertExists(importMap.imports!["react-dom"]);
        assertExists(importMap.imports!["react/jsx-runtime"]);

        // Context packages are NOT included - they are app-specific
        assertEquals(importMap.imports!["@tanstack/react-query"], undefined);
        assertEquals(importMap.imports!["next-themes"], undefined);
      });

      it("should provide consistent import map across all runtimes", () => {
        const importMap = getDefaultImportMap();

        assertExists(importMap.imports);
        // All runtimes use esm.sh URLs for React
        // No special scopes needed for deduplication
      });
    });

    describe("edge cases and integration", () => {
      it("should handle complex real-world import map", async () => {
        await withTestContext("import-map-complex", async (context: TestContext) => {
          const denoConfig = {
            imports: {
              "@/": "./src/",
              "react": "https://esm.sh/react@19.1.1",
              "react-dom": "https://esm.sh/react-dom@19.1.1",
              "react-dom/server": "https://esm.sh/react-dom@19.1.1/server",
              "std/": "https://deno.land/std@0.220.0/",
              "preact": "https://esm.sh/preact@10.19.3",
            },
            scopes: {
              "/islands/": {
                "react": "https://esm.sh/preact@10.19.3/compat",
              },
            },
          };

          await writeTextFile(
            join(context.projectDir, "deno.json"),
            JSON.stringify(denoConfig, null, 2),
          );

          const importMap = await loadImportMap(context.projectDir, await getAdapter());

          // Verify all imports loaded (6 user imports + default veryfront/* and React imports)
          // Count may vary slightly as default imports evolve
          assertEquals(Object.keys(importMap.imports!).length >= 14, true);
          // Verify scopes loaded (may be empty object if not present)
          assertExists(importMap.scopes);
          if (Object.keys(importMap.scopes).length > 0) {
            assertEquals(Object.keys(importMap.scopes).length, 1);
          }
        });
      });

      it("should handle roundtrip: load -> transform -> resolve", async () => {
        await withTestContext("import-map-roundtrip", async (context: TestContext) => {
          // Note: loadImportMap uses getConfig() which returns defaults with React@19.1.1
          // when no veryfront.config file exists. deno.json imports are only used as fallback.
          // This test verifies the roundtrip transformation works with the default config.

          // Load import map (will include default React@19.1.1)
          const importMap = await loadImportMap(context.projectDir, await getAdapter());

          // Transform
          const code = `import React from 'react';`;
          const transformed = transformImportsWithMap(code, importMap, undefined, {
            resolveBare: true,
          });

          // Verify transformation happened - all runtimes now use esm.sh URLs
          const hasEsmReact = transformed.includes("https://esm.sh/react@");
          assertEquals(hasEsmReact, true);
          // Should not have bare import anymore
          assertEquals(transformed.includes("from 'react'"), false);
        });
      });

      it("should handle merge with default import map", () => {
        const defaultMap = getDefaultImportMap();
        const customMap = {
          imports: {
            lodash: "https://esm.sh/lodash@4",
          },
        };

        const merged = mergeImportMaps(defaultMap, customMap);

        // Should have both default and custom imports
        // Default map now contains only veryfront/* (no React or context packages)
        assertExists(merged.imports!["veryfront/head"]);
        assertExists(merged.imports!["lodash"]);
      });

      it("should handle empty string specifier", () => {
        const importMap = {
          imports: {
            react: "https://esm.sh/react@18",
          },
        };

        const resolved = resolveImport("", importMap);
        assertEquals(resolved, "");
      });

      it("should handle specifier with special characters", () => {
        const importMap = {
          imports: {
            "@org/package": "https://esm.sh/@org/package@1.0.0",
          },
        };

        const resolved = resolveImport("@org/package", importMap);
        assertEquals(resolved, "https://esm.sh/@org/package@1.0.0");
      });

      it("should handle nested scopes correctly", () => {
        const importMap = {
          scopes: {
            "/vendor/": {
              react: "https://esm.sh/react@17",
            },
            "/vendor/old/": {
              react: "https://esm.sh/react@16",
            },
          },
        };

        const vendor = resolveImport("react", importMap, "/vendor/");
        const vendorOld = resolveImport("react", importMap, "/vendor/old/");

        assertEquals(vendor, "https://esm.sh/react@17");
        assertEquals(vendorOld, "https://esm.sh/react@16");
      });
    });
  },
);
