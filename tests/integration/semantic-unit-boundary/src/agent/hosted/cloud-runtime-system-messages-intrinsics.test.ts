import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { resolveHostedRuntimeSkillLoaderToolName } from "../../../../../../src/agent/hosted/cloud-runtime-system-messages.ts";

it("resolves hosted loader aliases despite project replacement of Array.includes", () => {
  const originalIncludes = Array.prototype.includes;
  let legacyLoader: string | undefined;
  let absentLoader: string | undefined;
  let canonicalLoader: string | undefined;
  try {
    Array.prototype.includes = () => true;
    legacyLoader = resolveHostedRuntimeSkillLoaderToolName(["load_skill"]);
    absentLoader = resolveHostedRuntimeSkillLoaderToolName([]);
    Array.prototype.includes = () => false;
    canonicalLoader = resolveHostedRuntimeSkillLoaderToolName(["veryfront__load_skill"]);
  } finally {
    Array.prototype.includes = originalIncludes;
  }
  assertEquals(legacyLoader, "load_skill");
  assertEquals(absentLoader, undefined);
  assertEquals(canonicalLoader, "veryfront__load_skill");
});
