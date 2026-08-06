import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createHostAddressResolver,
  HOST_ADDRESS_CACHE_MAX_ENTRIES,
  HOST_ADDRESS_CACHE_TTL_MS,
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

    assertEquals(seen.length, 2);
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
