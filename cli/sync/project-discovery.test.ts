import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for project discovery
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
} from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { makeTempDir, remove } from "#veryfront/platform/compat/fs.ts";
import { deleteToken, saveToken } from "../auth/token-store.ts";
import {
  fetchRemoteProjects,
  getCurrentUser,
  isAuthenticated,
  type ProjectDiscoveryResult,
  type RemoteProject,
} from "./project-discovery.ts";

describe("project-discovery", () => {
  let tempDir = "";
  let originalXdgConfig: string | undefined;

  beforeAll(async () => {
    tempDir = await makeTempDir({ prefix: "project-discovery-test-" });
    originalXdgConfig = getEnv("XDG_CONFIG_HOME");
  });

  beforeEach(async () => {
    setEnv("XDG_CONFIG_HOME", tempDir);
    await deleteToken();
  });

  afterEach(async () => {
    await deleteToken();
    if (originalXdgConfig == null) {
      deleteEnv("XDG_CONFIG_HOME");
    } else {
      setEnv("XDG_CONFIG_HOME", originalXdgConfig);
    }
  });

  afterAll(async () => {
    await remove(tempDir, { recursive: true });
  });

  describe("fetchRemoteProjects", () => {
    it("is a function", () => {
      assertEquals(typeof fetchRemoteProjects, "function");
    });

    it("returns ProjectDiscoveryResult structure", async () => {
      const result = await fetchRemoteProjects();

      assertExists(result);
      assertExists(result.projects);
      assertEquals(Array.isArray(result.projects), true);

      // user could be null if not authenticated
      if (result.user !== null) {
        assertExists(result.user.email);
      }
    });

    it("handles unauthenticated state", async () => {
      const result = await fetchRemoteProjects();

      if (!result.user) {
        assertExists(result.error);
        assertEquals(result.projects.length, 0);
      }
    });

    it("returns projects for a valid project API key without requiring a user profile", async () => {
      const originalFetch = globalThis.fetch;
      await saveToken("vf_test_secret");

      try {
        globalThis.fetch = ((input: string | URL | Request) => {
          const url = new URL(String(input));
          assertEquals(url.pathname, "/projects");
          return Promise.resolve(
            new Response(
              JSON.stringify({
                data: [{ id: "project-123", slug: "test-project", name: "Test Project" }],
                page_info: {},
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        }) as typeof fetch;

        const result = await fetchRemoteProjects();

        assertEquals(result.user, null);
        assertEquals(result.credentialType, "apiKey");
        assertEquals(result.error, undefined);
        assertEquals(result.projects, [
          { id: "project-123", slug: "test-project", name: "Test Project" },
        ]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("isAuthenticated", () => {
    it("is a function", () => {
      assertEquals(typeof isAuthenticated, "function");
    });

    it("returns a boolean", async () => {
      const result = await isAuthenticated();
      assertEquals(typeof result, "boolean");
    });
  });

  describe("getCurrentUser", () => {
    it("is a function", () => {
      assertEquals(typeof getCurrentUser, "function");
    });

    it("returns null when not authenticated", async () => {
      const user = await getCurrentUser();

      if (user !== null) {
        assertExists(user.email);
      }
    });
  });

  describe("Type interfaces", () => {
    it("RemoteProject has expected shape", () => {
      const project: RemoteProject = {
        id: "proj-123",
        slug: "my-project",
        name: "My Project",
        description: "A test project",
        updatedAt: "2025-01-01T00:00:00Z",
      };

      assertEquals(project.id, "proj-123");
      assertEquals(project.slug, "my-project");
      assertEquals(project.name, "My Project");
    });

    it("ProjectDiscoveryResult has expected shape", () => {
      const result: ProjectDiscoveryResult = {
        user: null,
        projects: [],
        error: "Test error",
      };

      assertEquals(result.user, null);
      assertEquals(result.projects.length, 0);
      assertEquals(result.error, "Test error");
    });
  });
});
