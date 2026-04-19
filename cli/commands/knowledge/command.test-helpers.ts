import type { ApiClient } from "#cli/shared/config";

type MockClientOverrides = {
  get?: (path: string, params?: Record<string, string>) => Promise<unknown>;
};

type DownloadResult = {
  uploadPath: string;
  localPath: string;
};

export function createMockClient(overrides: MockClientOverrides = {}): ApiClient {
  return {
    get: async <T>(path: string, params?: Record<string, string>): Promise<T> => {
      const result = await (overrides.get?.(path, params) ?? Promise.resolve({ data: [] }));
      return result as T;
    },
    post: <T>(): Promise<T> => Promise.resolve({} as T),
    put: <T>(): Promise<T> => Promise.resolve({} as T),
    patch: <T>(): Promise<T> => Promise.resolve({} as T),
    delete: <T>(): Promise<T> => Promise.resolve({} as T),
  };
}

export function createUploadSource(input: string, localPath = `/workspace/${input}`) {
  return {
    kind: "upload" as const,
    input,
    uploadPath: input,
    localPath,
  };
}

export function createLocalSource(input: string, localPath = input) {
  return {
    kind: "local" as const,
    input,
    localPath,
  };
}

export function createKnowledgeCommandArgs(overrides: Record<string, unknown> = {}) {
  return {
    sources: [],
    path: undefined,
    all: false,
    recursive: false,
    outputDir: "/workspace/knowledge",
    knowledgePath: "knowledge",
    description: undefined,
    slug: undefined,
    json: true,
    quiet: false,
    projectDir: undefined,
    projectSlug: undefined,
    ...overrides,
  };
}

export function createDownloadUploadsStub(calls: string[][] = []) {
  return async (uploadPaths: string[]): Promise<DownloadResult[]> => {
    calls.push(uploadPaths);
    return uploadPaths.map((uploadPath) => ({
      uploadPath,
      localPath: `/workspace/${uploadPath}`,
    }));
  };
}

export function createParserSuccess(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    source_path: "/workspace/uploads/contracts/q1.pdf",
    source_filename: "q1.pdf",
    source_type: "pdf",
    slug: "contracts-q1",
    sandbox_output_path: "/workspace/knowledge/contracts-q1.md",
    suggested_project_path: "knowledge/contracts-q1.md",
    description: "Parsed from q1.pdf",
    title: "Q1",
    summary: "Extracted 4 page(s).",
    stats: { pages: 4 },
    warnings: [],
    ...overrides,
  };
}
