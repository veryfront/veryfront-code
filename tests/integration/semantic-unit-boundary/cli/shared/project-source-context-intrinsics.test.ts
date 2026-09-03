/**
 * Proxy project-source context credential handling under poisoned intrinsics.
 *
 * `withProjectSourceContext()` executes project config before
 * `getProxyProjectSourceContext()` runs, so a hostile config can replace
 * `String.prototype.trim` or `Reflect.apply` first. Normalizing the
 * host-private stored login token must not hand it to either replacement.
 * Prototype and intrinsic replacement is a process-global effect, so this
 * lives in the semantic integration suite.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  deleteEnv,
  deleteHostSecret,
  setEnv,
  setHostSecret,
} from "#veryfront/platform/compat/process/env.ts";

import { getProxyProjectSourceContext } from "../../../../../cli/shared/project-source-context.ts";

const TOKEN = "stored-login-token";
const testApply = Reflect.apply;

function containsToken(value: unknown): boolean {
  return typeof value === "string" && value.indexOf(TOKEN) !== -1;
}

describe("project-source-context credential intrinsic boundary", () => {
  it("keeps the stored login token away from replaced trim and Reflect.apply", () => {
    setEnv("VERYFRONT_PROJECT_SLUG", "proxy-project");
    setHostSecret("VERYFRONT_API_TOKEN", TOKEN);

    const nativeTrim = String.prototype.trim;
    const nativeApply = Reflect.apply;
    let observedCredential = 0;

    try {
      String.prototype.trim = function (this: unknown): string {
        if (containsToken(this)) observedCredential += 1;
        return testApply(nativeTrim, this, []) as string;
      };
      Reflect.apply = function (
        target: (...args: unknown[]) => unknown,
        thisArgument: unknown,
        argumentsList: ArrayLike<unknown>,
      ): unknown {
        if (containsToken(thisArgument)) observedCredential += 1;
        for (let index = 0; index < argumentsList.length; index++) {
          if (containsToken(argumentsList[index])) observedCredential += 1;
        }
        return testApply(target, thisArgument, argumentsList);
      } as typeof Reflect.apply;

      const context = getProxyProjectSourceContext();

      // The credential still reaches the proxy context, and the poisoned
      // hooks never received it as a receiver or an argument.
      assertEquals(context?.token, TOKEN);
      assertEquals(context?.projectSlug, "proxy-project");
      assertEquals(observedCredential, 0);
    } finally {
      String.prototype.trim = nativeTrim;
      Reflect.apply = nativeApply;
      deleteHostSecret("VERYFRONT_API_TOKEN");
      try {
        deleteEnv("VERYFRONT_PROJECT_SLUG");
      } catch {
        // expected: env may already be unset
      }
    }
  });
});
