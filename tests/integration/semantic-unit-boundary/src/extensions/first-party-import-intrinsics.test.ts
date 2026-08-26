import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isMissingFirstPartyExtensionModule } from "#veryfront/extensions/first-party-import.ts";

describe("first-party extension import intrinsic boundary", () => {
  it("uses captured intrinsics for the Deno first-line retry", () => {
    const originalExec = RegExp.prototype.exec;
    const originalSplit = String.prototype.split;
    const denoMessage = [
      `Import "@veryfront/ext-auth-jwt" not a dependency`,
      "  hint: If you want to use the npm package, try running `deno add npm:@veryfront/ext-auth-jwt`",
      "    at file:///app/index.ts:1:8",
    ].join("\n");
    try {
      String.prototype.split = function (): string[] {
        throw new Error("poisoned split");
      };
      RegExp.prototype.exec = function (): RegExpExecArray | null {
        throw new Error("poisoned exec");
      };
      assertEquals(
        isMissingFirstPartyExtensionModule(new Error(denoMessage), [
          "@veryfront/ext-auth-jwt",
        ]),
        true,
      );
    } finally {
      RegExp.prototype.exec = originalExec;
      String.prototype.split = originalSplit;
    }
  });
});
