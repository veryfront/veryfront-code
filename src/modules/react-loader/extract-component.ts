import type * as React from "react";
import { COMPONENT_ERROR } from "#veryfront/errors";

export function isReactComponent(
  value: unknown,
): value is React.ComponentType<Record<string, unknown>> {
  if (typeof value === "function") return true;
  if (typeof value !== "object" || value === null) return false;

  const marker = (value as { $$typeof?: unknown }).$$typeof;
  return typeof marker === "symbol" && Symbol.keyFor(marker)?.startsWith("react.") === true;
}

export function extractComponent(
  mod: unknown,
  filePath: string,
): React.ComponentType<Record<string, unknown>> {
  const fileName = filePath.replace(/\\/g, "/").split("/").pop() || "module";
  if (!mod || typeof mod !== "object") {
    throw COMPONENT_ERROR.create({ detail: `No component exported from ${fileName}` });
  }

  const moduleObj = mod as Record<string, unknown>;
  if (isReactComponent(moduleObj.default)) return moduleObj.default;

  for (const [name, value] of Object.entries(moduleObj)) {
    if (name !== "default" && isReactComponent(value)) return value;
  }

  throw COMPONENT_ERROR.create({ detail: `No component exported from ${fileName}` });
}
