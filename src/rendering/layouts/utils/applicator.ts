import { rendererLogger as logger } from "#veryfront/utils";
import * as BundledReact from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { LayoutItem, MdxBundle, MDXComponents } from "#veryfront/types";
import type { LayoutComponentCache } from "./component-loader.ts";
import { mdxRenderer } from "#veryfront/transforms/mdx/index.ts";
import { applyMDXLayout, applyTSXLayout, loadTSXComponent } from "./component-loader.ts";
import { getElementTypeName } from "../../element-validator/primitive-checks.ts";
import { getProjectReact } from "#veryfront/react";
import { ensureValidChild } from "./ensure-valid-child.ts";

export async function applyLayoutsESM(
  pageElement: BundledReact.ReactElement,
  layoutBundle: MdxBundle | undefined,
  nestedLayouts: LayoutItem[],
  projectDir: string,
  mergedComponents: MDXComponents,
  tsxLayoutModuleCache: LayoutComponentCache,
  adapter: RuntimeAdapter,
  layoutDataMap?: Map<string, Record<string, unknown>>,
  projectId?: string,
  projectSlug?: string,
  contentSourceId?: string,
): Promise<BundledReact.ReactElement> {
  let element = pageElement;

  logger.debug("[applyLayoutsESM] START", {
    projectSlug,
    nestedLayoutsCount: nestedLayouts.length,
    hasLayoutBundle: !!layoutBundle,
  });

  for (let i = nestedLayouts.length - 1; i >= 0; i--) {
    const item = nestedLayouts[i];
    if (!item) continue;

    logger.debug("[applyLayoutsESM] Processing layout", {
      projectSlug,
      index: i,
      kind: item.kind,
      componentPath: item.componentPath,
      hasBundleCode: !!item.bundle?.compiledCode,
    });

    const layoutStart = performance.now();

    try {
      if (item.kind === "mdx" && item.bundle?.compiledCode) {
        logger.debug("[applyLayoutsESM] Calling applyMDXLayout START", { projectSlug, index: i });
        element = await applyMDXLayout(
          element,
          item.bundle,
          projectDir,
          mergedComponents,
          adapter,
          projectId,
          projectSlug,
          contentSourceId,
        );
        logger.debug("[applyLayoutsESM] applyMDXLayout DONE", {
          projectSlug,
          index: i,
          duration: `${(performance.now() - layoutStart).toFixed(2)}ms`,
        });
        continue;
      }

      if (item.kind === "tsx") {
        logger.debug("[applyLayoutsESM] Calling applyTSXLayout START", { projectSlug, index: i });
        const props = item.componentPath ? layoutDataMap?.get(item.componentPath) : undefined;
        element = await applyTSXLayout(
          element,
          item,
          tsxLayoutModuleCache,
          projectDir,
          adapter,
          props,
          projectId,
          contentSourceId,
        );
        logger.debug("[applyLayoutsESM] applyTSXLayout DONE", {
          projectSlug,
          index: i,
          duration: `${(performance.now() - layoutStart).toFixed(2)}ms`,
        });
      }
    } catch (e) {
      logger.error("Failed to apply nested layout:", e);
      throw e;
    }
  }

  logger.debug("[applyLayoutsESM] All nested layouts applied", { projectSlug });

  if (!layoutBundle) {
    logger.debug("[applyLayoutsESM] No layoutBundle to apply");
    return element;
  }

  logger.debug("[applyLayoutsESM] Applying named layoutBundle (frontmatter layout)");
  element = await applyMDXLayout(
    element,
    layoutBundle,
    projectDir,
    mergedComponents,
    adapter,
    projectId,
    projectSlug,
    contentSourceId,
  );
  logger.debug("[applyLayoutsESM] Named layoutBundle applied successfully");

  return element;
}

export async function applyLayoutsFunctionBody(
  pageElement: BundledReact.ReactElement,
  layoutBundle: MdxBundle | undefined,
  nestedLayouts: LayoutItem[],
  mergedComponents: MDXComponents,
  tsxLayoutModuleCache: LayoutComponentCache,
  projectDir: string,
  adapter: RuntimeAdapter,
  layoutDataMap?: Map<string, Record<string, unknown>>,
  projectId?: string,
  _projectSlug?: string,
  contentSourceId?: string,
): Promise<BundledReact.ReactElement> {
  const React = await getProjectReact();
  let element = pageElement;

  logger.debug("Using function-body wrapping for layouts");
  logger.debug("Nested layouts to apply:", {
    count: nestedLayouts.length,
    layouts: nestedLayouts.map((l) => ({
      kind: l.kind,
      path: l.componentPath || l.bundle?.compiledCode?.substring(0, 50),
    })),
  });

  for (let i = nestedLayouts.length - 1; i >= 0; i--) {
    const item = nestedLayouts[i];
    if (!item) continue;

    logger.debug(`Applying layout ${i}:`, {
      kind: item.kind,
      path: item.componentPath,
    });

    if (item.kind === "mdx" && item.bundle?.compiledCode) {
      element = mdxRenderer.render(item.bundle.compiledCode, {
        components: mergedComponents,
        extractLayout: true,
        children: element,
      });
      continue;
    }

    if (item.kind !== "tsx" || !item.componentPath) continue;

    try {
      const LayoutComponent = await loadTSXComponent(
        item.componentPath,
        projectDir,
        tsxLayoutModuleCache,
        adapter,
        projectId,
        contentSourceId,
      );

      const child = ensureValidChild(element, React);

      logger.debug("Applying TSX layout:", {
        layoutName: LayoutComponent.name || "Anonymous",
        childType: React.isValidElement(child) ? getElementTypeName(child) : typeof child,
      });

      const props = layoutDataMap?.get(item.componentPath);
      element = React.createElement(LayoutComponent, props, child) as BundledReact.ReactElement;

      logger.debug("After TSX layout applied:", {
        pageElementType: React.isValidElement(element)
          ? getElementTypeName(element)
          : typeof element,
      });
    } catch (e) {
      logger.error("Failed to compile/import TSX layout (non-ESM path)", e);
      throw e;
    }
  }

  if (layoutBundle?.compiledCode) {
    element = mdxRenderer.render(layoutBundle.compiledCode, {
      components: mergedComponents,
      extractLayout: true,
      children: element,
    });
  }

  return element;
}
