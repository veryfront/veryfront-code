import type * as React from "react";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";

export function extractComponent(
  mod: unknown,
  filePath: string,
): React.ComponentType<Record<string, unknown>> {
  if (!mod || typeof mod !== "object") {
    throw toError(
      createError({
        type: "build",
        message: `No component exported from ${filePath}`,
        context: { file: filePath, phase: "transform" },
      }),
    );
  }

  const moduleObj = mod as Record<string, unknown>;
  const firstKey = Object.keys(moduleObj)[0];
  const component = moduleObj.default ?? (firstKey ? moduleObj[firstKey] : undefined);

  if (!component) {
    throw toError(
      createError({
        type: "build",
        message: `No component exported from ${filePath}`,
        context: { file: filePath, phase: "transform" },
      }),
    );
  }

  return component as React.ComponentType<Record<string, unknown>>;
}
