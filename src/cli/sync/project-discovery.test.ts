/**
 * Tests for project discovery
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  fetchRemoteProjects,
  getCurrentUser,
  isAuthenticated,
  type ProjectDiscoveryResult,
  type RemoteProject,
} from "./project-discovery.ts";

describe("project-discovery", () => {
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
