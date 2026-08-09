import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { withCwd } from "#veryfront/testing/cwd.ts";
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

      // Only the call itself needs the directory: it resolves the new project
      // relative to the process cwd. Everything around it uses absolute paths.
      const state = await withCwd(workDir, () =>
        createProject(
          { state: createInitialState(), render: () => {} },
          "My App",
          "minimal",
        ));

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
});
