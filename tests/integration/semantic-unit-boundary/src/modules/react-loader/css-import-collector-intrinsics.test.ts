import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  getCSSImportReferences,
  registerCSSImport,
  runWithCSSCollector,
} from "#veryfront/modules/react-loader/css-import-collector.ts";

it("stores and reads contained CSS references through captured map intrinsics", async () => {
  const originalSet = Map.prototype.set;
  const read = () => Promise.resolve("body { color: green; }");

  try {
    Map.prototype.set = function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
      if (typeof value === "object" && value !== null && "readPath" in value) {
        return Reflect.apply(originalSet, this, [
          key,
          { readPath: "/external/forged.css", moduleKey: "/external/forged.css" },
        ]);
      }
      return Reflect.apply(originalSet, this, [key, value]);
    } as typeof Map.prototype.set;

    let references = getCSSImportReferences();
    const { cssImports } = await runWithCSSCollector(() => {
      registerCSSImport("/project/theme.css", "/project/theme.module.css", read);
      references = getCSSImportReferences();
    });

    assertEquals(cssImports, ["/project/theme.css"]);
    assertEquals(references.length, 1);
    assertEquals(references[0]?.readPath, "/project/theme.css");
    assertEquals(references[0]?.moduleKey, "/project/theme.module.css");
    assertStrictEquals(references[0]?.read, read);
  } finally {
    Map.prototype.set = originalSet;
  }
});
