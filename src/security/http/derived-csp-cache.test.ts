import "#veryfront/schemas/_test-setup.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import {
  __clearDerivedCspCacheForTests,
  getDerivedCspOrigins,
  shouldWarnOnceForKey,
} from "./derived-csp-cache.ts";

const IMG = `<img src="https://cdn.example.com/a.png" />`;

afterEach(() => __clearDerivedCspCacheForTests());

describe("security/http/derived-csp-cache", () => {
  it("reports an underivable content version once, not once per request", async () => {
    // The failure paths deliberately do not cache, so the read is retried every
    // request. Without a guard the diagnostic would be emitted every request
    // too, on every pod, for as long as the failure lasts -- turning a
    // one-line-per-release signal into log flooding.
    const lookup = {
      projectScope: "proj",
      contentVersion: "release:persistent-failure",
      loadSourceFiles: () => Promise.resolve([]),
    };

    for (let i = 0; i < 5; i += 1) await getDerivedCspOrigins(lookup);

    // The guard is what the log is gated on, so ask it directly: after those
    // calls the key must already be spent.
    const key = `${lookup.projectScope}\u0000${lookup.contentVersion}`;
    assertEquals(shouldWarnOnceForKey(key), false, "the key was reported during the calls above");
  });

  it("reports each content version separately", async () => {
    assertEquals(shouldWarnOnceForKey("proj\u0000a"), true);
    assertEquals(shouldWarnOnceForKey("proj\u0000a"), false, "same key stays spent");
    assertEquals(shouldWarnOnceForKey("proj\u0000b"), true, "a new release is still worth a line");
  });

  it("bounds the set of reported keys", () => {
    for (let i = 0; i < 260; i += 1) shouldWarnOnceForKey(`proj\u0000bounded-${i}`);
    // The earliest key was evicted, so it would be reported again rather than
    // being remembered for the life of the pod.
    assertEquals(shouldWarnOnceForKey("proj\u0000bounded-0"), true);
  });

  it("retries after a source read that came back empty", async () => {
    // `getAllSourceFiles` returns [] while its own file list is cold and warms
    // it asynchronously. Remembering that emptiness pinned a release to the
    // bare floor for the life of the pod: every pod is cold on the first
    // request after a release, so hosted production projects derived nothing
    // at all, and the warm list that arrived a moment later was never read.
    let call = 0;
    const loadSourceFiles = () => {
      call += 1;
      return Promise.resolve(
        call === 1
          ? []
          : [{ path: "pages/index.tsx", content: '<img src="https://cdn.example.com/a.png" />' }],
      );
    };

    const cold = await getDerivedCspOrigins({
      projectScope: "acme",
      contentVersion: "rel-1@0",
      loadSourceFiles,
    });
    assertEquals(cold["img-src"], undefined, "a cold read yields nothing");

    const warm = await getDerivedCspOrigins({
      projectScope: "acme",
      contentVersion: "rel-1@0",
      loadSourceFiles,
    });
    assertEquals(
      warm["img-src"],
      ["https://cdn.example.com"],
      "same key must re-derive once readable",
    );
    assertEquals(call, 2);
  });

  it("does not retry once files were read, even if they yield no origins", async () => {
    // The other half: a release whose source genuinely references no external
    // origin is immutable for that content version, so it is cached and the
    // source is not read again.
    let call = 0;
    const loadSourceFiles = () => {
      call += 1;
      return Promise.resolve([{ path: "pages/index.tsx", content: "export default () => null;" }]);
    };

    for (let i = 0; i < 3; i += 1) {
      await getDerivedCspOrigins({
        projectScope: "acme",
        contentVersion: "rel-2@0",
        loadSourceFiles,
      });
    }
    assertEquals(call, 1, "an answered derivation is computed once");
  });

  it("retries after the source read throws", async () => {
    let call = 0;
    const loadSourceFiles = () => {
      call += 1;
      if (call === 1) return Promise.reject(new Error("adapter not ready"));
      return Promise.resolve([{
        path: "a.tsx",
        content: '<img src="https://cdn.example.com/a.png" />',
      }]);
    };

    await getDerivedCspOrigins({
      projectScope: "acme",
      contentVersion: "rel-3@0",
      loadSourceFiles,
    });
    const warm = await getDerivedCspOrigins({
      projectScope: "acme",
      contentVersion: "rel-3@0",
      loadSourceFiles,
    });
    assertEquals(warm["img-src"], ["https://cdn.example.com"]);
  });

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

  it("retries a failed read rather than caching the failure", async () => {
    // This deliberately reverses an earlier decision. Caching the empty result
    // did avoid re-reading for a broken adapter, but it could not tell a broken
    // adapter from a cold one, and the cold case is the common one: every pod
    // is cold for a content version on the first request after a release, and
    // `getAllSourceFiles` answers [] until its own file list warms up. The
    // saving was paid for by the feature not working in production at all.
    //
    // The cost this reintroduces is small by construction: the empty path is a
    // cache lookup that schedules a warmup, not a source read, and concurrent
    // callers still collapse onto one attempt through the in-flight map.
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
    assertEquals(loads, 2);
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
