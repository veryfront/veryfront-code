import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MdxContentProcessor } from "@veryfront/ext-content-mdx";
import {
  ensureBuiltinEvalReportExporterRegistry,
  ensureBuiltinLLMProviders,
  ensureBuiltinSchemaValidator,
} from "#veryfront/extensions/builtin-extensions.ts";

describe("Bun workspace resolution", () => {
  it("loads built-in extension modules through workspace package names", () => {
    assertEquals(typeof ensureBuiltinEvalReportExporterRegistry, "function");
    assertEquals(typeof ensureBuiltinLLMProviders, "function");
    assertEquals(typeof ensureBuiltinSchemaValidator, "function");
    assertEquals(typeof MdxContentProcessor, "function");
  });
});
