import type * as React from "react";
import { createError, toError } from "../../core/errors/veryfront-error.ts";

export function extractComponent(
  mod: unknown,
  filePath: string,
): React.ComponentType<Record<string, unknown>> {
  const moduleObj = mod as Record<string, unknown>;
  const component = moduleObj.default ?? moduleObj[Object.keys(moduleObj)[0] ?? ""];

  if (!component) {
    throw toError(createError({
      type: "build",
      message: `No component exported from ${filePath}`,
      context: { file: filePath, phase: "transform" },
    }));
  }

  return component as React.ComponentType<Record<string, unknown>>;
}
