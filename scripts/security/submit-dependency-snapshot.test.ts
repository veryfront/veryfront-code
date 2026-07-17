import { assertEquals, assertRejects } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  manifestsFromLock,
  type Snapshot,
  snapshotFromLock,
  submitDependencySnapshot,
} from "./submit-dependency-snapshot.ts";

const ctx = {
  sha: "abc123",
  ref: "refs/heads/main",
  correlator: "ci/deps",
  runId: "1",
};

const emptySnapshot: Snapshot = {
  version: 0,
  sha: ctx.sha,
  ref: ctx.ref,
  job: { correlator: ctx.correlator, id: ctx.runId },
  detector: {
    name: "veryfront-deno-lock",
    version: "1.0.0",
    url: "https://github.com/veryfront/veryfront-code",
  },
  scanned: "2026-07-15T00:00:00.000Z",
  manifests: {},
};

describe("submitDependencySnapshot", () => {
  it("retries 5xx, 429, and network failures with bounded backoff", async () => {
    const outcomes: Array<Response | Error> = [
      new Response("gateway unavailable", { status: 502 }),
      new Response("rate limited", { status: 429 }),
      new TypeError("network unavailable"),
      new Response("accepted", { status: 201 }),
    ];
    const delays: number[] = [];
    let calls = 0;

    const response = await submitDependencySnapshot(emptySnapshot, {
      repository: "veryfront/veryfront-code",
      token: "<TOKEN>",
      retryDelaysMs: [10, 20, 40],
      fetch: () => {
        const outcome = outcomes[calls++];
        return outcome instanceof Error
          ? Promise.reject(outcome)
          : Promise.resolve(outcome);
      },
      sleep: (delayMs) => {
        delays.push(delayMs);
        return Promise.resolve();
      },
    });

    assertEquals(response.status, 201);
    assertEquals(calls, 4);
    assertEquals(delays, [10, 20, 40]);
  });

  it("stops retrying 5xx responses after the default retry bound", async () => {
    const delays: number[] = [];
    let calls = 0;

    const response = await submitDependencySnapshot(emptySnapshot, {
      repository: "veryfront/veryfront-code",
      token: "<TOKEN>",
      fetch: () => {
        calls++;
        return Promise.resolve(new Response("unavailable", { status: 503 }));
      },
      sleep: (delayMs) => {
        delays.push(delayMs);
        return Promise.resolve();
      },
    });

    assertEquals(response.status, 503);
    assertEquals(calls, 4);
    assertEquals(delays, [1_000, 2_000, 4_000]);
  });

  it("stops retrying network failures after the default retry bound", async () => {
    const delays: number[] = [];
    let calls = 0;

    await assertRejects(
      () =>
        submitDependencySnapshot(emptySnapshot, {
          repository: "veryfront/veryfront-code",
          token: "<TOKEN>",
          fetch: () => {
            calls++;
            return Promise.reject(new TypeError("network unavailable"));
          },
          sleep: (delayMs) => {
            delays.push(delayMs);
            return Promise.resolve();
          },
        }),
      TypeError,
      "network unavailable",
    );

    assertEquals(calls, 4);
    assertEquals(delays, [1_000, 2_000, 4_000]);
  });

  it("does not retry permanent 4xx responses", async () => {
    const delays: number[] = [];
    let calls = 0;

    const response = await submitDependencySnapshot(emptySnapshot, {
      repository: "veryfront/veryfront-code",
      token: "<TOKEN>",
      fetch: () => {
        calls++;
        return Promise.resolve(
          new Response("invalid snapshot", { status: 422 }),
        );
      },
      sleep: (delayMs) => {
        delays.push(delayMs);
        return Promise.resolve();
      },
    });

    assertEquals(response.status, 422);
    assertEquals(calls, 1);
    assertEquals(delays, []);
  });
});

