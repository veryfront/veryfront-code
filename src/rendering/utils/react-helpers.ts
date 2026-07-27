import type * as React from "react";
import type { MDXComponents } from "#veryfront/types";
import {
  getOwnStringKeys,
  isReactElement,
  snapshotOwnProperty,
} from "../element-validator/primitive-checks.ts";

export function normalizeChild(child: React.ReactNode): React.ReactNode {
  if (
    !child ||
    typeof child !== "object" ||
    Array.isArray(child) ||
    isReactElement(child)
  ) {
    return child;
  }

  const keys = getOwnStringKeys(child);
  if (keys === null) return child;

  let onlyEnumerableKey: string | undefined;
  for (const key of keys) {
    const property = snapshotOwnProperty(child, key);
    if (
      property.kind === "missing" ||
      property.kind === "unreadable"
    ) {
      return child;
    }
    if (!property.enumerable) continue;
    if (onlyEnumerableKey !== undefined) return child;
    onlyEnumerableKey = key;
  }
  if (onlyEnumerableKey !== "children") return child;

  const children = snapshotOwnProperty(child, "children");
  return children.kind === "data" ? children.value as React.ReactNode : child;
}

export function createDefaultMDXComponents(): MDXComponents {
  return {};
}
