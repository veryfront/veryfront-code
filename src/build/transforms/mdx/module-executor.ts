import React, { Fragment } from "react";
import { jsxDEV as jsxRuntimeJsxDEV } from "react/jsx-dev-runtime";
import { jsx as jsxRuntimeJsx, jsxs as jsxRuntimeJsxs } from "react/jsx-runtime";
import type { MDXComponents, MDXExecutionContext, MDXModule, MDXModuleFactory } from "./types.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

export function executeModule(
  factory: MDXModuleFactory | string,
  context: MDXExecutionContext,
): MDXModule {
  const { components, globals } = context;

  if (typeof factory === "string") {
    throw toError(createError({
      type: "build",
      message: "[SECURITY] String-based module execution is disabled. " +
        "Use async ESM loader: await loadCompiledMDXModule(code, cacheKey) instead. " +
        "This prevents code injection vulnerabilities.",
    }));
  }

  const module = factory(
    React,
    Fragment,
    jsxRuntimeJsx as (...args: unknown[]) => unknown,
    jsxRuntimeJsxs as (...args: unknown[]) => unknown,
    jsxRuntimeJsxDEV as (...args: unknown[]) => unknown,
    components,
    globals,
  );

  return module;
}

export function selectComponent(
  module: MDXModule,
  extractLayout: boolean,
): React.ComponentType<{ components?: MDXComponents; children?: React.ReactNode }> | null {
  if (typeof (module as unknown) === "function") {
    return module as unknown as React.ComponentType<
      { components?: MDXComponents; children?: React.ReactNode }
    >;
  }

  if (extractLayout) {
    return (
      module.MDXLayout || // This is what function-body format exports
      module.MainLayout ||
      module.default ||
      module.MDXContent ||
      module._createMdxContent ||
      null
    );
  }
  return (
    module.MDXContent ||
    module._createMdxContent ||
    module.MDXWrapper ||
    module.default ||
    module.MainLayout ||
    module.MDXLayout ||
    null
  );
}
