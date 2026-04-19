import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import type { LayoutItem, MdxBundle, MDXComponents } from "#veryfront/types";
import {
  applyLayoutsESM,
  applyLayoutsFunctionBody,
  discoverNestedLayouts,
} from "#veryfront/rendering/layouts/index.ts";
import { withTestContext } from "../../_helpers/context.ts";

type LayoutTestContext = {
  projectDir: string;
  projectId: string;
};

type LayoutTestAdapter = Awaited<ReturnType<typeof getAdapter>>;

export function createMockCompileMDX(): (
  content: string,
  frontmatter?: unknown,
  filePath?: string,
) => Promise<MdxBundle> {
  return (_content: string, frontmatter?: unknown, _filePath?: string): Promise<MdxBundle> =>
    Promise.resolve({
      compiledCode: `
        export function MDXLayout({ children }) {
          return React.createElement('div', { className: 'layout' }, children);
        }
        export const frontmatter = ${JSON.stringify(frontmatter || {})};
      `,
      frontmatter: (frontmatter as Record<string, unknown>) || {},
      globals: {},
    });
}

export async function withLayoutHandlingContext(
  name: string,
  fn: (context: LayoutTestContext, adapter: LayoutTestAdapter) => Promise<void>,
): Promise<void> {
  await withTestContext(name, async (context) => {
    const adapter = await getAdapter();
    await fn(context, adapter);
  });
}

export function createLayoutCache(): LRUCache<string, unknown> {
  return new LRUCache<string, unknown>({ maxEntries: 10 });
}

export function discoverLayoutsForTest(
  pageFile: string,
  pagesRoot: string,
  context: LayoutTestContext,
  adapter: LayoutTestAdapter,
): Promise<LayoutItem[]> {
  return discoverNestedLayouts(
    pageFile,
    `${context.projectDir}/${pagesRoot}`,
    context.projectDir,
    adapter,
  );
}

export function applyLayoutsFunctionBodyForTest(
  context: LayoutTestContext,
  adapter: LayoutTestAdapter,
  pageElement: React.ReactElement,
  options: {
    layoutBundle?: MdxBundle;
    nestedLayouts?: LayoutItem[];
    components?: MDXComponents;
    cache?: LRUCache<string, unknown>;
  } = {},
) {
  return applyLayoutsFunctionBody(
    pageElement,
    options.layoutBundle,
    options.nestedLayouts ?? [],
    options.components ?? {},
    options.cache ?? createLayoutCache(),
    context.projectDir,
    adapter,
    undefined,
    context.projectId,
    context.projectId,
    "build-static",
  );
}

export function applyLayoutsEsmForTest(
  context: LayoutTestContext,
  adapter: LayoutTestAdapter,
  pageElement: React.ReactElement,
  options: {
    layoutBundle?: MdxBundle;
    nestedLayouts?: LayoutItem[];
    components?: MDXComponents;
    cache?: LRUCache<string, unknown>;
  } = {},
) {
  return applyLayoutsESM(
    pageElement,
    options.layoutBundle,
    options.nestedLayouts ?? [],
    context.projectDir,
    options.components ?? {},
    options.cache ?? createLayoutCache(),
    adapter,
    undefined,
    context.projectId,
    context.projectId,
    "build-static",
  );
}
