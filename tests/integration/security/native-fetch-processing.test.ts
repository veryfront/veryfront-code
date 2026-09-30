import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  HEADER_METHODS,
  installCredentialProbes,
} from "../../../src/security/http/credential-probes.test-helpers.ts";
import {
  isCheckedNativeRequestProperty,
  recordNativePrototypeUse,
} from "../../../src/platform/compat/http/native-request-use.test-helpers.ts";
import {
  copyNativeHeaders,
  createNativeRequestInit,
} from "../../../src/platform/compat/http/native-request-init.ts";
import { guardedEgressFetch } from "../../../src/security/sandbox/worker-egress-guard.ts";

const BEARER = "Bearer vf-native-fetch-bearer-0a4d";

interface Received {
  authorization: string | null;
  method: string;
  body: string;
}

async function withServer(
  fn: (port: number, received: Received[]) => Promise<void>,
): Promise<void> {
  const received: Received[] = [];
  // The server shares the isolate with the probes, so it reads with originals.
  const headersGet = Headers.prototype.get;
  const requestHeaders = Object.getOwnPropertyDescriptor(Request.prototype, "headers")!.get!;
  const requestMethod = Object.getOwnPropertyDescriptor(Request.prototype, "method")!.get!;
  const requestText = Request.prototype.text;
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen() {} }, async (req) => {
    received.push({
      authorization: Reflect.apply(headersGet, Reflect.apply(requestHeaders, req, []), [
        "authorization",
      ]),
      method: Reflect.apply(requestMethod, req, []),
      body: await Reflect.apply(requestText, req, []),
    });
    return new Response("ok");
  });
  try {
    await fn(server.addr.port, received);
  } finally {
    await server.shutdown();
  }
}

function guardedDeps() {
  return {
    fetchImpl: globalThis.fetch.bind(globalThis),
    options: {
      allowInternalEgress: true,
      resolveHost: () => Promise.resolve(["127.0.0.1"]),
    },
  };
}

describe("native fetch with credential headers", () => {
  it("calls nothing outside the checked prototype members with the headers in reach", async () => {
    await withServer(async (port) => {
      const url = `http://127.0.0.1:${port}/v1`;
      const used = await recordNativePrototypeUse(async () => {
        const credentialHeaders = () => copyNativeHeaders({ authorization: BEARER });
        await (await fetch(
          url,
          createNativeRequestInit(undefined, {
            method: "POST",
            headers: credentialHeaders(),
            body: "{}",
          }),
        )).text();
        await (await fetch(
          new Request(
            url,
            createNativeRequestInit(undefined, { headers: credentialHeaders() }),
          ),
        )).text();
        await (await fetch(
          url,
          createNativeRequestInit(undefined, {
            method: "POST",
            headers: credentialHeaders(),
            body: new Blob(["{}"]).stream(),
            duplex: "half",
          }),
        )).text();
      });

      // Members the server side and response handling use have no request
      // headers in reach; only the request-side members matter here.
      const requestSide = used.filter((name) => !name.startsWith("Response."));
      assertEquals(requestSide.filter((name) => !isCheckedNativeRequestProperty(name)), []);
    });
  });

  it("sends a guarded request through native fetch without a patched intrinsic seeing the bearer", async () => {
    await withServer(async (port, received) => {
      const probes = installCredentialProbes({
        headerMethods: HEADER_METHODS.filter((name) => name !== "has" && name !== "append"),
      });
      try {
        await (await guardedEgressFetch(
          `http://localhost:${port}/v1/messages`,
          { method: "POST", headers: { authorization: BEARER }, body: '{"model":"m"}' },
          guardedDeps(),
        )).text();
      } finally {
        probes.restore();
      }

      assertEquals(probes.saw(BEARER), false);
      assertEquals(received, [{ authorization: BEARER, method: "POST", body: '{"model":"m"}' }]);
    });
  });

  it("refuses the native send once Headers has was replaced", async () => {
    await withServer(async (port, received) => {
      const probes = installCredentialProbes();
      try {
        await assertRejects(
          () =>
            guardedEgressFetch(
              `http://localhost:${port}/v1/messages`,
              { headers: { authorization: BEARER } },
              guardedDeps(),
            ),
          TypeError,
          "Refused a credential-bearing request",
        );
      } finally {
        probes.restore();
      }

      assertEquals(probes.saw(BEARER), false);
      assertEquals(received, []);
    });
  });
});
