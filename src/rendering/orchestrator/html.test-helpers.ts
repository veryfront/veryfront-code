import type { DirEntry } from "#veryfront/platform/adapters/base.ts";
import { type HTMLGenerationContext, HTMLGenerator, type HTMLGeneratorConfig } from "./html.ts";

type MockReadFile = (path: string) => Promise<string>;
type MockReadDir = (path: string) => AsyncIterable<DirEntry>;

type CreateGeneratorOptions = {
  mode?: HTMLGeneratorConfig["mode"];
  isLocalProject?: boolean;
  readFile?: MockReadFile;
  readDir?: MockReadDir;
};

const defaultReadFile: MockReadFile = async () => "";
const defaultReadDir: MockReadDir = async function* () {};

export function createMockAdapter(
  readFile: MockReadFile = defaultReadFile,
  readDir: MockReadDir = defaultReadDir,
) {
  return {
    fs: {
      readFile,
      exists: async () => false,
      stat: async () => ({ isFile: false, isDirectory: false, isSymlink: false }),
      readDir,
      mkdir: async () => {},
      writeFile: async () => {},
    },
  };
}

export function createHTMLGenerator({
  mode = "production",
  isLocalProject,
  readFile = defaultReadFile,
  readDir = defaultReadDir,
}: CreateGeneratorOptions = {}): HTMLGenerator {
  return new HTMLGenerator({
    projectDir: "/project",
    adapter: createMockAdapter(readFile, readDir) as any,
    config: {} as any,
    mode,
    isLocalProject,
  });
}

export function createHTMLContext(
  overrides: Partial<HTMLGenerationContext> = {},
): HTMLGenerationContext {
  return {
    html: "<!DOCTYPE html><html><head></head><body><main>Hello</main></body></html>",
    pageInfo: {
      entity: {
        path: "/project/app/page.tsx",
        frontmatter: {},
      },
    } as any,
    pageBundle: {} as any,
    layoutBundle: undefined,
    nestedLayouts: [],
    collectedMetadata: {},
    slug: "test-page",
    ssrHash: "hash123",
    ...overrides,
  };
}

export function createSingleChunkStream(html: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(html));
      controller.close();
    },
  });
}
