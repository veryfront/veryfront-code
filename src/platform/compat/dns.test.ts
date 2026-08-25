import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  __resetHostAddressCacheForTests,
  createHostAddressResolver,
  DnsPermissionError,
  HOST_ADDRESS_CACHE_MAX_ENTRIES,
  HOST_ADDRESS_CACHE_TTL_MS,
  resolveHostAddresses,
  resolveLoopbackAddresses,
} from "./dns.ts";

/** Deferred promise so a test can hold a resolution open and observe fan-in. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createHostAddressResolver", () => {
  it("collapses concurrent resolutions of one host into a single lookup", async () => {
    let calls = 0;
    const gate = deferred<string[]>();
    const resolve = createHostAddressResolver({
      resolve: () => {
        calls++;
        return gate.promise;
      },
    });

    // Model the real failure: a page importing one CDN package fans out into
    // dozens of module fetches, each of which validated egress separately.
    const pending = Array.from({ length: 55 }, () => resolve("esm.sh"));
    gate.resolve(["93.184.216.34"]);
    const results = await Promise.all(pending);

    assertEquals(calls, 1);
    assertEquals(results.length, 55);
    for (const addresses of results) {
      assertEquals(addresses, ["93.184.216.34"]);
    }
  });

  it("keeps distinct hosts on separate lookups", async () => {
    const seen: string[] = [];
    const resolve = createHostAddressResolver({
      resolve: (hostname) => {
        seen.push(hostname);
        return Promise.resolve([hostname === "a.example" ? "1.1.1.1" : "2.2.2.2"]);
      },
    });

    assertEquals(await resolve("a.example"), ["1.1.1.1"]);
    assertEquals(await resolve("b.example"), ["2.2.2.2"]);
    assertEquals(seen, ["a.example", "b.example"]);
  });

  it("reuses a resolution until the ttl expires", async () => {
    let calls = 0;
    let now = 1_000;
    const resolve = createHostAddressResolver({
      resolve: () => {
        calls++;
        return Promise.resolve(["93.184.216.34"]);
      },
      ttlMs: 30_000,
      now: () => now,
    });

    await resolve("esm.sh");
    now += 29_999;
    await resolve("esm.sh");
    assertEquals(calls, 1);

    now += 2;
    await resolve("esm.sh");
    assertEquals(calls, 2);
  });

  it("separates cache entries by requested record type", async () => {
    const seen: (readonly string[] | undefined)[] = [];
    const resolve = createHostAddressResolver({
      resolve: (_hostname, options) => {
        seen.push(options.recordTypes);
        return Promise.resolve(["93.184.216.34"]);
      },
    });

    await resolve("esm.sh", { recordTypes: ["A"] });
    await resolve("esm.sh", { recordTypes: ["A", "AAAA"] });
    await resolve("esm.sh", { recordTypes: ["A"] });

    assertEquals(
      seen,
      [["A"], ["A", "AAAA"]],
      "the resolver must receive the caller's record types",
    );

    await resolve("esm.sh");
    assertEquals(
      seen.at(-1),
      ["A", "AAAA"],
      "an unspecified record type forwards the default pair",
    );
  });

  it("does not cache an empty result", async () => {
    let calls = 0;
    const resolve = createHostAddressResolver({
      resolve: () => {
        calls++;
        return Promise.resolve(calls === 1 ? [] : ["93.184.216.34"]);
      },
    });

    assertEquals(await resolve("esm.sh"), []);
    // An unresolvable host is a blocking condition for the egress guard, so it
    // must stay a live question rather than a cached verdict.
    assertEquals(await resolve("esm.sh"), ["93.184.216.34"]);
    assertEquals(calls, 2);
  });

  it("does not cache a failed resolution", async () => {
    let calls = 0;
    const resolve = createHostAddressResolver({
      resolve: () => {
        calls++;
        return calls === 1
          ? Promise.reject(new Error("SERVFAIL"))
          : Promise.resolve(["93.184.216.34"]);
      },
    });

    await assertRejects(() => resolve("esm.sh"));
    assertEquals(await resolve("esm.sh"), ["93.184.216.34"]);
    assertEquals(calls, 2);
  });

  it("rejects every caller waiting on a failed shared lookup", async () => {
    let calls = 0;
    const gate = deferred<string[]>();
    const resolve = createHostAddressResolver({
      resolve: () => {
        calls++;
        return gate.promise;
      },
    });

    const pending = [resolve("esm.sh"), resolve("esm.sh"), resolve("esm.sh")];
    gate.reject(new Error("SERVFAIL"));

    for (const attempt of pending) {
      await assertRejects(() => attempt);
    }
    assertEquals(calls, 1);
  });

  it("bounds the number of cached hosts", async () => {
    let calls = 0;
    const resolve = createHostAddressResolver({
      resolve: () => {
        calls++;
        return Promise.resolve(["93.184.216.34"]);
      },
      maxEntries: 2,
    });

    await resolve("a.example");
    await resolve("b.example");
    await resolve("c.example");
    assertEquals(calls, 3);

    // "a.example" was evicted, so it must be resolved again.
    await resolve("a.example");
    assertEquals(calls, 4);

    // "c.example" is still the newest entry and must still be cached.
    await resolve("c.example");
    assertEquals(calls, 4);
  });

  it("hands each caller an array it cannot use to corrupt the cache", async () => {
    const resolve = createHostAddressResolver({
      resolve: () => Promise.resolve(["93.184.216.34"]),
    });

    const first = await resolve("esm.sh");
    first.push("10.0.0.1");

    assertEquals(await resolve("esm.sh"), ["93.184.216.34"]);
  });

  it("exposes defaults that keep a fan-out inside one module-fetch budget", () => {
    // HTTP_MODULE_FETCH_TIMEOUT_MS is 2_500ms per attempt. The ttl must outlive
    // a page render so one render resolves a CDN host once, and the entry cap
    // must hold a realistic dependency fan-out.
    assertEquals(HOST_ADDRESS_CACHE_TTL_MS >= 5_000, true);
    assertEquals(HOST_ADDRESS_CACHE_MAX_ENTRIES >= 64, true);
  });
});

describe("platform/compat/dns loopback names", () => {
  // #3785. The Node/Bun branch used dns.resolve4/resolve6, which query
  // nameservers directly, so `localhost` was unresolvable wherever the
  // configured resolver does not answer for it — and the guarded-egress
  // resolver sits behind a security control, so it 302'd/blocked instead.
  //
  // Deno's resolveDns answers for `localhost` but NOT for other /etc/hosts
  // entries (measured: `broadcasthost` is in /etc/hosts and returns NotFound),
  // so "consult the hosts file" is not what Deno does and is not the parity
  // target. The parity target is: real DNS, plus the loopback names RFC 6761
  // §6.3 reserves, resolved without a round trip. Same answer in every
  // runtime, by construction rather than by whatever each resolver
  // special-cases.
  // These four are runtime-independent: they assert the rule itself rather
  // than what the host's resolver happens to answer. That matters because the
  // end-to-end cases below pass under Deno both before and after the fix —
  // Deno was never broken — so they cannot carry the regression on their own.
  it("answers the reserved loopback names for both families", () => {
    assertEquals(resolveLoopbackAddresses("localhost", ["A", "AAAA"]), ["127.0.0.1", "::1"]);
    assertEquals(resolveLoopbackAddresses("LocalHost", ["A"]), ["127.0.0.1"]);
    // The fully-qualified form is NOT recognised, on purpose: `isLocalhostName`
    // in the egress guard does not strip a trailing dot either, and a resolver
    // that recognises a form the guard does not is a bypass — such an entry
    // survives the allowlist filter and then resolves to loopback.
    assertEquals(resolveLoopbackAddresses("localhost.", ["AAAA"]), null);
    assertEquals(resolveLoopbackAddresses("api.localhost.", ["A"]), null);
  });

  it("answers RFC 6761 .localhost subdomains", () => {
    assertEquals(resolveLoopbackAddresses("api.localhost", ["A"]), ["127.0.0.1"]);
    assertEquals(resolveLoopbackAddresses("a.b.localhost", ["A", "AAAA"]), ["127.0.0.1", "::1"]);
  });

  it("declines every other name, including /etc/hosts entries", () => {
    // `broadcasthost` is in /etc/hosts on macOS. Deno's resolveDns returns
    // NotFound for it, so the hosts file is not the parity target and must not
    // become one — that would widen what the egress guard can reach.
    assertEquals(resolveLoopbackAddresses("broadcasthost", ["A"]), null);
    assertEquals(resolveLoopbackAddresses("example.com", ["A"]), null);
    assertEquals(resolveLoopbackAddresses("notlocalhost", ["A"]), null);
  });

  it("does not treat a name merely containing localhost as reserved", () => {
    assertEquals(resolveLoopbackAddresses("localhost.evil.com", ["A"]), null);
    assertEquals(resolveLoopbackAddresses("mylocalhost", ["A"]), null);
  });

  it("resolves localhost to loopback without a nameserver query", async () => {
    __resetHostAddressCacheForTests();
    const addresses = await resolveHostAddresses("localhost");
    assertEquals(addresses.includes("127.0.0.1"), true, `got ${JSON.stringify(addresses)}`);
    assertEquals(addresses.includes("::1"), true, `got ${JSON.stringify(addresses)}`);
    __resetHostAddressCacheForTests();
  });

  it("honours the requested record types for a loopback name", async () => {
    __resetHostAddressCacheForTests();
    assertEquals(await resolveHostAddresses("localhost", { recordTypes: ["A"] }), ["127.0.0.1"]);
    __resetHostAddressCacheForTests();
    assertEquals(await resolveHostAddresses("localhost", { recordTypes: ["AAAA"] }), ["::1"]);
    __resetHostAddressCacheForTests();
  });

  it("treats RFC 6761 .localhost subdomains as loopback", async () => {
    __resetHostAddressCacheForTests();
    const addresses = await resolveHostAddresses("api.localhost", { recordTypes: ["A"] });
    assertEquals(addresses, ["127.0.0.1"]);
    __resetHostAddressCacheForTests();
  });

  it("does not give other /etc/hosts entries any authority", async () => {
    // The refuted fix switched Node to dns.lookup, which reads /etc/hosts and
    // would resolve this on macOS while Deno returns nothing — inverting the
    // divergence instead of closing it. Loopback names are special-cased; the
    // hosts file is not consulted.
    __resetHostAddressCacheForTests();
    const addresses = await resolveHostAddresses("broadcasthost", { recordTypes: ["A"] });
    assertEquals(addresses, [], `got ${JSON.stringify(addresses)}`);
    __resetHostAddressCacheForTests();
  });

  it("surfaces a missing net permission instead of reporting an unresolvable host", async () => {
    // `Deno.resolveDns` checks permission against the nameserver, so under a
    // narrowed --allow-net every external lookup fails with NotCapable. The
    // bare catch used to swallow it into the empty-array fallback, making a
    // permission problem indistinguishable from a DNS problem downstream
    // ("unable to resolve host") — veryfront-issue-inbox#744.
    const originalResolveDns = Deno.resolveDns;
    __resetHostAddressCacheForTests();
    try {
      Object.defineProperty(Deno, "resolveDns", {
        value: () => {
          throw new Deno.errors.NotCapable('Requires net access to "8.8.8.8"');
        },
        configurable: true,
        writable: true,
      });
      const error = await assertRejects(
        () => resolveHostAddresses("permission-probe.invalid", { recordTypes: ["A"] }),
        DnsPermissionError,
        "net access to the DNS resolver is not permitted",
      );
      assertEquals(
        (error as Error & { cause?: unknown }).cause instanceof Deno.errors.NotCapable,
        true,
        "the original NotCapable must be preserved as the cause",
      );
    } finally {
      Object.defineProperty(Deno, "resolveDns", {
        value: originalResolveDns,
        configurable: true,
        writable: true,
      });
      __resetHostAddressCacheForTests();
    }
  });

  it("keeps the empty-array fallback for a genuine resolution failure", async () => {
    // The guard's fail-closed behaviour is unchanged: only a permission error
    // is surfaced; NotFound (single address family, NXDOMAIN) still yields [].
    const originalResolveDns = Deno.resolveDns;
    __resetHostAddressCacheForTests();
    try {
      Object.defineProperty(Deno, "resolveDns", {
        value: () => {
          throw new Deno.errors.NotFound("no record found");
        },
        configurable: true,
        writable: true,
      });
      const addresses = await resolveHostAddresses("missing-probe.invalid", {
        recordTypes: ["A"],
      });
      assertEquals(addresses, []);
    } finally {
      Object.defineProperty(Deno, "resolveDns", {
        value: originalResolveDns,
        configurable: true,
        writable: true,
      });
      __resetHostAddressCacheForTests();
    }
  });
});
