import { rendererLogger as logger } from "#veryfront/utils";
import type { MDXComponentProps } from "../../module-loader/types.ts";
import * as React from "react";
import { runtime } from "#veryfront/platform/adapters/detect.ts";

export function extractComponentImports(moduleCode: string): Map<string, string> {
  const importRegex = /import\s+(\w+)\s+from\s+["']([^"']+)["'];?\s*/gm;
  const componentImports = new Map<string, string>();

  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(moduleCode)) !== null) {
    const componentName = match[1];
    const importPath = match[2];

    if (!componentName || !importPath) continue;

    if (
      !importPath.startsWith("../components/") &&
      !importPath.startsWith("./components/")
    ) {
      continue;
    }

    const pathComponentName = importPath.split("/").pop()?.replace(/\.(tsx|jsx|ts|js)$/, "") ??
      componentName;

    componentImports.set(componentName, pathComponentName);

    logger.debug(
      `Found component import: ${componentName} from ${importPath} -> ${pathComponentName}`,
    );
  }

  return componentImports;
}

export async function resolveComponents(
  componentImports: Map<string, string>,
  projectDir?: string,
  contentSourceId?: string,
): Promise<Record<string, React.ComponentType<MDXComponentProps>>> {
  const importedComponents: Record<string, React.ComponentType<MDXComponentProps>> = {};

  if (!projectDir || componentImports.size === 0) return importedComponents;
  if (!contentSourceId) {
    throw new TypeError("Component resolution requires a contentSourceId");
  }

  const [{ ComponentRegistry }, { VirtualModuleSystem }, adapter] = await Promise.all([
    import("#veryfront/rendering/ssr/component-registry.ts"),
    import("#veryfront/rendering/virtual-module-system.ts"),
    runtime.get(),
  ]);

  const virtualModules = new VirtualModuleSystem("/_veryfront/modules", adapter);
  const registry = new ComponentRegistry({
    adapter,
    contentSourceId,
    projectDir,
    virtualModules,
  });
  await registry.loadFromDirectory(`${projectDir}/components`);

  const allComponents = registry.getAll();
  for (const [importedName, componentName] of componentImports) {
    const component = allComponents[componentName];
    if (!component) {
      throw new Error(
        `Component ${componentName} was not found for import ${importedName}`,
      );
    }

    importedComponents[importedName] = component;
    logger.debug(`Mapped component ${importedName} to ${componentName}`);
  }

  return importedComponents;
}
