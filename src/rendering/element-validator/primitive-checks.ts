
import * as React from "react";

export function isValidPrimitive(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

export function hasReactSymbol(obj: Record<string, unknown>): boolean {
  return "$$typeof" in obj &&
    (typeof obj.$$typeof === "symbol" || typeof obj.$$typeof === "number");
}

export function looksLikeReactElement(value: unknown): boolean {
  if (value === null || value === undefined || typeof value !== "object") {
    return false;
  }

  const obj = value as Record<string, unknown>;

  if (!("$$typeof" in obj)) {
    return false;
  }

  const typeofSymbol = obj.$$typeof;
  if (typeof typeofSymbol !== "symbol" && typeof typeofSymbol !== "number") {
    return false;
  }

  if (typeof typeofSymbol === "symbol") {
    const desc = typeofSymbol.description || String(typeofSymbol);
    if (
      desc.includes("react.element") || desc.includes("react.fragment") ||
      desc.includes("react.portal") || desc.includes("react.forward_ref") ||
      desc.includes("react.memo") || desc.includes("react.lazy") ||
      desc.includes("react.suspense") || desc.includes("react.context")
    ) {
      return true;
    }
  }

  return "type" in obj && "props" in obj && "key" in obj;
}

export function getElementTypeName(element: React.ReactElement): string {
  const type = element.type;

  if (typeof type === "function") {
    return (type as React.ComponentType<any>).name ||
      (type as React.ComponentType<any>).displayName || "<Anonymous>";
  }

  return String(type);
}

export function getObjectKeys(obj: unknown): string[] {
  if (!obj || typeof obj !== "object") {
    return [];
  }
  return Object.keys(obj).slice(0, 15);
}

export function getObjectSample(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2).slice(0, 500);
  } catch {
    return "[Unable to stringify]";
  }
}

interface ReactElementInternal {
  $typeof?: symbol;
  type?: unknown;
  props?: unknown;
}

export function getElementDebugInfo(child: unknown): {
  type: string;
  hasSymbol: boolean;
  symbolValue?: symbol;
  typeValue?: unknown;
} {
  const internal = child as ReactElementInternal;

  return {
    type: typeof (internal.type) === "function"
      ? (internal.type as { name?: string }).name || "AnonymousFunction"
      : String(internal.type),
    hasSymbol: "$typeof" in (child as object),
    symbolValue: internal.$typeof,
    typeValue: internal.type,
  };
}
