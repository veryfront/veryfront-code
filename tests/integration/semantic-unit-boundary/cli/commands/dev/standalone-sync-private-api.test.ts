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
    for (const newProject of command === pushCommand && embedded ? [false, true] : [false]) {
      it(`${command.name} preserves operator private HTTPS API access (embedded=${embedded}, newProject=${newProject})`, async () => {
        const keys = ["VERYFRONT_API_URL", "VERYFRONT_API_BASE_URL", "VERYFRONT_API_TOKEN"];
        const previous = keys.map(getEnv);
        const projectDir = await Deno.makeTempDir();
        let dispatched = 0;
        let reservations = 0;
        const projectPaths: string[] = [];
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
          const userResponse = Response.json({ id: "user", email: "operator@example.com" });
          const missingResponse = Response.json({ detail: "missing" }, { status: 404 });
          const createdResponse = Response.json({ id: "created-project" }, { status: 201 });
          const rejectedResponses = Array.from(
            { length: 4 },
            () => Response.json({ detail: "private API reached" }, { status: 403 }),
          );
          const fields = ["ok", "json"];
          const descriptors = fields.map((name) =>
            [name, Object.getOwnPropertyDescriptor(Response.prototype, name)!] as const
          );
          const reply: typeof fetch = (input, init) => {
            const path = new URL(String(input)).pathname;
            if (path.includes("/projects")) {
              dispatched++;
              projectPaths.push(path);
              assertEquals(
                new Headers(init?.headers).get("authorization"),
                "Bearer operator-token",
              );
            }
            if (newProject && init?.method === "POST" && path === "/projects") {
              reservations++;
              return Promise.resolve(createdResponse);
            }
            return Promise.resolve(
              path === "/me"
                ? userResponse
                : newProject && reservations === 0
                ? missingResponse
                : rejectedResponses.shift()!,
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
                if (newProject) {
                  for (const [name, descriptor] of descriptors) {
                    const poison = () => {
                      ambientCalls++;
                      throw new Error("project received response");
                    };
                    Object.defineProperty(
                      Response.prototype,
                      name,
                      "get" in descriptor
                        ? { ...descriptor, get: poison }
                        : { ...descriptor, value: poison },
                    );
                  }
                }
              }
              let commandFailure: unknown;
              try {
                await command({
                  projectDir,
                  quiet: true,
                  dryRun: !newProject,
                  ...(embedded
                    ? { transport: createCloudOnboardingTransport("https://api.staging.example") }
                    : {}),
                });
              } catch (error) {
                commandFailure = error;
                /* Probe stops at a deliberate API rejection. */
              } finally {
                globalThis.fetch = originalFetch;
                if (newProject) {
                  for (const [name, descriptor] of descriptors) {
                    Object.defineProperty(Response.prototype, name, descriptor);
                  }
                }
              }
              assertEquals(ambientCalls, 0);
              assertEquals(
                (commandFailure as Error)?.message.includes("private API reached"),
                true,
              );
            }));
          assertEquals(dispatched > 0, true);
          if (newProject) {
            assertEquals(reservations, 1);
            assertEquals(
              projectPaths.some((path) => path.includes("/projects/created-project/")),
              true,
            );
          }
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
}
