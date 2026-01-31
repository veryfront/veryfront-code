import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  API_ENDPOINTS,
  BranchFileListItemSchema,
  EnvironmentFileListItemSchema,
  EnvironmentSchema,
  ListBranchFilesResponseSchema,
  ListEnvironmentFilesResponseSchema,
  LookupDomainResponseSchema,
  PageInfoSchema,
  ProjectFileSchema,
  ProjectSchema,
  ReleaseFileListItemSchema,
} from "./schemas.ts";

describe("schemas", () => {
  describe("ProjectSchema", () => {
    it("should validate a valid project", () => {
      const result = ProjectSchema.safeParse({
        id: "550e8400-e29b-41d4-a716-446655440000",
        name: "Test Project",
        slug: "test-project",
      });
      assertEquals(result.success, true);
    });

    it("should accept optional fields", () => {
      const result = ProjectSchema.safeParse({
        id: "550e8400-e29b-41d4-a716-446655440000",
        name: "Test",
        slug: "test",
        description: "A test project",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
        provider: "github",
        provider_id: "123",
        layout: null,
        layout_id: null,
        config: { key: "value" },
      });
      assertEquals(result.success, true);
    });

    it("should reject missing required fields", () => {
      const result = ProjectSchema.safeParse({ id: "not-a-uuid" });
      assertEquals(result.success, false);
    });

    it("should reject invalid UUID", () => {
      const result = ProjectSchema.safeParse({
        id: "not-a-uuid",
        name: "Test",
        slug: "test",
      });
      assertEquals(result.success, false);
    });
  });

  describe("ProjectFileSchema", () => {
    it("should validate a valid file", () => {
      const result = ProjectFileSchema.safeParse({
        path: "pages/index.tsx",
        size: 1024,
        type: "page",
        updated_at: "2024-01-01T00:00:00Z",
      });
      assertEquals(result.success, true);
    });

    it("should accept all file types", () => {
      const types = ["page", "function", "component", "file"] as const;

      for (const type of types) {
        const result = ProjectFileSchema.safeParse({
          path: "test.ts",
          size: 100,
          type,
          updated_at: "2024-01-01T00:00:00Z",
        });
        assertEquals(result.success, true);
      }
    });

    it("should reject invalid file type", () => {
      const result = ProjectFileSchema.safeParse({
        path: "test.ts",
        size: 100,
        type: "invalid",
        updated_at: "2024-01-01T00:00:00Z",
      });
      assertEquals(result.success, false);
    });
  });

  describe("PageInfoSchema", () => {
    it("should validate valid page info", () => {
      const result = PageInfoSchema.safeParse({
        self: "/api/projects?cursor=abc",
        first: null,
        next: "/api/projects?cursor=def",
        prev: null,
      });
      assertEquals(result.success, true);
    });

    it("should require first to be null", () => {
      const result = PageInfoSchema.safeParse({
        self: null,
        first: "some-value",
        next: null,
        prev: null,
      });
      assertEquals(result.success, false);
    });
  });

  describe("EnvironmentSchema", () => {
    it("should validate a valid environment", () => {
      const result = EnvironmentSchema.safeParse({
        id: "550e8400-e29b-41d4-a716-446655440000",
        name: "production",
      });
      assertEquals(result.success, true);
    });

    it("should reject missing name", () => {
      const result = EnvironmentSchema.safeParse({
        id: "550e8400-e29b-41d4-a716-446655440000",
      });
      assertEquals(result.success, false);
    });
  });

  describe("BranchFileListItemSchema", () => {
    it("should validate a branch file list item", () => {
      const result = BranchFileListItemSchema.safeParse({
        path: "pages/index.tsx",
        type: "page",
        size: 512,
        updated_at: "2024-01-01T00:00:00Z",
        content: "export default function Home() {}",
      });
      assertEquals(result.success, true);
    });
  });

  describe("ListBranchFilesResponseSchema", () => {
    it("should validate a list branch files response", () => {
      const result = ListBranchFilesResponseSchema.safeParse({
        data: [
          {
            path: "pages/index.tsx",
            type: "page",
            size: 512,
            updated_at: "2024-01-01T00:00:00Z",
            content: "code here",
          },
        ],
        page_info: { self: null, first: null, next: null, prev: null },
      });
      assertEquals(result.success, true);
    });
  });

  describe("EnvironmentFileListItemSchema", () => {
    it("should validate with versioned fields", () => {
      const result = EnvironmentFileListItemSchema.safeParse({
        id: "file-uuid",
        version_id: "version-uuid",
        path: "pages/index.tsx",
        type: "page",
        size: 256,
        updated_at: "2024-01-01T00:00:00Z",
        content: "export default function() {}",
      });
      assertEquals(result.success, true);
    });
  });

  describe("ListEnvironmentFilesResponseSchema", () => {
    it("should validate with environment meta fields", () => {
      const result = ListEnvironmentFilesResponseSchema.safeParse({
        data: [],
        page_info: { self: null, first: null, next: null, prev: null },
        environment_id: "env-uuid",
        environment_name: "production",
        release_id: "release-uuid",
        release_version: "1.0.0",
      });
      assertEquals(result.success, true);
    });
  });

  describe("ReleaseFileListItemSchema", () => {
    it("should validate a release file item", () => {
      const result = ReleaseFileListItemSchema.safeParse({
        id: "file-uuid",
        version_id: "version-uuid",
        path: "functions/api.ts",
        type: "function",
        size: 1024,
        updated_at: "2024-01-01T00:00:00Z",
        content: "export function handler() {}",
      });
      assertEquals(result.success, true);
    });
  });

  describe("LookupDomainResponseSchema", () => {
    it("should validate a domain lookup response", () => {
      const result = LookupDomainResponseSchema.safeParse({
        project_id: "550e8400-e29b-41d4-a716-446655440000",
        project_slug: "my-project",
        project_name: "My Project",
        environment: {
          id: "660e8400-e29b-41d4-a716-446655440000",
          name: "production",
        },
        release_id: "770e8400-e29b-41d4-a716-446655440000",
      });
      assertEquals(result.success, true);
    });

    it("should accept null environment and release_id", () => {
      const result = LookupDomainResponseSchema.safeParse({
        project_id: "550e8400-e29b-41d4-a716-446655440000",
        project_slug: "my-project",
        project_name: "My Project",
        environment: null,
        release_id: null,
      });
      assertEquals(result.success, true);
    });
  });

  describe("API_ENDPOINTS", () => {
    it("should define all expected endpoints", () => {
      const expectedKeys = [
        "listProjects",
        "getProject",
        "listBranchFiles",
        "getBranchFile",
        "listEnvironmentFiles",
        "getEnvironmentFile",
        "listReleaseFiles",
        "getReleaseFile",
        "lookupDomain",
      ] as const;

      for (const key of expectedKeys) {
        assertExists(API_ENDPOINTS[key]);
      }
    });

    it("should have method and path for each endpoint", () => {
      for (const endpoint of Object.values(API_ENDPOINTS)) {
        assertExists(endpoint.method);
        assertExists(endpoint.path);
        assertExists(endpoint.description);
        assertEquals(typeof endpoint.method, "string");
        assertEquals(typeof endpoint.path, "string");
      }
    });

    it("should use GET method for all endpoints", () => {
      for (const endpoint of Object.values(API_ENDPOINTS)) {
        assertEquals(endpoint.method, "GET");
      }
    });

    it("should have paths starting with /", () => {
      for (const endpoint of Object.values(API_ENDPOINTS)) {
        assertEquals(endpoint.path.startsWith("/"), true);
      }
    });
  });
});
