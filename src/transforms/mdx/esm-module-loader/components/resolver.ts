import { rendererLogger as logger } from "#veryfront/utils";
import { DEFAULT_DASHBOARD_PORT } from "#veryfront/utils/constants/server.ts";
import type { MDXComponentProps } from "../../module-loader/types.ts";
import * as React from "react";

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
): Promise<Record<string, React.ComponentType<MDXComponentProps>>> {
  const importedComponents: Record<string, React.ComponentType<MDXComponentProps>> = {};

  if (!projectDir || componentImports.size === 0) return importedComponents;

  try {
    const [{ ComponentRegistry }, { VirtualModuleSystem }] = await Promise.all([
      import("#veryfront/rendering/ssr/component-registry.ts"),
      import("#veryfront/rendering/virtual-module-system.ts"),
    ]);

    const virtualModules = new VirtualModuleSystem();
    const registry = new ComponentRegistry(virtualModules, DEFAULT_DASHBOARD_PORT);
    await registry.loadFromDirectory(`${projectDir}/components`);

    const allComponents = registry.getAll();

    for (const [importedName, componentName] of componentImports) {
      const component = allComponents[componentName];

      if (!component) {
        logger.warn(
          `Component ${componentName} not found in registry for import ${importedName}`,
        );
        continue;
      }

      importedComponents[importedName] = component;
      logger.debug(`Mapped component ${importedName} to ${componentName}`);
    }
  } catch (error) {
    logger.error("Failed to load component registry:", error);
  }

  return importedComponents;
}