describe("manifestsFromLock", () => {
  it("separates core and extension dependency closures", () => {
    const lock = JSON.stringify({
      version: "5",
      specifiers: {
        "npm:zod@4.3.6": "4.3.6",
        "npm:bash-tool@1.3.16":
          "1.3.16_ai@6.0.182__zod@3.25.76_just-bash@2.14.5",
      },
      npm: {
        "zod@4.3.6": { dependencies: [] },
        "bash-tool@1.3.16_ai@6.0.182__zod@3.25.76_just-bash@2.14.5": {
          dependencies: ["ai", "just-bash", "zod@3.25.76"],
        },
        "ai@6.0.182_zod@3.25.76": {
          dependencies: ["@ai-sdk/provider", "zod@3.25.76"],
        },
        "@ai-sdk/provider@3.0.10": { dependencies: [] },
        "just-bash@2.14.5": { dependencies: [] },
        "zod@3.25.76": { dependencies: [] },
      },
      workspace: {
        dependencies: ["npm:zod@4.3.6"],
        members: {
          cli: { dependencies: [] },
          "extensions/ext-sandbox-shell-tools": {
            dependencies: ["npm:bash-tool@1.3.16"],
          },
        },
      },
    });

    const manifests = manifestsFromLock(lock, ctx);

    assertEquals(Object.keys(manifests).sort(), [
      "cli/deno.json",
      "deno.json",
      "extensions/ext-sandbox-shell-tools/deno.json",
    ]);
    assertEquals(Object.keys(manifests["deno.json"].resolved), ["zod@4.3.6"]);
    assertEquals(Object.keys(manifests["cli/deno.json"].resolved), []);
    assertEquals(
      Object.keys(
        manifests["extensions/ext-sandbox-shell-tools/deno.json"].resolved,
      ).sort(),
      [
        "@ai-sdk/provider@3.0.10",
        "ai@6.0.182",
        "bash-tool@1.3.16",
        "just-bash@2.14.5",
        "zod@3.25.76",
      ],
    );
  });

  it("marks manifest roots direct and reachable npm edges indirect", () => {
    const lock = JSON.stringify({
      version: "5",
      specifiers: { "npm:root@1.0.0": "1.0.0" },
      npm: {
        "root@1.0.0": { dependencies: ["child"] },
        "child@2.0.0": { dependencies: [] },
      },
      workspace: {
        dependencies: ["npm:root@1.0.0"],
        members: { cli: { dependencies: [] } },
      },
    });

    const manifest = manifestsFromLock(lock, ctx)["deno.json"];

    assertEquals(manifest.resolved["root@1.0.0"].relationship, "direct");
    assertEquals(manifest.resolved["child@2.0.0"].relationship, "indirect");
    assertEquals(manifest.resolved["root@1.0.0"].dependencies, [
      "pkg:npm/child@2.0.0",
    ]);
  });

  it("uses separate manifest source locations in the snapshot", () => {
    const lock = JSON.stringify({
      version: "5",
      specifiers: { "npm:zod@4.3.6": "4.3.6" },
      npm: { "zod@4.3.6": { dependencies: [] } },
      workspace: {
        dependencies: ["npm:zod@4.3.6"],
        members: { cli: { dependencies: [] } },
      },
    });

    const snapshot = snapshotFromLock(lock, ctx);

    assertEquals(Object.keys(snapshot.manifests).sort(), [
      "cli/deno.json",
      "deno.json",
    ]);
    assertEquals(
      snapshot.manifests["deno.json"].file.source_location,
      "deno.json",
    );
    assertEquals(
      snapshot.manifests["cli/deno.json"].file.source_location,
      "cli/deno.json",
    );
  });

  it("includes configured workspace members that are omitted from deno.lock", () => {
    const lock = JSON.stringify({
      version: "5",
      specifiers: { "npm:zod@4.3.6": "4.3.6" },
      npm: { "zod@4.3.6": { dependencies: [] } },
      workspace: { dependencies: ["npm:zod@4.3.6"], members: {} },
    });

    const snapshot = snapshotFromLock(lock, ctx, {
      workspaceMembers: ["cli", "extensions/ext-sandbox-shell-tools"],
    });

    assertEquals(Object.keys(snapshot.manifests).sort(), [
      "cli/deno.json",
      "deno.json",
      "extensions/ext-sandbox-shell-tools/deno.json",
    ]);
    assertEquals(snapshot.manifests["cli/deno.json"].resolved, {});
    assertEquals(
      snapshot.manifests["extensions/ext-sandbox-shell-tools/deno.json"]
        .resolved,
      {},
    );
  });
});
