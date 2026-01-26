import { rendererLogger as logger } from "../../../utils/index.js";
import { getElementDebugInfo, getElementTypeName, isReactElement, } from "../../element-validator/primitive-checks.js";
/**
 * Returns the child unchanged if valid, or null if invalid.
 *
 * Uses cross-instance React element detection to handle elements created
 * by different React instances (bundled vs project React).
 */
export function ensureValidChild(child, 
// React parameter is kept for API compatibility but unused (uses isReactElement instead)
_React) {
    if (isReactElement(child)) {
        logger.debug("[ensureValidChild] Valid React element", {
            type: getElementTypeName(child),
            isValidElement: true,
        });
        return child;
    }
    if (child == null ||
        typeof child === "string" ||
        typeof child === "number" ||
        Array.isArray(child)) {
        logger.debug("[ensureValidChild] Valid primitive or array", { type: typeof child });
        return child;
    }
    if (typeof child === "object") {
        const debugInfo = getElementDebugInfo(child);
        logger.error("[ensureValidChild] Invalid child: object is not a React element", {
            keys: Object.keys(child).slice(0, 10),
            hasSymbol: debugInfo.hasSymbol,
            symbolValue: debugInfo.symbolValue,
            type: debugInfo.type,
        });
    }
    return null;
}
