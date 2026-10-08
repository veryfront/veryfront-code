import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  ARRAY_WRITE_ROUTES,
  installArrayWriteProbe,
  installCredentialProbes,
} from "#veryfront/security/http/credential-probes.test-helpers.ts";
import {
  isCheckedNativeRequestProperty,
  recordNativePrototypeUse,
  replaceRequestSignalGetter,
} from "./native-request-use.test-helpers.ts";
import {
  assertArrayWritesUnobserved,
  assertNativeRequestProcessing,
  copyNativeHeaders,
  createNativeRequest,
  createNativeRequestInit,
  NATIVE_REQUEST_INIT_FIELDS,
  nativeFetchArguments,
  readOwnInitField,
  readSeparateSetCookies,
  toNativeHeaderRecord,
} from "./native-request-init.ts";

const BEARER = "Bearer vf-outbound-secret-5c8e";

// Probe tests pin what Deno 2.7.7's own Request and fetch call through the
// live prototypes; Node's undici and Bun take different internal paths.
const DENO_INTERNALS = { ignore: !isDeno };

describe("platform/compat/http/native-request-init", () => {
  for (const route of ARRAY_WRITE_ROUTES) {
    it(`refuses a credential-bearing call while ${route} observes array writes`, () => {
      assertNativeRequestProcessing();
      const probe = installArrayWriteProbe(route);
      let exposed: boolean;
      try {
        assertThrows(() => assertArrayWritesUnobserved(), TypeError, "Refused");
        assertThrows(() => assertNativeRequestProcessing(), TypeError, "Refused");
        // The helpers check at the fill and the read themselves.
        assertThrows(() => copyNativeHeaders({ authorization: BEARER }), TypeError, "Refused");
        assertThrows(() => toNativeHeaderRecord(new Headers()), TypeError, "Refused");
        // What the refusal prevents: the runtime's own header handling,
        // through captured methods alone, hands the bearer to the probe.
        const headers = new Headers();
        Reflect.apply(Headers.prototype.append, headers, ["authorization", BEARER]);
        Reflect.apply(Headers.prototype.get, headers, ["authorization"]);
        Reflect.apply(Headers.prototype.delete, headers, ["authorization"]);
        exposed = probe.saw(BEARER);
      } finally {
        probe.restore();
      }
      // Pinned to Deno 2.7.7's header list; Node's undici and Bun store it differently.
      if (isDeno) assertEquals(exposed, true);
      assertNativeRequestProcessing();
    });
  }

  it(
    "builds the headers and init without a patched intrinsic seeing the bearer",
    DENO_INTERNALS,
    () => {
      const fromHeaders = new Headers({ authorization: BEARER, accept: "application/json" });
      const fromRecord = { authorization: BEARER, accept: "application/json" };
      const fromPairs: [string, string][] = [["authorization", BEARER], ["accept", "text/plain"]];
      const signal = new AbortController().signal;
      const probes = installCredentialProbes();
      const requests: Request[] = [];
      try {
        for (const source of [fromHeaders, fromRecord, fromPairs]) {
          const headers = copyNativeHeaders(source);
          const init = createNativeRequestInit(undefined, { method: "GET", headers, signal });
          requests.push(new Request("https://api.example.test/v1/models", init));
        }
        // An ordinary init from a caller is rebuilt before the native call.
        requests.push(
          new Request(
            "https://api.example.test/v1/models",
            createNativeRequestInit({ headers: fromRecord, redirect: "manual" }),
          ),
        );
      } finally {
        probes.restore();
      }

      assertEquals(probes.saw(BEARER), false);
      assertEquals(requests.map((request) => request.headers.get("authorization")), [
        BEARER,
        BEARER,
        BEARER,
        BEARER,
      ]);
    },
  );

  it(
    "refuses a credential-bearing native call once its prototypes were replaced",
    DENO_INTERNALS,
    () => {
      assertNativeRequestProcessing();
      const probes = installCredentialProbes();
      try {
        // The probes replace Headers.prototype.has and append, which the native
        // Request constructor and fetch call with the headers as `this`.
        assertThrows(
          () => assertNativeRequestProcessing(),
          TypeError,
          "Headers.prototype.has was replaced",
        );
      } finally {
        probes.restore();
      }
      assertNativeRequestProcessing();

      const restoreSignal = replaceRequestSignalGetter();
      try {
        assertThrows(
          () => assertNativeRequestProcessing(),
          TypeError,
          "Request.prototype.signal was replaced",
        );
      } finally {
        restoreSignal();
      }
      assertNativeRequestProcessing();
    },
  );

  it(
    "checks everything the native Request constructor calls with the headers in reach",
    DENO_INTERNALS,
    () => {
      const used = recordNativePrototypeUse(() => {
        new Request(
          "https://api.example.test/v1/messages",
          createNativeRequestInit(undefined, {
            method: "POST",
            headers: copyNativeHeaders({ authorization: BEARER }),
            body: '{"model":"m"}',
          }),
        );
        const base = new Request("https://api.example.test/v1/messages", {
          method: "POST",
          body: "{}",
        });
        new Request(
          base,
          createNativeRequestInit(undefined, {
            headers: copyNativeHeaders({ authorization: BEARER }),
            body: '{"model":"m"}',
          }),
        );
      });

      assertEquals(used.filter((name) => !isCheckedNativeRequestProperty(name)), []);
    },
  );

  it("is what stops the probes: the ordinary forms expose the bearer", DENO_INTERNALS, () => {
    const headers = new Headers({ authorization: BEARER });
    const probes = installCredentialProbes();
    try {
      new Request("https://api.example.test/", { headers });
    } finally {
      probes.restore();
    }

    assertEquals(probes.saw(BEARER), true);
    assertEquals((probes.calls["Object.prototype.method"] ?? 0) > 0, true);
    assertEquals((probes.calls["next"] ?? 0) > 0, true);
  });

  it("gives the init every native field as its own property", () => {
    const headers = new Headers({ authorization: BEARER });
    const init = createNativeRequestInit({ method: "PUT", keepalive: true }, { headers });

    assertEquals(Object.getPrototypeOf(init), null);
    for (const field of NATIVE_REQUEST_INIT_FIELDS) {
      assertEquals(Object.hasOwn(init, field), true, field);
    }
    assertEquals(init.method, "PUT");
    assertEquals(init.keepalive, true);
    assertEquals(init.body, undefined);
    assertEquals(Object.getPrototypeOf(init.headers), null);
    assertEquals({ ...init.headers as Record<string, string> }, { authorization: BEARER });
    // A spread keeps every field its own, so it inherits nothing either.
    assertEquals(Object.hasOwn({ ...init }, "signal"), true);
  });

  it("keeps the request semantics a plain init gives", async () => {
    const controller = new AbortController();
    const request = new Request(
      "https://api.example.test/v1/messages",
      createNativeRequestInit(undefined, {
        method: "POST",
        headers: copyNativeHeaders({ "content-type": "application/json", "x-a": "1" }),
        body: '{"model":"m"}',
        redirect: "error",
        signal: controller.signal,
      }),
    );

    assertEquals(request.method, "POST");
    assertEquals(request.redirect, "error");
    assertEquals([...request.headers], [["content-type", "application/json"], ["x-a", "1"]]);
    assertEquals(await request.text(), '{"model":"m"}');
    assertEquals(request.signal.aborted, false);
    controller.abort();
    assertEquals(request.signal.aborted, true);
  });

  it("keeps a caller's non-enumerable init fields", async () => {
    const base = {} as RequestInit;
    Object.defineProperty(base, "method", { value: "POST", enumerable: false });
    Object.defineProperty(base, "body", { value: "{}", enumerable: false });
    Object.defineProperty(base, "headers", { value: { "x-a": "1" }, enumerable: false });

    const request = new Request("https://api.example.test/", createNativeRequestInit(base));

    assertEquals(request.method, "POST");
    assertEquals(await request.text(), "{}");
    assertEquals(request.headers.get("x-a"), "1");
  });

  it("reads each own init accessor once", () => {
    let reads = 0;
    const base = {} as RequestInit;
    Object.defineProperty(base, "method", {
      enumerable: true,
      get: () => (reads++ === 0 ? "POST" : "GET"),
    });

    const init = createNativeRequestInit(base);

    assertEquals(reads, 1);
    assertEquals(init.method, "POST");
  });

  it("keeps each set-cookie field separate through records, requests and fetch arguments", () => {
    const expiring = "a=1; Expires=Wed, 01 Oct 2026 07:28:00 GMT";
    const headers = new Headers({ authorization: BEARER });
    headers.append("set-cookie", expiring);
    headers.append("set-cookie", "b=2; Path=/");

    const record = toNativeHeaderRecord(headers);
    assertEquals(record["set-cookie"], undefined);
    assertEquals(readSeparateSetCookies(record), [expiring, "b=2; Path=/"]);
    assertEquals(copyNativeHeaders(record).getSetCookie(), [expiring, "b=2; Path=/"]);

    const init = createNativeRequestInit(undefined, { headers });
    const request = createNativeRequest("https://api.example.test/", init);
    assertEquals(request.headers.getSetCookie(), [expiring, "b=2; Path=/"]);
    assertEquals(request.headers.get("authorization"), BEARER);

    const fetchArguments = nativeFetchArguments("https://api.example.test/", init);
    const sent = new Request(fetchArguments[0], fetchArguments[1]);
    assertEquals(sent.headers.getSetCookie(), [expiring, "b=2; Path=/"]);
    assertEquals(sent.headers.get("authorization"), BEARER);
  });

  it("accepts an iterable of header pairs, as the native conversion does", () => {
    const pairs = new Map([["x-a", "1"], ["x-b", "2"]]);

    assertEquals(toNativeHeaderRecord(copyNativeHeaders(pairs as unknown as HeadersInit)), {
      "x-a": "1",
      "x-b": "2",
    });
    const init = createNativeRequestInit({ headers: pairs as unknown as HeadersInit });
    assertEquals({ ...init.headers as Record<string, string> }, { "x-a": "1", "x-b": "2" });
  });

  it("normalises each header value before joining repeats, as Headers does", () => {
    const init = createNativeRequestInit(undefined, {
      headers: [["x-test", "a\r\n"], ["x-test", " b "]],
    });

    assertEquals((init.headers as Record<string, string>)["x-test"], "a, b");
    assertEquals(
      new Request("https://api.example.test/", init).headers.get("x-test"),
      new Request("https://api.example.test/", {
        headers: [["x-test", "a\r\n"], ["x-test", " b "]],
      }).headers.get("x-test"),
    );
  });

  it("treats a plain record with its own iterator as header pairs", () => {
    const pairs = {
      *[Symbol.iterator]() {
        yield ["authorization", BEARER];
        yield ["x-a", "1"];
      },
    };

    const init = createNativeRequestInit({ headers: pairs as unknown as HeadersInit });
    assertEquals({ ...init.headers as Record<string, string> }, {
      authorization: BEARER,
      "x-a": "1",
    });
    assertEquals(copyNativeHeaders(pairs as unknown as HeadersInit).get("authorization"), BEARER);
  });

  it("reads only own init fields", () => {
    const inherited = Object.create({ method: "DELETE" }) as RequestInit;
    inherited.headers = { accept: "*/*" };

    assertEquals(readOwnInitField(inherited, "method"), undefined);
    assertEquals(readOwnInitField(inherited, "headers"), { accept: "*/*" });
    assertEquals(readOwnInitField(undefined, "body"), undefined);
  });

  it("copies repeated names as the wire joins them and rejects malformed pairs", () => {
    const headers = copyNativeHeaders([["accept", "a"], ["accept", "b"]]);
    assertEquals(toNativeHeaderRecord(headers).accept, "a, b");
    assertThrows(
      () => copyNativeHeaders([["accept"]] as unknown as HeadersInit),
      TypeError,
    );
  });
});
