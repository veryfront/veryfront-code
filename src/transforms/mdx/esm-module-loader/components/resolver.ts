import { rendererLogger as logger } from "#veryfront/utils";
import { DEFAULT_DASHBOARD_PORT } from "#veryfront/utils/constants/server.ts";
import type { MDXComponentProps } from "../../module-loader/types.ts";
import * as React from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { findStaticImportFromSpans } from "../utils/source-spans.ts";
import { fileLogLabel } from "../../../shared/log-context.ts";

export function extractComponentImports(moduleCode: string): Map<string, string> {
  const componentImports = new Map<string, string>();

  const importSpans = findStaticImportFromSpans(
    moduleCode,
    (specifier) =>
      specifier.startsWith("../components/") || specifier.startsWith("./components/")
        ? specifier
        : null,
  );
  for (const importSpan of importSpans) {
    const importClause = moduleCode.slice(importSpan.statementStart, importSpan.start);
    const defaultImport = importClause.match(
      /^import\s+([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*,[\s\S]+)?\s*$/,
    );
    const componentName = defaultImport?.[1];
    if (!componentName) continue;

    const pathComponentName = importSpan.path.split("/").pop()?.replace(
      /\.(tsx|jsx|ts|js)$/,
      "",
    ) ??
      componentName;

    componentImports.set(componentName, pathComponentName);

    logger.debug("Found component import", {
      componentFile: fileLogLabel(importSpan.path),
    });
  }

  return componentImports;
}

export async function resolveComponents(
  componentImports: Map<string, string>,
  projectDir?: string,
  adapter?: RuntimeAdapter,
): Promise<Record<string, React.ComponentType<MDXComponentProps>>> {
  const importedComponents: Record<string, React.ComponentType<MDXComponentProps>> = {};

  if (!projectDir || componentImports.size === 0) return importedComponents;

  const [{ ComponentRegistry }, { VirtualModuleSystem }] = await Promise.all([
    import("#veryfront/rendering/ssr/component-registry.ts"),
    import("#veryfront/rendering/virtual-module-system.ts"),
  ]);

  const runtimeAdapter = adapter ?? await runtime.get();
  const virtualModules = new VirtualModuleSystem("/_veryfront/modules", runtimeAdapter);
  const registry = new ComponentRegistry(
    virtualModules,
    DEFAULT_DASHBOARD_PORT,
    runtimeAdapter,
  );
  await registry.loadFromDirectory(`${projectDir}/components`);

  const allComponents = registry.getAll();

  for (const [importedName, componentName] of componentImports) {
    const component = allComponents[componentName];

    if (!component) {
      throw new Error(`Imported MDX component "${componentName}" could not be resolved`);
    }

    importedComponents[importedName] = component;
    logger.debug("Mapped imported MDX component", {
      importedComponent: fileLogLabel(importedName),
      resolvedComponent: fileLogLabel(componentName),
    });
  }

  return importedComponents;
}
