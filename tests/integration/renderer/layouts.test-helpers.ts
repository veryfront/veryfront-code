import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import type { LayoutItem, MdxBundle, MDXComponents } from "#veryfront/types";
import {
  applyLayoutsESM,
  applyLayoutsFunctionBody,
  discoverNestedLayouts,
} from "#veryfront/rendering/index.ts";
import { withTestContext } from "../../_helpers/context.ts";

type LayoutsTestContext = {
  projectDir: string;
  projectId: string;
};

type LayoutsTestAdapter = Awaited<ReturnType<typeof getAdapter>>;

export function createMockCompileMDX(): (
  content: string,
  frontmatter?: unknown,
  filePath?: string,
) => Promise<MdxBundle> {
  return (_content: string, frontmatter?: unknown, _filePath?: string): Promise<MdxBundle> => {
    const fm = frontmatter ?? {};
    return Promise.resolve({
      compiledCode: `
        export function MDXLayout({ children }) {
          return React.createElement('div', { className: 'layout' }, children);
        }
        export const frontmatter = ${JSON.stringify(fm)};
      `,
      frontmatter: (fm as Record<string, unknown>) || {},
      globals: {},
    });
  };
}

export async function withLayoutsTestContext(
  name: string,
  fn: (context: LayoutsTestContext, adapter: LayoutsTestAdapter) => Promise<void>,
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
  routesRoot: string,
  context: LayoutsTestContext,
  adapter: LayoutsTestAdapter,
): Promise<LayoutItem[]> {
  return discoverNestedLayouts(
    pageFile,
    `${context.projectDir}/${routesRoot}`,
    context.projectDir,
    adapter,
  );
}

export function applyLayoutsFunctionBodyForTest(
  context: LayoutsTestContext,
  adapter: LayoutsTestAdapter,
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
  context: LayoutsTestContext,
  adapter: LayoutsTestAdapter,
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
