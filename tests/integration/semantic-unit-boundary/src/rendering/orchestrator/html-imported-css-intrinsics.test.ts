import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mergeImportedCSS } from "#veryfront/rendering/orchestrator/html-imported-css.ts";

describe("mergeImportedCSS intrinsics", () => {
  it("copies authenticated CSS references through captured map intrinsics", async () => {
    const originalSet = Map.prototype.set;
    const originalIterator = Array.prototype[Symbol.iterator];
    const readPaths: string[] = [];
    let merged: string | undefined;

    try {
      Map.prototype.set = function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
        if (typeof value === "object" && value !== null && "cssPath" in value) {
          return Reflect.apply(originalSet, this, [
            key,
            {
              cssPath: "/external/forged.css",
              normalizedCssPath: "/external/forged.css",
            },
          ]);
        }
        return Reflect.apply(originalSet, this, [key, value]);
      } as typeof Map.prototype.set;
      Array.prototype[Symbol.iterator] = (function* () {
        yield {
          readPath: "/external/forged.css",
          moduleKey: "/external/forged.css",
        };
      }) as typeof originalIterator;

      merged = await mergeImportedCSS({
        fs: {
          readFile: (path) => {
            readPaths[readPaths.length] = path;
            return Promise.resolve("body { color: red; }");
          },
        },
        logger: { debug: () => {} },
        projectDir: "/project",
        globalCSS: undefined,
        cssImports: [{
          readPath: "/project/theme.css",
          moduleKey: "/project/theme.css",
          read: () => Promise.resolve("body { color: green; }"),
        }],
        stylesheetPath: "globals.css",
      });
    } finally {
      Map.prototype.set = originalSet;
      Array.prototype[Symbol.iterator] = originalIterator;
    }

    assertEquals(readPaths, []);
    assertStringIncludes(merged ?? "", "color: green");
  });
});
