import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveHostAddresses } from "./dns.ts";

type ResolveDns = typeof Deno.resolveDns;

async function withResolveDns(
  resolver: unknown,
  operation: () => Promise<void>,
): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(Deno, "resolveDns");
  Object.defineProperty(Deno, "resolveDns", {
    configurable: true,
    enumerable: true,
    value: resolver,
    writable: true,
  });
  try {
    await operation();
  } finally {
    if (descriptor) Object.defineProperty(Deno, "resolveDns", descriptor);
  }
}

function unresolvedAddresses(): Promise<string[]> {
  return new Promise(() => {});
}

describe("platform/compat/dns", () => {
  it("keeps requested family order and removes duplicate addresses", async () => {
    const calls: string[] = [];
    await withResolveDns(
      ((_: string, type: string) => {
        calls.push(type);
        return Promise.resolve(
          type === "AAAA" ? ["2001:db8::1"] : ["203.0.113.1", "203.0.113.1"],
        );
      }) as ResolveDns,
      async () => {
        assertEquals(
          await resolveHostAddresses("example.test", { recordTypes: ["AAAA", "A"] }),
          ["2001:db8::1", "203.0.113.1"],
        );
        assertEquals(calls, ["AAAA", "A"]);
      },
    );
  });

  it("treats a missing address family as an empty result for that family", async () => {
    await withResolveDns(
      ((_: string, type: string) => {
        if (type === "AAAA") {
          return Promise.reject(Object.assign(new Error("no records"), { name: "NotFound" }));
        }
        return Promise.resolve(["203.0.113.2"]);
      }) as ResolveDns,
      async () => {
        assertEquals(await resolveHostAddresses("example.test"), ["203.0.113.2"]);
      },
    );
  });

  it("does not hide or expose operational resolver failures", async () => {
    await withResolveDns(
      (() => Promise.reject(new Error("PRIVATE_DNS_FAILURE_CANARY"))) as ResolveDns,
      async () => {
        const error = await assertRejects(
          () => resolveHostAddresses("internal.example.test", { recordTypes: ["A"] }),
          Error,
          "DNS lookup failed",
        );
        assert(error instanceof Error);
        assertEquals(error.message.includes("PRIVATE_DNS_FAILURE_CANARY"), false);
      },
    );
  });

  it("bounds the complete lookup with a configurable timeout", async () => {
    await withResolveDns(
      (() => unresolvedAddresses()) as unknown as ResolveDns,
      async () => {
        await assertRejects(
          () => resolveHostAddresses("example.test", { recordTypes: ["A"], timeoutMs: 1 }),
          Error,
          "DNS lookup timed out",
        );
      },
    );
  });

  it("honors an already-aborted caller signal", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;

    await withResolveDns(
      () => {
        calls++;
        return unresolvedAddresses();
      },
      async () => {
        await assertRejects(
          () =>
            resolveHostAddresses("example.test", {
              recordTypes: ["A"],
              signal: controller.signal,
            }),
          DOMException,
          "cancelled",
        );
        assertEquals(calls, 0);
      },
    );
  });

  it("fails explicitly when the native resolver is unavailable", async () => {
    await withResolveDns(
      undefined,
      async () => {
        await assertRejects(
          () => resolveHostAddresses("example.test", { recordTypes: ["A"] }),
          Error,
          "DNS resolution is not available in this runtime",
        );
      },
    );
  });

  it("cancels an in-flight lookup and consumes its late failure", async () => {
    const controller = new AbortController();
    let rejectLookup: ((error: Error) => void) | undefined;
    await withResolveDns(
      (() =>
        new Promise<string[]>((_, reject) => {
          rejectLookup = reject;
        })) as unknown as ResolveDns,
      async () => {
        const pending = resolveHostAddresses("example.test", {
          recordTypes: ["A"],
          signal: controller.signal,
        });
        controller.abort();

        await assertRejects(() => pending, DOMException, "cancelled");
        rejectLookup?.(new Error("late resolver failure"));
        await Promise.resolve();
      },
    );
  });

  it("rejects malformed and unreadable options before resolving", async () => {
    let calls = 0;
    await withResolveDns(
      (() => {
        calls++;
        return Promise.resolve(["203.0.113.5"]);
      }) as unknown as ResolveDns,
      async () => {
        await assertRejects(
          () => resolveHostAddresses("", {}),
          Error,
          "hostname",
        );
        await assertRejects(
          () =>
            resolveHostAddresses("example.test", {
              recordTypes: ["A"],
              timeoutMs: 2 ** 31,
            }),
          Error,
          "timeoutMs",
        );
        await assertRejects(
          () =>
            resolveHostAddresses(
              "example.test",
              new Proxy({ recordTypes: ["A"] as const }, {
                get() {
                  throw new Error("PRIVATE_OPTIONS_CANARY");
                },
              }),
            ),
          Error,
          "options are not readable",
        );

        const hostileRecordTypes = new Proxy(["A"] as const, {
          get(target, property, receiver) {
            if (property === "0") {
              throw new Error("PRIVATE_RECORD_TYPES_CANARY");
            }
            return Reflect.get(target, property, receiver);
          },
        });
        const error = await assertRejects(
          () => resolveHostAddresses("example.test", { recordTypes: hostileRecordTypes }),
          Error,
          "recordTypes are not readable",
        );
        assert(error instanceof Error);
        assertEquals(error.message.includes("PRIVATE_RECORD_TYPES_CANARY"), false);
        assertEquals(calls, 0);
      },
    );
  });
});
