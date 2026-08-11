import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ApiClient } from "#cli/shared/config";
import type { ParsedArgs } from "#cli/shared/types";
import {
  buildProjectDeleteUrl,
  deleteRemoteProject,
  parseProjectDeleteArgs,
  projectCommand,
} from "./command.ts";

function fakeClient(calls: string[]): ApiClient {
  return {
    get: () => Promise.reject(new Error("unexpected get")),
    post: () => Promise.reject(new Error("unexpected post")),
    put: () => Promise.reject(new Error("unexpected put")),
    patch: () => Promise.reject(new Error("unexpected patch")),
    delete: <T>(path: string): Promise<T> => {
      calls.push(path);
      return Promise.resolve(undefined as T);
    },
  };
}

describe("cli/commands/project", () => {
  describe("parseProjectDeleteArgs", () => {
    it("reads the project slug from the positional argument", () => {
      const result = parseProjectDeleteArgs({
        _: ["project", "delete", "dogfood-teardown"],
      } as ParsedArgs);

      assertEquals(result.success, true);
      if (!result.success) return;
      assertEquals(result.data.projectSlug, "dogfood-teardown");
      assertEquals(result.data.json, false);
    });

    it("falls back to --project when no positional slug is given", () => {
      const result = parseProjectDeleteArgs({
        _: ["project", "delete"],
        project: "dogfood-teardown",
        json: true,
      } as ParsedArgs);

      assertEquals(result.success, true);
      if (!result.success) return;
      assertEquals(result.data.projectSlug, "dogfood-teardown");
      assertEquals(result.data.json, true);
    });
  });

  describe("buildProjectDeleteUrl", () => {
    it("targets the project delete endpoint", () => {
      assertEquals(buildProjectDeleteUrl("my-app"), "/projects/my-app");
    });

    it("encodes the project reference", () => {
      assertEquals(buildProjectDeleteUrl("my app/2"), "/projects/my%20app%2F2");
    });
  });

  describe("deleteRemoteProject", () => {
    it("issues a DELETE against the project", async () => {
      const calls: string[] = [];
      await deleteRemoteProject(fakeClient(calls), "dogfood-teardown");
      assertEquals(calls, ["/projects/dogfood-teardown"]);
    });

    it("rejects an empty project reference instead of deleting every project", async () => {
      const calls: string[] = [];
      await assertRejects(() => deleteRemoteProject(fakeClient(calls), "  "));
      assertEquals(calls, []);
    });
  });

  describe("projectCommand", () => {
    it("fails a misspelled subcommand instead of exiting zero", async () => {
      // A cleanup script that runs `veryfront project delet app` must not read
      // printed usage plus exit code 0 as a completed teardown.
      const error = await assertRejects(() =>
        projectCommand({ _: ["project", "delet", "app"], force: true } as ParsedArgs)
      );

      assertStringIncludes(String(error), "Unknown project subcommand: delet");
      assertEquals((error as { exitCode?: number }).exitCode, 2);
    });
  });
});
