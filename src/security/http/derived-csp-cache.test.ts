import "#veryfront/schemas/_test-setup.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { __clearDerivedCspCacheForTests, getDerivedCspOrigins } from "./derived-csp-cache.ts";

const IMG = `<img src="https://cdn.example.com/a.png" />`;

afterEach(() => __clearDerivedCspCacheForTests());

describe("security/http/derived-csp-cache", () => {
  it("derives once per content version", async () => {
    // Derivation reads every file a release pins. Doing that per response would
    // be absurd; doing it once per immutable content version is exactly right.
    let loads = 0;
    const lookup = {
      projectScope: "proj",
      contentVersion: "release:r1",
      loadSourceFiles: () => {
        loads++;
        return Promise.resolve([{ path: "a.tsx", content: IMG }]);
      },
    };
    const first = await getDerivedCspOrigins(lookup);
    const second = await getDerivedCspOrigins(lookup);
    assertEquals(loads, 1);
    assertEquals(first["img-src"], ["https://cdn.example.com"]);
    assertEquals(second, first);
  });

  it("collapses concurrent misses into one derivation", async () => {
    // A key is coldest right after a release, when every pod serves that
    // content version for the first time and requests arrive together. Storing
    // the value only after the await would let each of them scan the whole
    // source set.
    let loads = 0;
    let release!: (files: Array<{ path: string; content?: string }>) => void;
    const lookup = {
      projectScope: "proj",
      contentVersion: "release:r1",
      loadSourceFiles: () => {
        loads++;
        return new Promise<Array<{ path: string; content?: string }>>((resolve) => {
          release = resolve;
        });
      },
    };

    const first = getDerivedCspOrigins(lookup);
    const second = getDerivedCspOrigins(lookup);
    assertEquals(loads, 1, "the second caller must not start its own derivation");

    release([{ path: "a.tsx", content: IMG }]);
    const [a, b] = await Promise.all([first, second]);
    assertEquals(loads, 1);
    assertEquals(a["img-src"], ["https://cdn.example.com"]);
    assertEquals(b, a);

    // And the flight is cleared, so a later miss can still derive.
    __clearDerivedCspCacheForTests();
    let reloaded = 0;
    await getDerivedCspOrigins({
      projectScope: "proj",
      contentVersion: "release:r1",
      loadSourceFiles: () => {
        reloaded++;
        return Promise.resolve([{ path: "a.tsx", content: IMG }]);
      },
    });
    assertEquals(reloaded, 1);
  });

  it("re-derives when the content version moves", async () => {
    let loads = 0;
    const make = (contentVersion: string, host: string) => ({
      projectScope: "proj",
      contentVersion,
      loadSourceFiles: () => {
        loads++;
        return Promise.resolve([{
          path: "a.tsx",
          content: `<img src="https://${host}/a.png" />`,
        }]);
      },
    });
    assertEquals((await getDerivedCspOrigins(make("release:r1", "one.example.com")))["img-src"], [
      "https://one.example.com",
    ]);
    assertEquals((await getDerivedCspOrigins(make("release:r2", "two.example.com")))["img-src"], [
      "https://two.example.com",
    ]);
    assertEquals(loads, 2);
  });

  it("never lets one project read another's derivation", async () => {
    // Multi-tenant: two projects share a pod and can share a content version
    // string, so the scope has to be part of the key.
    const a = await getDerivedCspOrigins({
      projectScope: "alpha",
      contentVersion: "branch:main",
      loadSourceFiles: () => Promise.resolve([{ path: "a", content: IMG }]),
    });
    const b = await getDerivedCspOrigins({
      projectScope: "beta",
      contentVersion: "branch:main",
      loadSourceFiles: () =>
        Promise.resolve([{ path: "b", content: `<img src="https://other.example.com/x.png" />` }]),
    });
    assertEquals(a["img-src"], ["https://cdn.example.com"]);
    assertEquals(b["img-src"], ["https://other.example.com"]);
  });

  it("fails soft when sources cannot be read", async () => {
    // A project whose sources are unreadable lands exactly where it was before
    // derivation existed: floor plus whatever security.csp declares. Never an
    // error page over a CSP nicety.
    const thrown = await getDerivedCspOrigins({
      projectScope: "proj",
      contentVersion: "release:r1",
      loadSourceFiles: () => Promise.reject(new Error("adapter unavailable")),
    });
    assertEquals(thrown, {});

    const absent = await getDerivedCspOrigins({
      projectScope: "proj2",
      contentVersion: "release:r1",
      loadSourceFiles: () => Promise.resolve(null),
    });
    assertEquals(absent, {});
  });

  it("caches the empty result too, so a broken adapter is not retried per request", async () => {
    let loads = 0;
    const lookup = {
      projectScope: "proj",
      contentVersion: "release:r1",
      loadSourceFiles: () => {
        loads++;
        return Promise.reject(new Error("nope"));
      },
    };
    await getDerivedCspOrigins(lookup);
    await getDerivedCspOrigins(lookup);
    assertEquals(loads, 1);
  });

  it("stays bounded as content versions accumulate", async () => {
    // Every release of every project mints a key; without eviction this grows
    // for the lifetime of the pod.
    for (let i = 0; i < 260; i++) {
      await getDerivedCspOrigins({
        projectScope: "proj",
        contentVersion: `release:r${i}`,
        loadSourceFiles: () => Promise.resolve([{ path: "a", content: IMG }]),
      });
    }
    let reloaded = false;
    await getDerivedCspOrigins({
      projectScope: "proj",
      contentVersion: "release:r0",
      loadSourceFiles: () => {
        reloaded = true;
        return Promise.resolve([{ path: "a", content: IMG }]);
      },
    });
    assert(reloaded, "the oldest entry should have been evicted");
  });
});
