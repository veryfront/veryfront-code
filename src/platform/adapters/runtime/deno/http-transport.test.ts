import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { needsDenoNodeHttpTransport } from "./http-transport.ts";

it("Deno transport selection is bounded to source-proven affected versions", () => {
  for (const version of ["2.9.7", "2.9.8"]) assertEquals(needsDenoNodeHttpTransport(version), true);
  for (const version of ["2.7.12", "2.9.6", "2.9.9", "3.0.0"]) {
    assertEquals(needsDenoNodeHttpTransport(version), false);
  }
});
