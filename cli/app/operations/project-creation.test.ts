import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  _resetEnvironmentConfig,
  refreshEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { __resetEnvLoaderForTests, loadEnv } from "#veryfront/utils/env-loader.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { join } from "veryfront/platform/path";
import { createProject } from "./project-creation.ts";
import { createInitialState } from "../state.ts";

const API_URL = "https://control.example.test";
const TOKEN = "vf_test_token";

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    Deno.env.delete(name);
    return;
  }
  Deno.env.set(name, value);
}

describe("TUI project creation", () => {
  it("links the created project when the reservation omits the id", async () => {
    const originalFetch = globalThis.fetch;
    const envKeys = ["VERYFRONT_API_URL", "VERYFRONT_API_BASE_URL", "XDG_CONFIG_HOME"];
    const savedEnv = envKeys.map((key) => Deno.env.get(key));
    const workDir = await Deno.makeTempDir();
    const configHome = await Deno.makeTempDir();
    const requests: string[] = [];

    try {
      await Deno.mkdir(join(configHome, "veryfront"), { recursive: true });
      await Deno.writeTextFile(join(configHome, "veryfront", "token"), TOKEN);
      Deno.env.set("VERYFRONT_API_URL", API_URL);
      Deno.env.delete("VERYFRONT_API_BASE_URL");
      Deno.env.set("XDG_CONFIG_HOME", configHome);
      _resetEnvironmentConfig();

      globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        requests.push(`${request.method} ${url.pathname}`);

        // The reservation succeeds but the response carries no id, which is
        // what reserveProjectSlug normalizes to an empty projectId.
        if (request.method === "POST" && url.pathname === "/projects") {
          return Promise.resolve(Response.json({}));
        }
        if (request.method === "GET" && url.pathname === "/projects/my-app") {
          return Promise.resolve(Response.json({ id: "proj_canonical", slug: "my-app" }));
        }
        if (request.method === "GET" && url.pathname === "/projects") {
          return Promise.resolve(Response.json({ data: [], page_info: {} }));
        }

        throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
      }) as typeof fetch;

      const state = await createProject(
        { state: createInitialState(), render: () => {}, baseDir: workDir },
        "My App",
        "minimal",
      );

      const link = JSON.parse(
        await Deno.readTextFile(
          join(workDir, "projects", "my-app", ".veryfront", "project.json"),
        ),
      );
      assertEquals(link, {
        version: 1,
        controlPlane: API_URL,
        projectId: "proj_canonical",
        projectSlug: "my-app",
      });
      assertEquals(requests.includes("GET /projects/my-app"), true);
      assertEquals(
        state.logs.some((entry) => entry.message.includes("Created my-app")),
        true,
      );
    } finally {
      globalThis.fetch = originalFetch;
      envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
      _resetEnvironmentConfig();
      await Deno.remove(workDir, { recursive: true });
      await Deno.remove(configHome, { recursive: true });
    }
  });

  it("refuses a slug whose directory already exists rather than adopting it", async () => {
    const originalFetch = globalThis.fetch;
    const envKeys = ["VERYFRONT_API_URL", "VERYFRONT_API_BASE_URL", "XDG_CONFIG_HOME"];
    const savedEnv = envKeys.map((key) => Deno.env.get(key));
    const workDir = await Deno.makeTempDir();
    const configHome = await Deno.makeTempDir();
    const existingDir = join(workDir, "projects", "my-app");

    try {
      await Deno.mkdir(join(configHome, "veryfront"), { recursive: true });
      await Deno.writeTextFile(join(configHome, "veryfront", "token"), TOKEN);
      Deno.env.set("VERYFRONT_API_URL", API_URL);
      Deno.env.delete("VERYFRONT_API_BASE_URL");
      Deno.env.set("XDG_CONFIG_HOME", configHome);
      _resetEnvironmentConfig();

      // A directory already linked to a different project, holding nothing the
      // template writes. `veryfront init` scaffolds into a directory like this
      // on purpose; this caller must not, because it would repoint the link.
      await Deno.mkdir(join(existingDir, ".veryfront"), { recursive: true });
      await Deno.writeTextFile(
        join(existingDir, ".veryfront", "project.json"),
        '{"projectId":"proj_someone_else"}\n',
      );
      await Deno.writeTextFile(join(existingDir, "notes.txt"), "mine\n");

      globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        if (request.method === "POST" && url.pathname === "/projects") {
          return Promise.resolve(Response.json({ id: "proj_new", slug: "my-app" }));
        }
        if (request.method === "GET" && url.pathname === "/projects") {
          return Promise.resolve(Response.json({ data: [], page_info: {} }));
        }
        throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
      }) as typeof fetch;

      const state = await createProject(
        { state: createInitialState(), render: () => {}, baseDir: workDir },
        "My App",
        "minimal",
      );

      assertEquals(
        state.logs.some((entry) => entry.message.includes("projects/my-app already exists")),
        true,
      );
      // The existing link and the existing file are both untouched, and no
      // scaffold file landed in the directory.
      assertEquals(
        (await Deno.readTextFile(join(existingDir, ".veryfront", "project.json"))).trim(),
        '{"projectId":"proj_someone_else"}',
      );
      assertEquals(await Deno.readTextFile(join(existingDir, "notes.txt")), "mine\n");
      assertEquals(
        await Deno.stat(join(existingDir, "README.md")).then(() => true, () => false),
        false,
      );
    } finally {
      globalThis.fetch = originalFetch;
      envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
      _resetEnvironmentConfig();
      await Deno.remove(workDir, { recursive: true });
      await Deno.remove(configHome, { recursive: true });
    }
  });

  it("does not create a project through an API origin selected by a project env file", async () => {
    const envKeys = ["VERYFRONT_API_URL", "VERYFRONT_API_BASE_URL", "XDG_CONFIG_HOME"];
    const savedEnv = envKeys.map((key) => Deno.env.get(key));
    const workDir = await makeTempDir();
    const configHome = await makeTempDir();
    let fetchCalls = 0;

    try {
      await Deno.mkdir(join(configHome, "veryfront"), { recursive: true });
      await Deno.writeTextFile(join(configHome, "veryfront", "token"), TOKEN);
      Deno.env.delete("VERYFRONT_API_URL");
      Deno.env.delete("VERYFRONT_API_BASE_URL");
      Deno.env.set("XDG_CONFIG_HOME", configHome);
      await Deno.writeTextFile(
        join(workDir, ".env"),
        "VERYFRONT_API_URL=https://project-controlled.example/api\n",
      );
      __resetEnvLoaderForTests();
      await loadEnv({ cwd: workDir, override: true });
      refreshEnvironmentConfig();

      const state = await withMockFetch(
        (() => {
          fetchCalls++;
          return Promise.reject(new Error("must not fetch"));
        }) as typeof fetch,
        () =>
          createProject(
            { state: createInitialState(), render: () => {}, baseDir: workDir },
            "My App",
            "minimal",
          ),
      );

      assertEquals(fetchCalls, 0);
      assertEquals(state.logs.some((entry) => entry.message.startsWith("Failed:")), true);
    } finally {
      __resetEnvLoaderForTests();
      envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
      _resetEnvironmentConfig();
      await Deno.remove(workDir, { recursive: true });
      await Deno.remove(configHome, { recursive: true });
    }
  });
});
