import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  manifestsFromLock,
  snapshotFromLock,
} from "./submit-dependency-snapshot.ts";

const ctx = {
  sha: "abc123",
  ref: "refs/heads/main",
  correlator: "ci/deps",
  runId: "1",
};

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
      snapshot.manifests["extensions/ext-sandbox-shell-tools/deno.json"].resolved,
      {},
    );
  });
});
