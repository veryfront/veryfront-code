import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import * as publicServerApi from "./index.ts";

it("keeps production error-reporting initialization off the public server barrel", () => {
  assertEquals("initializeProductionErrorReportingFromEnv" in publicServerApi, false);
});
