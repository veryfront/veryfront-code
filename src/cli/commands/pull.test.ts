/**
 * Unit tests for pull command
 * @module cli/commands/pull.test
 */

import { assertEquals } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import {
  buildFileContentUrl,
  buildFilesListUrl,
  getFileContent,
  listAllFiles,
  type PullOptions,
  type PullSource,
  resolvePullSource,
} from "./pull.ts";
import type { ApiClient } from "../shared/config.ts";

// Mock client creator - returns ApiClient-compatible mock
function createMockClient(overrides: {
  get?: (url: string, params?: unknown) => Promise<unknown>;
  post?: (url: string, body?: unknown) => Promise<unknown>;
} = {}): ApiClient {
  return {
    get: overrides.get ?? (() => Promise.resolve({ data: [] })),
    post: overrides.post ?? (() => Promise.resolve({})),
    put: () => Promise.resolve({}),
    patch: () => Promise.resolve({}),
    delete: () => Promise.resolve({}),
  } as unknown as ApiClient;
}

// Test resolvePullSource - priority order: env > release > branch > main
describe("resolvePullSource", () => {
  it("should return main source when no options", () => {
    const options: PullOptions = {};
    const result = resolvePullSource(options);
    assertEquals(result, { type: "main" });
  });

  it("should return branch source when branch is specified", () => {
    const options: PullOptions = { branch: "feature-x" };
    const result = resolvePullSource(options);
    assertEquals(result, { type: "branch", name: "feature-x" });
  });

  it("should return main for branch='main'", () => {
    const options: PullOptions = { branch: "main" };
    const result = resolvePullSource(options);
    assertEquals(result, { type: "main" });
  });

  it("should return environment source when env is specified", () => {
    const options: PullOptions = { env: "production" };
    const result = resolvePullSource(options);
    assertEquals(result, { type: "environment", name: "production" });
  });

  it("should return release source when release is specified", () => {
    const options: PullOptions = { release: "v1.2.0" };
    const result = resolvePullSource(options);
    assertEquals(result, { type: "release", version: "v1.2.0" });
  });

  it("should prioritize env over release", () => {
    const options: PullOptions = { env: "production", release: "v1.2.0" };
    const result = resolvePullSource(options);
    assertEquals(result, { type: "environment", name: "production" });
  });

  it("should prioritize env over branch", () => {
    const options: PullOptions = { env: "production", branch: "feature-x" };
    const result = resolvePullSource(options);
    assertEquals(result, { type: "environment", name: "production" });
  });

  it("should prioritize release over branch", () => {
    const options: PullOptions = { release: "v1.2.0", branch: "feature-x" };
    const result = resolvePullSource(options);
    assertEquals(result, { type: "release", version: "v1.2.0" });
  });

  it("should prioritize env over release and branch", () => {
    const options: PullOptions = { env: "staging", release: "v1.2.0", branch: "feature-x" };
    const result = resolvePullSource(options);
    assertEquals(result, { type: "environment", name: "staging" });
  });
});

// Test buildFilesListUrl
describe("buildFilesListUrl", () => {
  it("should build main files URL", () => {
    const source: PullSource = { type: "main" };
    const url = buildFilesListUrl("my-project", source);
    assertEquals(url, "/projects/my-project/files");
  });

  it("should build branch files URL", () => {
    const source: PullSource = { type: "branch", name: "feature-x" };
    const url = buildFilesListUrl("my-project", source);
    assertEquals(url, "/projects/my-project/branches/feature-x/files");
  });

  it("should encode branch name in URL", () => {
    const source: PullSource = { type: "branch", name: "feature/new stuff" };
    const url = buildFilesListUrl("my-project", source);
    assertEquals(url, "/projects/my-project/branches/feature%2Fnew%20stuff/files");
  });

  it("should build environment files URL", () => {
    const source: PullSource = { type: "environment", name: "production" };
    const url = buildFilesListUrl("my-project", source);
    assertEquals(url, "/projects/my-project/environments/production/files");
  });

  it("should encode environment name in URL", () => {
    const source: PullSource = { type: "environment", name: "my env" };
    const url = buildFilesListUrl("my-project", source);
    assertEquals(url, "/projects/my-project/environments/my%20env/files");
  });

  it("should build release files URL", () => {
    const source: PullSource = { type: "release", version: "v1.2.0" };
    const url = buildFilesListUrl("my-project", source);
    assertEquals(url, "/projects/my-project/releases/v1.2.0/files");
  });

  it("should encode release version in URL", () => {
    const source: PullSource = { type: "release", version: "v1.2.0+build" };
    const url = buildFilesListUrl("my-project", source);
    assertEquals(url, "/projects/my-project/releases/v1.2.0%2Bbuild/files");
  });
});

