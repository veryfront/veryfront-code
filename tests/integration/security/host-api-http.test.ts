import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

const moduleUrl = new URL("../../../src/config/host-api-base.ts", import.meta.url).href;
const origin = "http://127.0.0.1:4000";

async function boot(apiUrl: string, script: string) {
  const result = await new Deno.Command(Deno.execPath(), {
    args: [
      "eval",
      "--cached-only",
      "--config",
      "deno.json",
      `
      const { requireHostPrivateApiHttps } = await import(${JSON.stringify(moduleUrl)});
      const accepted = (url) => { try { requireHostPrivateApiHttps(url); return true; } catch { return false; } };
      ${script}
    `,
    ],
    env: {
      DENO_TESTING: "0",
      VERYFRONT_API_URL: apiUrl,
      VERYFRONT_API_BASE_URL: "",
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
  return JSON.parse(new TextDecoder().decode(result.stdout));
}

describe("host HTTP API origin at process boot", () => {
  it("cannot be enabled by a later process-environment write", async () => {
    const result = await boot(
      "",
      `
      Deno.env.set('VERYFRONT_API_URL', '${origin}');
      console.log(JSON.stringify(accepted('${origin}')));
    `,
    );
    assertEquals(result, false);
  });

  it("cannot be redirected by changing the API URL after boot", async () => {
    const result = await boot(
      origin,
      `
      Deno.env.set('VERYFRONT_API_URL', 'http://127.0.0.1:4001');
      console.log(JSON.stringify([accepted('${origin}'), accepted('http://127.0.0.1:4001')]));
    `,
    );
    assertEquals(result, [true, false]);
  });
  it("uses real HTTP only for the approved API and rejects redirect credential forwarding", async () => {
    let forwarded = 0;
    const attacker = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, () => {
      forwarded++;
      return new Response("unexpected");
    });
    const credentials: string[] = [];
    const api = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (request) => {
      credentials.push(request.headers.get("authorization") ?? "");
      if (new URL(request.url).pathname === "/redirect") {
        return new Response(null, {
          status: 302,
          headers: { location: `http://127.0.0.1:${attacker.addr.port}/collect` },
        });
      }
      return Response.json({ ok: true });
    });
    const endpoint = `http://127.0.0.1:${api.addr.port}`;
    const transportUrl =
      new URL("../../../src/security/http/outbound-fetch.ts", import.meta.url).href;
    try {
      const result = await boot(
        endpoint,
        `
        requireHostPrivateApiHttps('${endpoint}');
        const { createVeryfrontApiOriginBoundOutboundFetch } = await import(${
          JSON.stringify(transportUrl)
        });
        const request = createVeryfrontApiOriginBoundOutboundFetch('${endpoint}');
        const init = { headers: { authorization: 'Bearer <LOCAL_TEST_TOKEN>' } };
        const response = await request('${endpoint}/health', init);
        const body = await response.json();
        let redirectBlocked = false;
        try { await request('${endpoint}/redirect', init); } catch { redirectBlocked = true; }
        console.log(JSON.stringify([body.ok, redirectBlocked]));
      `,
      );
      assertEquals(result, [true, true]);
      assertEquals(credentials, ["Bearer <LOCAL_TEST_TOKEN>", "Bearer <LOCAL_TEST_TOKEN>"]);
      assertEquals(forwarded, 0);
    } finally {
      await api.shutdown();
      await attacker.shutdown();
    }
  });
});
