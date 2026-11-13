import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __resetOperatorVeryfrontApiOriginsForTests,
  __runWithOutboundFetchTransportForTests,
  createVeryfrontApiOriginBoundOutboundFetch,
} from "#veryfront/security/http/outbound-fetch.ts";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { setQuietMode } from "../../../../../../cli/utils/index.ts";
import { handleScheduleCommand } from "../../../../../../cli/commands/schedule/handler.ts";
import { handleWebhookCommand } from "../../../../../../cli/commands/webhook/handler.ts";

// A staging API whose DNS answer is private, as api.veryfront.org is on a VPN.
const apiUrl = "https://api.staging.example";
const envNames = ["VERYFRONT_API_URL", "VERYFRONT_API_TOKEN", "VERYFRONT_PROJECT_SLUG"] as const;

function privateApiTransport(reply: (url: string) => Response) {
  const requests: string[] = [];
  const answer = (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push(url);
    return Promise.resolve(reply(url));
  };
  return {
    requests,
    transport: {
      fetch: answer,
      pinnedFetch: (url: URL) => answer(url),
      resolveHost: () => Promise.resolve(["10.255.128.3"]),
    },
  };
}

describe("schedule and webhook trust the operator-exported Veryfront API origin", () => {
  const previous = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const name of envNames) previous.set(name, Deno.env.get(name));
    Deno.env.set("VERYFRONT_API_URL", apiUrl);
    Deno.env.set("VERYFRONT_API_TOKEN", "synthetic-token");
    Deno.env.set("VERYFRONT_PROJECT_SLUG", "alpha");
    _resetEnvironmentConfig();
    __resetOperatorVeryfrontApiOriginsForTests();
    setQuietMode(true);
  });

  afterEach(() => {
    setQuietMode(false);
    __resetOperatorVeryfrontApiOriginsForTests();
    for (const name of envNames) {
      const value = previous.get(name);
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
    _resetEnvironmentConfig();
  });

  it("schedule run --remote reaches a private staging API", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-schedule-private-api-" });
    const { requests, transport } = privateApiTransport(() => Response.json({ data: [] }));
    try {
      await __runWithOutboundFetchTransportForTests(
        transport,
        () =>
          assertRejects(() =>
            handleScheduleCommand({
              _: ["schedule", "run", "weekday-digest"],
              remote: true,
              "project-dir": projectDir,
            })
          ),
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
    assertEquals(requests.length > 0, true, "the private staging API must be dispatched to");
    assertEquals(requests.every((url) => url.startsWith(`${apiUrl}/`)), true);
  });

  for (
    const [command, handle] of [
      ["schedule", handleScheduleCommand],
      ["webhook", handleWebhookCommand],
    ] as const
  ) {
    it(`${command} seals the origin before it loads project code`, async () => {
      const projectDir = await Deno.makeTempDir({ prefix: `vf-${command}-private-api-` });
      const { requests, transport } = privateApiTransport(() => Response.json({}));
      try {
        await handle({ _: [command, "list"], "project-dir": projectDir });
        // A local agent target calls the Veryfront API (gateway, tools) through
        // this transport; it reaches the private origin only if the command
        // sealed the operator's origin at its entry.
        await __runWithOutboundFetchTransportForTests(
          transport,
          () => createVeryfrontApiOriginBoundOutboundFetch(apiUrl)(`${apiUrl}/ai/models`),
        );
      } finally {
        await stopEsbuild();
        await Deno.remove(projectDir, { recursive: true });
      }
      assertEquals(requests, [`${apiUrl}/ai/models`]);
    });
  }
});
