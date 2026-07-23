import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createEvalRunProvenance, resolveEvalRunProvenance } from "./provenance.ts";

describe("eval/provenance", () => {
  it("prefers release provenance when Cloud release env is present", () => {
    assertEquals(
      createEvalRunProvenance({
        env: {
          TENANT_PROJECT_ID: "project-1",
          TENANT_PROJECT_SLUG: "support-agent",
          TENANT_RELEASE_ID: "release-1",
          TENANT_BRANCH_ID: "branch-1",
        },
        git: { sha: "abc", branch: "main", dirty: false },
        frameworkVersion: "0.1.950",
      }),
      {
        kind: "eval-run-provenance",
        environment: "cloud",
        source: { kind: "release", id: "release-1" },
        frameworkVersion: "0.1.950",
        cloud: {
          projectId: "project-1",
          projectSlug: "support-agent",
          releaseId: "release-1",
          branchId: "branch-1",
        },
        git: { sha: "abc", branch: "main", dirty: false },
      },
    );
  });

  it("uses preview branch provenance when no release exists", () => {
    assertEquals(
      createEvalRunProvenance({
        env: {
          VERYFRONT_PROJECT_ID: "project-1",
          VERYFRONT_PROJECT_SLUG: "support-agent",
          VERYFRONT_BRANCH_REF: "main",
        },
      }).source,
      { kind: "preview", id: "main" },
    );
  });

  it("captures local git provenance without failing when git commands work", async () => {
    const commands: string[][] = [];
    const provenance = await resolveEvalRunProvenance({
      projectDir: "/repo",
      env: {},
      commandRunner: async (command, args) => {
        commands.push([command, ...args]);
        if (args.join(" ") === "rev-parse HEAD") return { code: 0, stdout: "abc123\n" };
        if (args.join(" ") === "rev-parse --abbrev-ref HEAD") return { code: 0, stdout: "main\n" };
        if (args.join(" ") === "status --porcelain=v1") {
          return { code: 0, stdout: " M src/file.ts\n?? notes.md\n" };
        }
        if (args.join(" ") === "diff --binary HEAD --") return { code: 0, stdout: "diff" };
        if (args.join(" ") === "ls-files --others --exclude-standard -z") {
          return { code: 0, stdout: "notes.md\0" };
        }
        return { code: 1, stdout: "" };
      },
      fileReader: async () => new TextEncoder().encode("untracked content"),
      frameworkVersion: "0.1.950",
    });

    assertEquals(provenance.environment, "local");
    assertEquals(provenance.source, { kind: "git", id: "abc123" });
    assertEquals(provenance.git?.sha, "abc123");
    assertEquals(provenance.git?.branch, "main");
    assertEquals(provenance.git?.dirty, true);
    assertEquals(typeof provenance.git?.dirtyHash, "string");
    assertEquals(commands.length, 5);
  });

  it("includes untracked file contents in local dirty hashes", async () => {
    const commandRunner = async (_command: string, args: string[]) => {
      if (args.join(" ") === "rev-parse HEAD") return { code: 0, stdout: "abc123\n" };
      if (args.join(" ") === "rev-parse --abbrev-ref HEAD") return { code: 0, stdout: "main\n" };
      if (args.join(" ") === "status --porcelain=v1") return { code: 0, stdout: "?? data.json\n" };
      if (args.join(" ") === "diff --binary HEAD --") return { code: 0, stdout: "" };
      if (args.join(" ") === "ls-files --others --exclude-standard -z") {
        return { code: 0, stdout: "data.json\0" };
      }
      return { code: 1, stdout: "" };
    };
    const first = await resolveEvalRunProvenance({
      projectDir: "/repo",
      env: {},
      commandRunner,
      fileReader: async () => new TextEncoder().encode("alpha"),
      frameworkVersion: "0.1.950",
    });
    const second = await resolveEvalRunProvenance({
      projectDir: "/repo",
      env: {},
      commandRunner,
      fileReader: async () => new TextEncoder().encode("beta"),
      frameworkVersion: "0.1.950",
    });

    assertNotEquals(first.git?.dirtyHash, second.git?.dirtyHash);
  });

  it("does not read untracked paths outside the project", async () => {
    let reads = 0;
    const provenance = await resolveEvalRunProvenance({
      projectDir: "/repo",
      env: {},
      commandRunner: async (_command, args) => {
        if (args.join(" ") === "rev-parse HEAD") return { code: 0, stdout: "abc123\n" };
        if (args.join(" ") === "rev-parse --abbrev-ref HEAD") {
          return { code: 0, stdout: "main\n" };
        }
        if (args.join(" ") === "status --porcelain=v1") {
          return { code: 0, stdout: "?? ../outside\n" };
        }
        if (args.join(" ") === "diff --binary HEAD --") return { code: 0, stdout: "" };
        if (args.join(" ") === "ls-files --others --exclude-standard -z") {
          return { code: 0, stdout: "../outside\0" };
        }
        return { code: 1, stdout: "" };
      },
      fileReader: async () => {
        reads += 1;
        return new Uint8Array();
      },
    });

    assertEquals(reads, 0);
    assertEquals(typeof provenance.git?.dirtyHash, "string");
  });
});
