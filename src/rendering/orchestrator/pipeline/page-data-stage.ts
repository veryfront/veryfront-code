import { join } from "#veryfront/compat/path";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import type { LayoutItem } from "#veryfront/types";
import { rendererLogger as logger } from "#veryfront/utils";
import { extractRelativePath as extractRelativePathShared } from "#veryfront/utils/route-path-utils.ts";
import { LAYOUT_EXTENSIONS } from "../../layouts/types.ts";
import type { PageRenderer } from "../../page-renderer.ts";
import type { PageResolver } from "../../page-resolution/index.ts";
import type { PageDataResponse, RenderOptions } from "../types.ts";

const renderPipelineLog = logger.component("render-pipeline");

export interface MdxMetadataResult {
  frontmatter: Record<string, unknown>;
  headings: Array<{ id: string; text: string; level: number }>;
}

export async function extractMdxMetadataStage(
  pageType: PageDataResponse["pageType"],
  pageInfo: Awaited<ReturnType<PageResolver["resolvePage"]>>,
  slug: string,
  options: RenderOptions | undefined,
  params: Record<string, string | string[]>,
  pageRenderer: PageRenderer,
): Promise<MdxMetadataResult> {
  if (pageType !== "mdx") {
    return { frontmatter: {}, headings: [] };
  }

  try {
    const bundleResult = await pageRenderer.preparePageBundles(
      pageInfo,
      slug,
      undefined,
      {
        ...options,
        ...(Object.keys(params).length > 0 ? { params } : {}),
      },
    );

    const pageBundle = bundleResult.pageBundle;
    return {
      frontmatter: pageBundle && "frontmatter" in pageBundle
        ? (pageBundle as { frontmatter?: Record<string, unknown> }).frontmatter || {}
        : {},
      headings: pageBundle && "headings" in pageBundle
        ? (pageBundle as {
          headings?: Array<{ id: string; text: string; level: number }>;
        }).headings || []
        : [],
    };
  } catch (error) {
    renderPipelineLog.error("Frontmatter/headings extraction failed", {
      slug,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return { frontmatter: {}, headings: [] };
  }
}

export function serializeLayoutsStage(
  nestedLayouts: LayoutItem[],
  projectDir: string,
): Array<{ kind: LayoutItem["kind"]; path: string }> {
  return nestedLayouts
    .filter((layout: LayoutItem) => layout.componentPath || layout.path)
    .map((layout: LayoutItem) => ({
      kind: layout.kind,
      path: extractRelativePathShared(
        layout.componentPath || layout.path || "",
        projectDir,
      ),
    }));
}

export function serializeLayoutPropsStage(
  layoutProps: Map<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const serialized: Record<string, Record<string, unknown>> = {};

  for (const [layoutId, props] of layoutProps.entries()) {
    serialized[layoutId] = props;
  }

  return serialized;
}

export async function resolveAppPathStage(
  adapter: RuntimeAdapter,
  projectDir: string,
): Promise<string | undefined> {
  for (const ext of LAYOUT_EXTENSIONS) {
    const candidatePath = join(projectDir, `components/app.${ext}`);
    if (await adapter.fs.exists(candidatePath)) {
      return extractRelativePathShared(candidatePath, projectDir);
    }
  }

  return undefined;
}

export function resolveProjectUpdatedAtStage(adapter: RuntimeAdapter): string | undefined {
  const fs = adapter?.fs;
  if (!fs || !isExtendedFSAdapter(fs) || !fs.isVeryfrontAdapter()) {
    return undefined;
  }

  const wrappedAdapter = fs.getUnderlyingAdapter() as {
    getProjectData?: () => { updated_at?: string } | undefined;
  };
  return wrappedAdapter.getProjectData?.()?.updated_at;
}
