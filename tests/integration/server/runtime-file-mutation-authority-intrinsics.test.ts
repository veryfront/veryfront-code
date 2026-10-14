import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { isRuntimeFileMutationRequest } from "#veryfront/server/handlers/request/runtime-file-mutation-authority.ts";

it("uses captured regex execution despite project prototype replacement", () => {
  const original = RegExp.prototype.exec;
  RegExp.prototype.exec = () => original.call(/forged/, "forged");
  try {
    assertEquals(isRuntimeFileMutationRequest("POST", "/projects/p/files/batch"), false);
    assertEquals(isRuntimeFileMutationRequest("DELETE", "/projects/p/files/current"), true);
  } finally {
    RegExp.prototype.exec = original;
  }
});
