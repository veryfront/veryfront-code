import "#veryfront/schemas/_test-setup.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  deleteEnv,
  getEnv,
  resetHostApiOriginSnapshot,
  setEnv,
} from "#veryfront/platform/compat/process/env.ts";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import {
  __resetOperatorVeryfrontApiOriginsForTests,
  __runWithOutboundFetchTransportForTests,
} from "#veryfront/security/http/outbound-fetch.ts";
import { createCloudOnboardingTransport } from "../../../../../../cli/shared/cloud-onboarding-transport.ts";
import { trustOperatorConfiguredVeryfrontApiOrigins } from "#veryfront/security/http/outbound-fetch.ts";
import { pullCommand } from "../../../../../../cli/commands/pull/command.ts";
import { pushCommand } from "../../../../../../cli/commands/push/command.ts";

for (const command of [pullCommand, pushCommand]) {
  for (const embedded of [false, true]) {
    it(`${command.name} preserves operator private HTTPS API access (embedded=${embedded})`, async () => {
      const keys = ["VERYFRONT_API_URL", "VERYFRONT_API_BASE_URL", "VERYFRONT_API_TOKEN"];
      const previous = keys.map(getEnv);
      const projectDir = await Deno.makeTempDir();
      let dispatched = 0;
      try {
        setEnv("VERYFRONT_API_URL", "https://api.staging.example");
        deleteEnv("VERYFRONT_API_BASE_URL");
        setEnv("VERYFRONT_API_TOKEN", "operator-token");
        resetHostApiOriginSnapshot();
        __resetOperatorVeryfrontApiOriginsForTests();
        _resetEnvironmentConfig();
        await Deno.writeTextFile(
          `${projectDir}/veryfront.json`,
          JSON.stringify({ projectSlug: "alpha" }),
        );
        const reply: typeof fetch = (input, init) => {
          if (new URL(String(input)).pathname.includes("/projects")) {
            dispatched++;
            assertEquals(new Headers(init?.headers).get("authorization"), "Bearer operator-token");
          }
          return Promise.resolve(
            new URL(String(input)).pathname === "/me"
              ? Response.json({ id: "user", email: "operator@example.com" })
              : Response.json({ detail: "private API reached" }, { status: 403 }),
          );
        };
        await withMockFetch(reply, () =>
          __runWithOutboundFetchTransportForTests({
            fetch: reply,
            pinnedFetch: (url, _addresses, init) => {
              return reply(url, init);
            },
            resolveHost: () => Promise.resolve(["10.0.0.8"]),
          }, async () => {
            const originalFetch = globalThis.fetch;
            let ambientCalls = 0;
            if (embedded) {
              trustOperatorConfiguredVeryfrontApiOrigins();
              globalThis.fetch = () => {
                ambientCalls++;
                throw new Error("project received token");
              };
            }
            try {
              await command({
                projectDir,
                quiet: true,
                dryRun: true,
                ...(embedded
                  ? { transport: createCloudOnboardingTransport("https://api.staging.example") }
                  : {}),
              });
            } catch {
              /* Probe stops at a deliberate API rejection. */
            } finally {
              globalThis.fetch = originalFetch;
            }
            assertEquals(ambientCalls, 0);
          }));
        assertEquals(dispatched > 0, true);
      } finally {
        keys.forEach((key, index) =>
          previous[index] === undefined ? deleteEnv(key) : setEnv(key, previous[index]!)
        );
        resetHostApiOriginSnapshot();
        __resetOperatorVeryfrontApiOriginsForTests();
        _resetEnvironmentConfig();
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  }
}
