/**
 * Runtime-auth credential handling under poisoned shared-realm intrinsics.
 *
 * `veryfront dev` executes project config before `applyRuntimeAuthContext()`
 * resolves the stored login token, so a hostile config can replace
 * `String.prototype.trim` or `Reflect.apply` first. Neither replacement may
 * observe the credential. Prototype and intrinsic replacement is a
 * process-global effect, so this lives in the semantic integration suite
 * rather than `cli/shared/runtime-auth.test.ts`.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  deleteEnv,
  deleteHostSecret,
  getHostEnv,
  setEnv,
} from "#veryfront/platform/compat/process/env.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";

import { saveToken } from "../../../../../cli/auth/token-store.ts";
import { applyRuntimeAuthContext } from "../../../../../cli/shared/runtime-auth.ts";

const TOKEN = "stored-login-token";
const testApply = Reflect.apply;

function containsToken(value: unknown): boolean {
  return typeof value === "string" && value.indexOf(TOKEN) !== -1;
}

describe("runtime-auth credential intrinsic boundary", () => {
  it("keeps the stored login token away from replaced trim and Reflect.apply", async () => {
    await withTempDir(async (configHome) => {
      setEnv("XDG_CONFIG_HOME", configHome);
      await saveToken(TOKEN);

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

        const context = await applyRuntimeAuthContext({});

        // The credential still resolves and registers host-privately, and the
        // poisoned hooks never received it as a receiver or an argument.
        assertEquals(context.apiToken, TOKEN);
        assertEquals(getHostEnv("VERYFRONT_API_TOKEN"), TOKEN);
        assertEquals(observedCredential, 0);
      } finally {
        String.prototype.trim = nativeTrim;
        Reflect.apply = nativeApply;
        deleteHostSecret("VERYFRONT_API_TOKEN");
        for (const key of ["XDG_CONFIG_HOME", "VERYFRONT_SERVICE_LAYER"]) {
          try {
            deleteEnv(key);
          } catch {
            // expected: env may already be unset
          }
        }
      }
    }, { prefix: "vf-runtime-auth-intrinsics-" });
  });
});
