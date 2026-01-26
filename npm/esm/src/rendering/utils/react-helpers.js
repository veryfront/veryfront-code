import * as React from "react";
export const normalizeChild = (() => {
    const cache = new WeakMap();
    return (child) => {
        if (React.isValidElement(child) || !child || typeof child !== "object" || Array.isArray(child)) {
            return child;
        }
        const cached = cache.get(child);
        if (cached !== undefined) {
            return cached;
        }
        const keys = Object.keys(child);
        const result = keys.length === 1 && keys[0] === "children"
            ? child.children
            : child;
        cache.set(child, result);
        return result;
    };
})();
export function createDefaultMDXComponents() {
    return {};
}