// Test buildFileContentUrl
describe("buildFileContentUrl", () => {
  it("should build main file content URL", () => {
    const source: PullSource = { type: "main" };
    const url = buildFileContentUrl("my-project", "pages/index.tsx", source);
    assertEquals(url, "/projects/my-project/files/pages%2Findex.tsx");
  });

  it("should build branch file content URL", () => {
    const source: PullSource = { type: "branch", name: "feature-x" };
    const url = buildFileContentUrl("my-project", "pages/index.tsx", source);
    assertEquals(url, "/projects/my-project/branches/feature-x/files/pages%2Findex.tsx");
  });

  it("should build environment file content URL", () => {
    const source: PullSource = { type: "environment", name: "production" };
    const url = buildFileContentUrl("my-project", "pages/index.tsx", source);
    assertEquals(url, "/projects/my-project/environments/production/files/pages%2Findex.tsx");
  });

  it("should build release file content URL", () => {
    const source: PullSource = { type: "release", version: "v1.2.0" };
    const url = buildFileContentUrl("my-project", "pages/index.tsx", source);
    assertEquals(url, "/projects/my-project/releases/v1.2.0/files/pages%2Findex.tsx");
  });

  it("should encode file path with special characters", () => {
    const source: PullSource = { type: "main" };
    const url = buildFileContentUrl("my-project", "pages/[id]/index.tsx", source);
    assertEquals(url, "/projects/my-project/files/pages%2F%5Bid%5D%2Findex.tsx");
  });
});

