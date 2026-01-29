/**
 * Unit tests for deploy command
 * @module cli/commands/deploy.test
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createDeployment,
  createRelease,
  DeployArgsSchema,
  getEnvironmentByName,
  parseDeployArgs,
} from "./deploy.ts";
import type { ApiClient } from "../shared/config.ts";
import type { ParsedArgs } from "../index/types.ts";

type MockClientOverrides = Partial<{
  get: (path: string, params?: Record<string, string>) => Promise<unknown>;
  post: (path: string, body?: unknown) => Promise<unknown>;
}>;

function createMockClient(overrides: MockClientOverrides = {}): ApiClient {
  return {
    get: async <T>(path: string, params?: Record<string, string>): Promise<T> => {
      const result = overrides.get ? await overrides.get(path, params) : { data: [] };
      return result as T;
    },
    post: async <T>(path: string, body?: unknown): Promise<T> => {
      const result = overrides.post ? await overrides.post(path, body) : {};
      return result as T;
    },
    put: <T>(): Promise<T> => Promise.resolve({} as T),
    patch: <T>(): Promise<T> => Promise.resolve({} as T),
    delete: <T>(): Promise<T> => Promise.resolve({} as T),
  };
}

async function expectErrorMessage(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (e) {
    return (e as Error).message;
  }
}

describe("DeployArgsSchema", () => {
  it("should use default values", () => {
    const result = DeployArgsSchema.safeParse({});
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.branch, "main");
    assertEquals(result.data.env, "production");
  });

  it("should accept custom branch and env", () => {
    const result = DeployArgsSchema.safeParse({ branch: "develop", env: "staging" });
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.branch, "develop");
    assertEquals(result.data.env, "staging");
  });

  it("should accept optional release name", () => {
    const result = DeployArgsSchema.safeParse({ releaseName: "v1.0.0" });
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.releaseName, "v1.0.0");
  });
});

describe("parseDeployArgs", () => {
  it("should use defaults when no args provided", () => {
    const args = { _: ["deploy"] } as ParsedArgs;
    const result = parseDeployArgs(args);
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.branch, "main");
    assertEquals(result.data.env, "production");
  });

  it("should parse --branch flag", () => {
    const args = { _: ["deploy"], branch: "develop" } as ParsedArgs;
    const result = parseDeployArgs(args);
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.branch, "develop");
  });

  it("should parse -b flag as branch", () => {
    const args = { _: ["deploy"], b: "feature" } as ParsedArgs;
    const result = parseDeployArgs(args);
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.branch, "feature");
  });

  it("should parse --env flag", () => {
    const args = { _: ["deploy"], env: "staging" } as ParsedArgs;
    const result = parseDeployArgs(args);
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.env, "staging");
  });

  it("should parse --release-name flag", () => {
    const args = { _: ["deploy"], "release-name": "v2.0.0" } as ParsedArgs;
    const result = parseDeployArgs(args);
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.releaseName, "v2.0.0");
  });

  it("should parse --dry-run and --force flags", () => {
    const args = { _: ["deploy"], "dry-run": true, force: true } as ParsedArgs;
    const result = parseDeployArgs(args);
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.dryRun, true);
    assertEquals(result.data.force, true);
  });

  it("should parse -f flag as force", () => {
    const args = { _: ["deploy"], f: true } as ParsedArgs;
    const result = parseDeployArgs(args);
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.force, true);
  });
});

describe("getEnvironmentByName", () => {
  it("should find environment by name", async () => {
    const mockClient = createMockClient({
      get: () =>
        Promise.resolve({
          data: [
            { id: "env-1", name: "production", protected: true },
            { id: "env-2", name: "staging", protected: false },
          ],
        }),
    });

    const env = await getEnvironmentByName(mockClient, "my-project", "staging");
    assertEquals(env, { id: "env-2", name: "staging", protected: false });
  });

  it("should return null when environment not found", async () => {
    const mockClient = createMockClient({
      get: () => Promise.resolve({ data: [] }),
    });

    const env = await getEnvironmentByName(mockClient, "my-project", "nonexistent");
    assertEquals(env, null);
  });
});

describe("createRelease", () => {
  it("should create release without options", async () => {
    let capturedUrl = "";
    let capturedBody: unknown = null;

    const mockClient = createMockClient({
      post: (url: string, body?: unknown) => {
        capturedUrl = url;
        capturedBody = body;
        return Promise.resolve({
          id: "rel-123",
          version: "1.0.0",
          name: "auto-generated",
        });
      },
    });

    const release = await createRelease(mockClient, "my-project");
    assertEquals(capturedUrl, "/projects/my-project/releases");
    assertEquals(capturedBody, {});
    assertEquals(release.id, "rel-123");
  });

  it("should create release with custom name", async () => {
    let capturedBody: unknown = null;

    const mockClient = createMockClient({
      post: (_url: string, body?: unknown) => {
        capturedBody = body;
        return Promise.resolve({ id: "rel-123" });
      },
    });

    await createRelease(mockClient, "my-project", { name: "v2.0.0" });
    assertEquals(capturedBody, { name: "v2.0.0" });
  });

  it("should create release from specific branch", async () => {
    let capturedBody: unknown = null;

    const mockClient = createMockClient({
      post: (_url: string, body?: unknown) => {
        capturedBody = body;
        return Promise.resolve({ id: "rel-123" });
      },
    });

    await createRelease(mockClient, "my-project", { branch: "develop" });
    assertEquals(capturedBody, { branch: "develop" });
  });

  it("should create release with name and branch", async () => {
    let capturedBody: unknown = null;

    const mockClient = createMockClient({
      post: (_url: string, body?: unknown) => {
        capturedBody = body;
        return Promise.resolve({ id: "rel-123" });
      },
    });

    await createRelease(mockClient, "my-project", { name: "v2.0.0", branch: "develop" });
    assertEquals(capturedBody, { name: "v2.0.0", branch: "develop" });
  });
});

describe("getEnvironmentByName - error handling", () => {
  it("should handle API error gracefully", async () => {
    const mockClient = createMockClient({
      get: () => Promise.reject(new Error("Network error")),
    });

    const message = await expectErrorMessage(() =>
      getEnvironmentByName(mockClient, "my-project", "production")
    );
    assertEquals(message, "Network error");
  });

  it("should handle paginated empty results", async () => {
    let callCount = 0;
    const mockClient = createMockClient({
      get: () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            data: [{ id: "env-1", name: "staging", protected: false }],
            page_info: { next: "cursor-2" },
          });
        }
        return Promise.resolve({ data: [], page_info: {} });
      },
    });

    const env = await getEnvironmentByName(mockClient, "my-project", "production");
    assertEquals(env, null);
    assertEquals(callCount, 2);
  });
});

describe("DeployArgsSchema - invalid inputs", () => {
  it("should reject empty branch name", () => {
    const result = DeployArgsSchema.safeParse({ branch: "" });
    assertEquals(result.success, false);
  });

  it("should reject empty env name", () => {
    const result = DeployArgsSchema.safeParse({ env: "" });
    assertEquals(result.success, false);
  });

  it("should reject empty release name", () => {
    const result = DeployArgsSchema.safeParse({ releaseName: "" });
    assertEquals(result.success, false);
  });
});

describe("createRelease - error handling", () => {
  it("should propagate API errors", async () => {
    const mockClient = createMockClient({
      post: () => Promise.reject(new Error("Release creation failed")),
    });

    const message = await expectErrorMessage(() => createRelease(mockClient, "my-project"));
    assertEquals(message, "Release creation failed");
  });

  it("should propagate errors for invalid branch", async () => {
    const mockClient = createMockClient({
      post: () => Promise.reject(new Error("Branch not found")),
    });

    const message = await expectErrorMessage(() =>
      createRelease(mockClient, "my-project", { branch: "nonexistent" })
    );
    assertEquals(message, "Branch not found");
  });
});

describe("createDeployment", () => {
  it("should create deployment with release and environment", async () => {
    let capturedUrl = "";
    let capturedBody: unknown = null;

    const mockClient = createMockClient({
      post: (url: string, body?: unknown) => {
        capturedUrl = url;
        capturedBody = body;
        return Promise.resolve({
          id: "deploy-123",
          release: "rel-456",
          environment: "env-789",
        });
      },
    });

    const deployment = await createDeployment(mockClient, "my-project", "rel-456", "env-789");
    assertEquals(capturedUrl, "/projects/my-project/deployments");
    assertEquals(capturedBody, { release_id: "rel-456", environment_id: "env-789" });
    assertEquals(deployment.id, "deploy-123");
  });
});

describe("createDeployment - error handling", () => {
  it("should propagate API errors for protected environment", async () => {
    const mockClient = createMockClient({
      post: () =>
        Promise.reject(new Error("Cannot deploy to protected environment without approval")),
    });

    const message = await expectErrorMessage(() =>
      createDeployment(mockClient, "my-project", "rel-123", "protected-env")
    );
    assertEquals(message, "Cannot deploy to protected environment without approval");
  });

  it("should propagate API errors for invalid release", async () => {
    const mockClient = createMockClient({
      post: () => Promise.reject(new Error("Release not found")),
    });

    const message = await expectErrorMessage(() =>
      createDeployment(mockClient, "my-project", "invalid-rel", "env-123")
    );
    assertEquals(message, "Release not found");
  });

  it("should propagate API errors for invalid environment", async () => {
    const mockClient = createMockClient({
      post: () => Promise.reject(new Error("Environment not found")),
    });

    const message = await expectErrorMessage(() =>
      createDeployment(mockClient, "my-project", "rel-123", "invalid-env")
    );
    assertEquals(message, "Environment not found");
  });
});
