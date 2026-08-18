import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import type { LayoutItem, MdxBundle, MDXComponents } from "#veryfront/types";
import {
  applyLayoutsESM,
  applyLayoutsFunctionBody,
  discoverNestedLayouts,
} from "#veryfront/rendering/layouts/index.ts";
import { withTestContext } from "../../_helpers/context.ts";
import type { RenderModes } from "#veryfront/rendering/context/render-context.ts";

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

/** Hosted production: production compile, no preview instrumentation. */
export const PRODUCTION_MODES: RenderModes = {
  compileMode: "production",
  environment: "production",
};

/** Local development: dev compile, preview instrumentation. */
export const DEVELOPMENT_MODES: RenderModes = {
  compileMode: "development",
  environment: "preview",
};

/** Hosted preview: production compile, preview instrumentation. */
export const PREVIEW_MODES: RenderModes = {
  compileMode: "production",
  environment: "preview",
};

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
    /**
     * Required on purpose. A default here would hide whichever mode the caller
     * meant to exercise, which is how the dev TSX layout path lost its coverage
     * (veryfront/veryfront-issue-inbox#555).
     */
    modes: RenderModes;
  },
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
    options.modes,
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
    /**
     * Required on purpose. A default here would hide whichever mode the caller
     * meant to exercise, which is how the dev TSX layout path lost its coverage
     * (veryfront/veryfront-issue-inbox#555).
     */
    modes: RenderModes;
  },
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
    options.modes,
  );
}
