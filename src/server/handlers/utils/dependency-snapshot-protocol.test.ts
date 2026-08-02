import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createResponseBuilder } from "#veryfront/security/index.ts";
import {
  clearReactVersionCache,
  getDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import {
  applySnapshotResponseHeaders,
  DEPENDENCY_PINS_HEADER,
  readSnapshotHeader,
  readSnapshotQuery,
  resolveSnapshotForRequest,
  SNAPSHOT_CONFLICT_BODY,
  snapshotConflictResponse,
  stripSnapshotHeader,
  stripSnapshotQuery,
  withSnapshotResponseHeaders,
} from "./dependency-snapshot-protocol.ts";

const PINNED_KEY = "on:1a2b3c";

function headers(init: Record<string, string> = {}): Headers {
  return new Headers(init);
}

describe("server/handlers/utils/dependency-snapshot-protocol", () => {
  describe("reading the requested snapshot", () => {
    it("reports an absent header as unpinned", () => {
      assertEquals(readSnapshotHeader(headers()), { kind: "absent" });
    });

    it("accepts a well-formed key from the header", () => {
      assertEquals(
        readSnapshotHeader(headers({ [DEPENDENCY_PINS_HEADER]: PINNED_KEY })),
        { kind: "pinned", key: PINNED_KEY },
      );
    });

    it("refuses header keys that are not snapshot keys", () => {
      for (const raw of ["off", "on:", "on:first, on:second", "1a2b3c", "ON:1a2b3c"]) {
        assertEquals(
          readSnapshotHeader(headers({ [DEPENDENCY_PINS_HEADER]: raw })),
          { kind: "unusable" },
          `expected ${raw} to be refused`,
        );
      }
    });

    it("reads the same key from a module URL query parameter", () => {
      assertEquals(
        readSnapshotQuery(new URL(`http://localhost/m.js?pins=${PINNED_KEY}`)),
        { kind: "pinned", key: PINNED_KEY },
      );
      assertEquals(readSnapshotQuery(new URL("http://localhost/m.js")), { kind: "absent" });
    });

    it("refuses a module URL asking for two snapshots at once", () => {
      assertEquals(
        readSnapshotQuery(new URL("http://localhost/m.js?pins=on:aaa&pins=on:bbb")),
        { kind: "unusable" },
      );
    });
  });

  describe("forwarding to application code", () => {
    it("removes the snapshot header without touching the rest", () => {
      const forwarded = stripSnapshotHeader(
        headers({ [DEPENDENCY_PINS_HEADER]: PINNED_KEY, "x-keep": "yes" }),
      );

      assertEquals(forwarded.get(DEPENDENCY_PINS_HEADER), null);
      assertEquals(forwarded.get("x-keep"), "yes");
    });

    it("removes the snapshot query parameter without touching the rest", () => {
      const forwarded = stripSnapshotQuery(
        new URL(`http://localhost/m.js?rel=%2Fa&pins=${PINNED_KEY}`),
      );

      assertEquals(forwarded.searchParams.get("pins"), null);
      assertEquals(forwarded.searchParams.get("rel"), "/a");
    });

    it("leaves the caller's headers unmodified", () => {
      const original = headers({ [DEPENDENCY_PINS_HEADER]: PINNED_KEY });
      stripSnapshotHeader(original);

      assertEquals(original.get(DEPENDENCY_PINS_HEADER), PINNED_KEY);
    });
  });

  describe("response headers", () => {
    it("marks the response snapshot-dependent and echoes a pinned key", () => {
      const responseHeaders = headers();
      applySnapshotResponseHeaders(responseHeaders, PINNED_KEY);

      assertEquals(responseHeaders.get("vary"), DEPENDENCY_PINS_HEADER);
      assertEquals(responseHeaders.get(DEPENDENCY_PINS_HEADER), PINNED_KEY);
    });

    it("varies but echoes nothing when the project is not pinning", () => {
      const responseHeaders = headers();
      applySnapshotResponseHeaders(responseHeaders, "off");

      assertEquals(responseHeaders.get("vary"), DEPENDENCY_PINS_HEADER);
      assertEquals(responseHeaders.get(DEPENDENCY_PINS_HEADER), null);
    });

    it("appends to an existing vary rather than replacing it", () => {
      const responseHeaders = headers({ vary: "Accept-Encoding" });
      applySnapshotResponseHeaders(responseHeaders);

      assertEquals(responseHeaders.get("vary"), `Accept-Encoding, ${DEPENDENCY_PINS_HEADER}`);
    });

    it("does not repeat an entry it already added", () => {
      const responseHeaders = headers();
      applySnapshotResponseHeaders(responseHeaders, PINNED_KEY);
      applySnapshotResponseHeaders(responseHeaders, PINNED_KEY);

      assertEquals(responseHeaders.get("vary"), DEPENDENCY_PINS_HEADER);
    });

    it("copies a response with the headers applied and the body intact", async () => {
      const copied = withSnapshotResponseHeaders(
        new Response("payload", { status: 404, headers: { "x-keep": "yes" } }),
        PINNED_KEY,
      );

      assertEquals(copied.status, 404);
      assertEquals(copied.headers.get("x-keep"), "yes");
      assertEquals(copied.headers.get(DEPENDENCY_PINS_HEADER), PINNED_KEY);
      assertEquals(await copied.text(), "payload");
    });
  });

  describe("conflict response", () => {
    it("answers 409 with the exact body the client recovery matches", async () => {
      const response = snapshotConflictResponse(
        createResponseBuilder(),
        new Request("http://localhost/page"),
        null,
      );

      assertEquals(response.status, 409);
      assertEquals(await response.text(), SNAPSHOT_CONFLICT_BODY);
      assertEquals(response.headers.get("cache-control"), "no-store");
      assertEquals(
        response.headers.get("vary")?.toLowerCase().includes(DEPENDENCY_PINS_HEADER),
        true,
      );
    });

    it("never echoes a snapshot key it could not resolve", () => {
      const response = snapshotConflictResponse(
        createResponseBuilder(),
        new Request("http://localhost/page", {
          headers: { [DEPENDENCY_PINS_HEADER]: PINNED_KEY },
        }),
        null,
      );

      assertEquals(response.headers.get(DEPENDENCY_PINS_HEADER), null);
    });

    it("answers HEAD conflicts without a response body", () => {
      const response = snapshotConflictResponse(
        createResponseBuilder(),
        new Request("http://localhost/page", { method: "HEAD" }),
        null,
      );

      assertEquals(response.status, 409);
      assertEquals(response.body, null);
      assertEquals(response.headers.get("cache-control"), "no-store");
      assertEquals(
        response.headers.get("vary")?.toLowerCase().includes(DEPENDENCY_PINS_HEADER),
        true,
      );
    });
  });

  describe("resolving a request against known snapshots", () => {
    async function withPinnedProject(
      run: (projectDir: string, currentKey: string) => Promise<void>,
    ): Promise<void> {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-snapshot-protocol-" });
      const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      try {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
        clearReactVersionCache();
        await Deno.writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({ dependencies: { react: "18.3.1" } }),
        );
        const current = await getDependencyPinningSnapshot(projectDir);
        await run(projectDir, current.cacheKey);
      } finally {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
        clearReactVersionCache();
        await Deno.remove(projectDir, { recursive: true });
      }
    }

    it("resolves the key the caller asked for", async () => {
      await withPinnedProject(async (projectDir, currentKey) => {
        const resolution = await resolveSnapshotForRequest(projectDir, {
          kind: "pinned",
          key: currentKey,
        });

        assertEquals(resolution.kind, "ready");
        assertEquals(
          resolution.kind === "ready" ? resolution.snapshot.cacheKey : null,
          currentKey,
        );
      });
    });

    it("conflicts on a key this server does not know", async () => {
      await withPinnedProject(async (projectDir) => {
        const resolution = await resolveSnapshotForRequest(projectDir, {
          kind: "pinned",
          key: "on:zzzzzz",
        });

        assertEquals(resolution.kind, "conflict");
      });
    });

    it("conflicts without resolving anything when the request is unusable", async () => {
      await withPinnedProject(async (projectDir) => {
        assertEquals(
          (await resolveSnapshotForRequest(projectDir, { kind: "unusable" })).kind,
          "conflict",
        );
      });
    });

    it("conflicts on an unpinned request while the project is pinning", async () => {
      await withPinnedProject(async (projectDir) => {
        const resolution = await resolveSnapshotForRequest(projectDir, { kind: "absent" });

        assertEquals(resolution.kind, "conflict");
      });
    });

    it("lets the document request adopt the current snapshot instead", async () => {
      await withPinnedProject(async (projectDir, currentKey) => {
        const resolution = await resolveSnapshotForRequest(
          projectDir,
          { kind: "absent" },
          { unpinnedRequest: "adopt" },
        );

        assertEquals(
          resolution.kind === "ready" ? resolution.snapshot.cacheKey : null,
          currentKey,
        );
      });
    });
  });
});