// Test listAllFiles
describe("listAllFiles", () => {
  it("should fetch files from main", async () => {
    let capturedUrl = "";
    const mockClient = createMockClient({
      get: (url: string) => {
        capturedUrl = url;
        return Promise.resolve({
          data: [
            { path: "pages/index.tsx", size: 100, type: "file", created_at: "", updated_at: "" },
          ],
          page_info: { next: undefined },
        });
      },
    });

    const source: PullSource = { type: "main" };
    const files = await listAllFiles(mockClient, "my-project", source);

    assertEquals(capturedUrl, "/projects/my-project/files");
    assertEquals(files.length, 1);
    assertEquals(files[0]?.path, "pages/index.tsx");
  });

  it("should fetch files from branch", async () => {
    let capturedUrl = "";
    const mockClient = createMockClient({
      get: (url: string) => {
        capturedUrl = url;
        return Promise.resolve({
          data: [
            { path: "pages/index.tsx", size: 100, type: "file", created_at: "", updated_at: "" },
          ],
          page_info: { next: undefined },
        });
      },
    });

    const source: PullSource = { type: "branch", name: "feature-x" };
    const files = await listAllFiles(mockClient, "my-project", source);

    assertEquals(capturedUrl, "/projects/my-project/branches/feature-x/files");
    assertEquals(files.length, 1);
  });

  it("should fetch files from environment", async () => {
    let capturedUrl = "";
    const mockClient = createMockClient({
      get: (url: string) => {
        capturedUrl = url;
        return Promise.resolve({
          data: [
            { path: "pages/index.tsx", size: 100, type: "file", created_at: "", updated_at: "" },
          ],
          page_info: { next: undefined },
        });
      },
    });

    const source: PullSource = { type: "environment", name: "production" };
    const files = await listAllFiles(mockClient, "my-project", source);

    assertEquals(capturedUrl, "/projects/my-project/environments/production/files");
    assertEquals(files.length, 1);
  });

  it("should fetch files from release", async () => {
    let capturedUrl = "";
    const mockClient = createMockClient({
      get: (url: string) => {
        capturedUrl = url;
        return Promise.resolve({
          data: [
            { path: "pages/index.tsx", size: 100, type: "file", created_at: "", updated_at: "" },
          ],
          page_info: { next: undefined },
        });
      },
    });

    const source: PullSource = { type: "release", version: "v1.2.0" };
    const files = await listAllFiles(mockClient, "my-project", source);

    assertEquals(capturedUrl, "/projects/my-project/releases/v1.2.0/files");
    assertEquals(files.length, 1);
  });

  it("should handle pagination", async () => {
    let callCount = 0;
    const mockClient = createMockClient({
      get: () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            data: [
              { path: "pages/index.tsx", size: 100, type: "file", created_at: "", updated_at: "" },
            ],
            page_info: { next: "cursor1" },
          });
        }
        return Promise.resolve({
          data: [
            { path: "pages/about.tsx", size: 50, type: "file", created_at: "", updated_at: "" },
          ],
          page_info: { next: undefined },
        });
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

// Test getFileContent
describe("getFileContent", () => {
  it("should fetch file content from main", async () => {
    let capturedUrl = "";
    const mockClient = createMockClient({
      get: (url: string) => {
        capturedUrl = url;
        return Promise.resolve({
          path: "pages/index.tsx",
          content: "export default function Home() {}",
          size: 33,
        });
      },
    });

    const source: PullSource = { type: "main" };
    const content = await getFileContent(mockClient, "my-project", "pages/index.tsx", source);

    assertEquals(capturedUrl, "/projects/my-project/files/pages%2Findex.tsx");
    assertEquals(content, "export default function Home() {}\n");
  });

  it("should fetch file content from environment", async () => {
    let capturedUrl = "";
    const mockClient = createMockClient({
      get: (url: string) => {
        capturedUrl = url;
        return Promise.resolve({
          path: "pages/index.tsx",
          content: "export default function Home() {}",
          size: 33,
        });
      },
    });

    const source: PullSource = { type: "environment", name: "production" };
    const content = await getFileContent(mockClient, "my-project", "pages/index.tsx", source);

    assertEquals(
      capturedUrl,
      "/projects/my-project/environments/production/files/pages%2Findex.tsx",
    );
    assertEquals(content, "export default function Home() {}\n");
  });

  it("should fetch file content from release", async () => {
    let capturedUrl = "";
    const mockClient = createMockClient({
      get: (url: string) => {
        capturedUrl = url;
        return Promise.resolve({
          path: "pages/index.tsx",
          content: "export default function Home() {}",
          size: 33,
        });
      },
    });

    const source: PullSource = { type: "release", version: "v1.2.0" };
    const content = await getFileContent(mockClient, "my-project", "pages/index.tsx", source);

    assertEquals(capturedUrl, "/projects/my-project/releases/v1.2.0/files/pages%2Findex.tsx");
    assertEquals(content, "export default function Home() {}\n");
  });

  it("should add trailing newline if missing", async () => {
    const mockClient = createMockClient({
      get: () =>
        Promise.resolve({
          path: "pages/index.tsx",
          content: "export default function Home() {}",
          size: 33,
        }),
    });

    const source: PullSource = { type: "main" };
    const content = await getFileContent(mockClient, "my-project", "pages/index.tsx", source);

    assertEquals(content.endsWith("\n"), true);
  });

  it("should not add extra newline if already present", async () => {
    const mockClient = createMockClient({
      get: () =>
        Promise.resolve({
          path: "pages/index.tsx",
          content: "export default function Home() {}\n",
          size: 34,
        }),
    });

    const source: PullSource = { type: "main" };
    const content = await getFileContent(mockClient, "my-project", "pages/index.tsx", source);

    assertEquals(content, "export default function Home() {}\n");
    assertEquals(content.endsWith("\n\n"), false);
  });
});
