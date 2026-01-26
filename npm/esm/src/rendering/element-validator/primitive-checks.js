import * as React from "react";
export function isValidPrimitive(value) {
    return (value === null ||
        value === undefined ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean");
}
export function hasReactSymbol(obj) {
    const symbolValue = obj.$$typeof;
    return ("$$typeof" in obj &&
        (typeof symbolValue === "symbol" || typeof symbolValue === "number"));
}
const REACT_SYMBOL_PREFIXES = [
    "react.element",
    "react.fragment",
    "react.portal",
    "react.forward_ref",
    "react.memo",
    "react.lazy",
    "react.suspense",
    "react.context",
];
export function isReactElement(value) {
    return React.isValidElement(value) || looksLikeReactElement(value);
}
export function looksLikeReactElement(value) {
    if (value == null || typeof value !== "object") {
        return false;
    }
    const obj = value;
    const typeofSymbol = obj.$$typeof;
    if (typeof typeofSymbol !== "symbol" && typeof typeofSymbol !== "number") {
        return false;
    }
    // Check for React symbol by description (handles bundled vs project React)
    if (typeof typeofSymbol === "symbol") {
        const desc = typeofSymbol.description ?? String(typeofSymbol);
        if (REACT_SYMBOL_PREFIXES.some((prefix) => desc.includes(prefix))) {
            return true;
        }
    }
    // Fallback: check structural properties that all React elements have
    return "type" in obj && "props" in obj && "key" in obj;
}
export function getElementTypeName(element) {
    const { type } = element;
    if (typeof type === "function") {
        return type.name || type.displayName || "<Anonymous>";
    }
    return String(type);
}
export function getObjectKeys(obj) {
    if (obj == null || typeof obj !== "object") {
        return [];
    }
    return Object.keys(obj).slice(0, 15);
}
export function getObjectSample(obj) {
    try {
        return JSON.stringify(obj, null, 2).slice(0, 500);
    }
    catch {
        return "[Unable to stringify]";
    }
}
export function getElementDebugInfo(child) {
    const internal = child;
    return {
        type: typeof internal.type === "function"
            ? internal.type.name || "AnonymousFunction"
            : String(internal.type),
        hasSymbol: child != null && typeof child === "object" && "$typeof" in child,
        symbolValue: internal.$typeof,
        typeValue: internal.type,
    };
}
