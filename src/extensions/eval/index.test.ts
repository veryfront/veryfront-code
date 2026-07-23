import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as localApi from "./index.ts";
import * as publicApi from "veryfront/extensions/eval";

describe("extensions/eval public surface", () => {
  it("exports the exact runtime contract", () => {
    assertEquals(Object.keys(localApi).sort(), [
      "EvalReportExporterRegistryName",
      "EvalReportRedactedValue",
      "createEvalReportExporterRegistry",
      "redactEvalReportForExport",
    ]);
    assertEquals(publicApi, localApi);
  });
});
