/**
 * Unit tests for pull command
 * @module cli/commands/pull.test
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildFileContentUrl,
  buildFilesListUrl,
  getFileContent,
  listAllFiles,
  type PullOptions,
  type PullSource,
  resolvePullSource,
} from "./command.ts";
import type { ApiClient } from "#cli/shared/config";

function createMockClient(overrides: {
  get?: (url: string, params?: unknown) => Promise<unknown>;
} = {}): ApiClient {
  return {
    get: overrides.get ?? (() => Promise.resolve({ data: [] })),
    post: () => Promise.resolve({}),
    put: () => Promise.resolve({}),
    patch: () => Promise.resolve({}),
    delete: () => Promise.resolve({}),
  } as ApiClient;
}

function mockFilesResponse(paths: string[], next?: string): Promise<unknown> {
  return Promise.resolve({
    data: paths.map((path) => ({
      path,
      size: 100,
      type: "file",
      created_at: "",
      updated_at: "",
    })),
    page_info: { next },
  });
}

function mockFileContentResponse(content: string): Promise<unknown> {
  return Promise.resolve({
    path: "pages/index.tsx",
    content,
    size: content.length,
  });
}

describe("resolvePullSource", () => {
  it("should return main source when no options", () => {
    const options: PullOptions = {};
    assertEquals(resolvePullSource(options), { type: "main" });
  });

  it("should return branch source when branch is specified", () => {
    const options: PullOptions = { branch: "feature-x" };
    assertEquals(resolvePullSource(options), { type: "branch", name: "feature-x" });
  });

  it("should return main for branch='main'", () => {
    const options: PullOptions = { branch: "main" };
    assertEquals(resolvePullSource(options), { type: "main" });
  });

  it("should return environment source when env is specified", () => {
    const options: PullOptions = { env: "production" };
    assertEquals(resolvePullSource(options), { type: "environment", name: "production" });
  });

  it("should return release source when release is specified", () => {
    const options: PullOptions = { release: "v1.2.0" };
    assertEquals(resolvePullSource(options), { type: "release", version: "v1.2.0" });
  });

  it("should prioritize env over release", () => {
    const options: PullOptions = { env: "production", release: "v1.2.0" };
    assertEquals(resolvePullSource(options), { type: "environment", name: "production" });
  });

  it("should prioritize env over branch", () => {
    const options: PullOptions = { env: "production", branch: "feature-x" };
    assertEquals(resolvePullSource(options), { type: "environment", name: "production" });
  });

  it("should prioritize release over branch", () => {
    const options: PullOptions = { release: "v1.2.0", branch: "feature-x" };
    assertEquals(resolvePullSource(options), { type: "release", version: "v1.2.0" });
  });

  it("should prioritize env over release and branch", () => {
    const options: PullOptions = { env: "staging", release: "v1.2.0", branch: "feature-x" };
    assertEquals(resolvePullSource(options), { type: "environment", name: "staging" });
  });
});

describe("buildFilesListUrl", () => {
  it("should build main files URL", () => {
    const source: PullSource = { type: "main" };
    assertEquals(buildFilesListUrl("my-project", source), "/projects/my-project/files");
  });

  it("should build branch files URL", () => {
    const source: PullSource = { type: "branch", name: "feature-x" };
    assertEquals(
      buildFilesListUrl("my-project", source),
      "/projects/my-project/files?branch=feature-x",
    );
  });

  it("should encode branch name in URL", () => {
    const source: PullSource = { type: "branch", name: "feature/new stuff" };
    assertEquals(
      buildFilesListUrl("my-project", source),
      "/projects/my-project/files?branch=feature%2Fnew%20stuff",
    );
  });

  it("should build environment files URL", () => {
    const source: PullSource = { type: "environment", name: "production" };
    assertEquals(
      buildFilesListUrl("my-project", source),
      "/projects/my-project/environments/production/files",
    );
  });

  it("should encode environment name in URL", () => {
    const source: PullSource = { type: "environment", name: "my env" };
    assertEquals(
      buildFilesListUrl("my-project", source),
      "/projects/my-project/environments/my%20env/files",
    );
  });

  it("should build release files URL", () => {
    const source: PullSource = { type: "release", version: "v1.2.0" };
    assertEquals(
      buildFilesListUrl("my-project", source),
      "/projects/my-project/releases/v1.2.0/files",
    );
  });

  it("should encode release version in URL", () => {
    const source: PullSource = { type: "release", version: "v1.2.0+build" };
    assertEquals(
      buildFilesListUrl("my-project", source),
      "/projects/my-project/releases/v1.2.0%2Bbuild/files",
    );
  });
});

describe("buildFileContentUrl", () => {
  it("should build main file content URL", () => {
    const source: PullSource = { type: "main" };
    assertEquals(
      buildFileContentUrl("my-project", "pages/index.tsx", source),
      "/projects/my-project/files/pages%2Findex.tsx",
    );
  });

  it("should build branch file content URL", () => {
    const source: PullSource = { type: "branch", name: "feature-x" };
    assertEquals(
      buildFileContentUrl("my-project", "pages/index.tsx", source),
      "/projects/my-project/files/pages%2Findex.tsx?branch=feature-x",
    );
  });

  it("should build environment file content URL", () => {
    const source: PullSource = { type: "environment", name: "production" };
    assertEquals(
      buildFileContentUrl("my-project", "pages/index.tsx", source),
      "/projects/my-project/environments/production/files/pages%2Findex.tsx",
    );
  });

  it("should build release file content URL", () => {
    const source: PullSource = { type: "release", version: "v1.2.0" };
    assertEquals(
      buildFileContentUrl("my-project", "pages/index.tsx", source),
      "/projects/my-project/releases/v1.2.0/files/pages%2Findex.tsx",
    );
  });

  it("should encode file path with special characters", () => {
    const source: PullSource = { type: "main" };
    assertEquals(
      buildFileContentUrl("my-project", "pages/[id]/index.tsx", source),
      "/projects/my-project/files/pages%2F%5Bid%5D%2Findex.tsx",
    );
  });
});

describe("listAllFiles", () => {
  async function testListAllFiles(
    source: PullSource,
    expectedUrl: string,
  ): Promise<void> {
    let capturedUrl = "";
    const mockClient = createMockClient({
      get: (url: string) => {
        capturedUrl = url;
        return mockFilesResponse(["pages/index.tsx"]);
      },
    });

    const files = await listAllFiles(mockClient, "my-project", source);

    assertEquals(capturedUrl, expectedUrl);
    assertEquals(files.length, 1);
    assertEquals(files[0]?.path, "pages/index.tsx");
  }

  it("should fetch files from main", async () => {
    await testListAllFiles({ type: "main" }, "/projects/my-project/files");
  });

  it("should fetch files from branch", async () => {
    await testListAllFiles(
      { type: "branch", name: "feature-x" },
      "/projects/my-project/files?branch=feature-x",
    );
  });

  it("should fetch files from environment", async () => {
    await testListAllFiles(
      { type: "environment", name: "production" },
      "/projects/my-project/environments/production/files",
    );
  });

  it("should fetch files from release", async () => {
    await testListAllFiles(
      { type: "release", version: "v1.2.0" },
      "/projects/my-project/releases/v1.2.0/files",
    );
  });

  it("should handle pagination", async () => {
    let callCount = 0;
    const mockClient = createMockClient({
      get: () => {
        callCount++;
        if (callCount === 1) return mockFilesResponse(["pages/index.tsx"], "cursor1");
        return mockFilesResponse(["pages/about.tsx"]);
      },
    });

    const source: PullSource = { type: "main" };
    const files = await listAllFiles(mockClient, "my-project", source);

    assertEquals(callCount, 2);
    assertEquals(files.length, 2);
    assertEquals(files[0]?.path, "pages/index.tsx");
    assertEquals(files[1]?.path, "pages/about.tsx");
  });
});

describe("getFileContent", () => {
  async function testGetFileContent(
    source: PullSource,
    expectedUrl: string,
  ): Promise<void> {
    let capturedUrl = "";
    const mockClient = createMockClient({
      get: (url: string) => {
        capturedUrl = url;
        return mockFileContentResponse("export default function Home() {}");
      },
    });

    const content = await getFileContent(mockClient, "my-project", "pages/index.tsx", source);

    assertEquals(capturedUrl, expectedUrl);
    assertEquals(content, "export default function Home() {}\n");
  }

  it("should fetch file content from main", async () => {
    await testGetFileContent(
      { type: "main" },
      "/projects/my-project/files/pages%2Findex.tsx",
    );
  });

  it("should fetch file content from branch", async () => {
    await testGetFileContent(
      { type: "branch", name: "feature-x" },
      "/projects/my-project/files/pages%2Findex.tsx?branch=feature-x",
    );
  });

  it("should fetch file content from environment", async () => {
    await testGetFileContent(
      { type: "environment", name: "production" },
      "/projects/my-project/environments/production/files/pages%2Findex.tsx",
    );
  });

  it("should fetch file content from release", async () => {
    await testGetFileContent(
      { type: "release", version: "v1.2.0" },
      "/projects/my-project/releases/v1.2.0/files/pages%2Findex.tsx",
    );
  });

  it("should add trailing newline if missing", async () => {
    const mockClient = createMockClient({
      get: () => mockFileContentResponse("export default function Home() {}"),
    });

    const source: PullSource = { type: "main" };
    const content = await getFileContent(mockClient, "my-project", "pages/index.tsx", source);

    assertEquals(content.endsWith("\n"), true);
  });

  it("should not add extra newline if already present", async () => {
    const mockClient = createMockClient({
      get: () => mockFileContentResponse("export default function Home() {}\n"),
    });

    const source: PullSource = { type: "main" };
    const content = await getFileContent(mockClient, "my-project", "pages/index.tsx", source);

    assertEquals(content, "export default function Home() {}\n");
    assertEquals(content.endsWith("\n\n"), false);
  });
});
