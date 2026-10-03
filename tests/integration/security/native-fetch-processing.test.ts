import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
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
  assertNativeRequestProcessing,
  assertObjectPrototypeUnchanged,
  copyNativeHeaders,
  createNativeRequestInit,
} from "../../../src/platform/compat/http/native-request-init.ts";
import { fetchWithPinnedAddresses } from "../../../src/platform/compat/http/pinned-fetch.ts";
import * as nodeHttp from "node:http";
import * as nodeNet from "node:net";
import { EventEmitter } from "node:events";
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

// Object.prototype is shared by the whole isolate, so these run as integration tests.
describe("node:http options and a modified Object.prototype", () => {
  const PINNED_BEARER = "Bearer vf-pinned-bearer-41c9";

  it("refuses node:http options once Object.prototype gained or replaced a member", () => {
    assertObjectPrototypeUnchanged();
    const original = Object.getOwnPropertyDescriptor(Object.prototype, "toString")!;
    Object.defineProperty(Object.prototype, "lookup", { configurable: true, get: () => undefined });
    try {
      assertThrows(() => assertObjectPrototypeUnchanged(), TypeError, 'member "lookup"');
    } finally {
      delete (Object.prototype as Record<string, unknown>).lookup;
    }
    Object.defineProperty(Object.prototype, "toString", { ...original, value: () => "" });
    try {
      assertThrows(() => assertObjectPrototypeUnchanged(), TypeError, "Object.prototype");
    } finally {
      Object.defineProperty(Object.prototype, "toString", original);
    }
    assertObjectPrototypeUnchanged();
  });


  it("refuses the node:http call once Object.prototype gained a member", async () => {
    // node:http copies its options into an ordinary object and reads `agent`
    // and others from it, so a getter here would run with the headers in reach.
    let sawBearer = false;
    Object.defineProperty(Object.prototype, "agent", {
      configurable: true,
      get(this: { headers?: Record<string, unknown> }) {
        if (this?.headers && Object.values(this.headers).includes(PINNED_BEARER)) sawBearer = true;
        return undefined;
      },
    });
    try {
      await assertRejects(
        () =>
          fetchWithPinnedAddresses(new URL("http://pinned.example.test/"), ["127.0.0.1"], {
            headers: { authorization: PINNED_BEARER },
          }),
        TypeError,
        "Object.prototype",
      );
    } finally {
      delete (Object.prototype as Record<string, unknown>).agent;
    }
    assertEquals(sawBearer, false);
  });
});

// node:http's prototypes are shared by the whole process, so these run as integration tests.
describe("node:http members the pinned transport depends on", () => {
  const PINNED_BEARER = "Bearer vf-pinned-node-member-bearer-6e12";

  const hooks: [string, () => object, string][] = [
    ["OutgoingMessage.prototype.setHeader", () => nodeHttp.OutgoingMessage.prototype, "setHeader"],
    ["OutgoingMessage.prototype.getHeader", () => nodeHttp.OutgoingMessage.prototype, "getHeader"],
    ["ClientRequest.prototype.setHeader (own)", () => nodeHttp.ClientRequest.prototype, "setHeader"],
    ["EventEmitter.prototype.emit", () => EventEmitter.prototype, "emit"],
    ["Agent.prototype.addRequest", () => nodeHttp.Agent.prototype, "addRequest"],
    ["net.Socket.prototype.write", () => nodeNet.Socket.prototype, "write"],
  ];

  for (const [label, target, key] of hooks) {
    it(`refuses the request once ${label} was replaced`, async () => {
      const prototype = target() as Record<string, unknown>;
      const original = Object.getOwnPropertyDescriptor(prototype, key);
      let sawBearer = false;
      const inherited = original?.value ?? (prototype[key] as unknown);
      Object.defineProperty(prototype, key, {
        configurable: true,
        writable: true,
        value: function (this: unknown, ...args: unknown[]) {
          if (JSON.stringify(args).includes(PINNED_BEARER)) sawBearer = true;
          return typeof inherited === "function" ? Reflect.apply(inherited, this, args) : undefined;
        },
      });
      try {
        await assertRejects(
          () =>
            fetchWithPinnedAddresses(new URL("http://pinned.example.test:9/"), ["127.0.0.1"], {
              headers: { authorization: PINNED_BEARER },
            }),
          TypeError,
          "node:http member",
        );
      } finally {
        if (original) Object.defineProperty(prototype, key, original);
        else Reflect.deleteProperty(prototype, key);
      }
      assertEquals(sawBearer, false);
    });
  }
});

describe("the native-processing checks themselves", () => {
  it("never read an inherited descriptor field", () => {
    // A data descriptor owns no `get` or `set`: reading them would run a
    // getter project code put on Object.prototype, with the descriptor (and
    // the member it describes) as `this`.
    let calls = 0;
    const hook: PropertyDescriptor = {
      configurable: true,
      get() {
        calls++;
        return undefined;
      },
    };
    Object.defineProperty(Object.prototype, "get", hook);
    Object.defineProperty(Object.prototype, "set", hook);
    try {
      assertNativeRequestProcessing();
    } finally {
      delete (Object.prototype as { get?: unknown }).get;
      delete (Object.prototype as { set?: unknown }).set;
    }
    assertEquals(calls, 0);
  });
});
