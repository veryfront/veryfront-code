import { it } from "#veryfront/testing/bdd.ts";
import { verifyRuntimeIdentityStartup } from "./runtime-identity-startup-test-helpers.ts";

it("standalone startup captures processTarget env identity before importing project code", async () => {
  await verifyRuntimeIdentityStartup("processTarget");
});
