import { rendererLogger as logger } from "../../utils/index.js";
import { createError, toError } from "../../errors/veryfront-error.js";
import { getElementTypeName, getObjectKeys, getObjectSample, hasReactSymbol, isReactElement, isValidPrimitive, } from "./primitive-checks.js";
/** Recursively inspects element tree for invalid children that would cause React Error #31 */
export function deepInspectElement(element, path, depth, options) {
    if (depth > options.maxDepth) {
        if (options.debugMode) {
            logger.debug(`[DEEP INSPECT] Max depth reached at ${path}`);
        }
        return;
    }
    if (isReactElement(element)) {
        inspectReactElement(element, path, depth, options);
        return;
    }
    if (isValidPrimitive(element)) {
        if (options.debugMode) {
            logger.debug(`[DEEP INSPECT] ✓ Valid primitive at ${path}`, {
                type: typeof element,
                depth,
            });
        }
        return;
    }
    if (Array.isArray(element)) {
        inspectArray(element, path, depth, options);
        return;
    }
    if (element && typeof element === "object") {
        handleInvalidObject(element, path, depth);
    }
}
function inspectReactElement(element, path, depth, options) {
    const elementType = getElementTypeName(element);
    if (options.debugMode) {
        logger.debug(`[DEEP INSPECT] ✓ Valid React element at ${path}`, {
            type: elementType,
            depth,
        });
    }
    const props = element.props;
    if (props && typeof props === "object") {
        inspectElementProps(props, path, depth, options);
    }
}
function inspectElementProps(props, path, depth, options) {
    for (const [key, value] of Object.entries(props)) {
        if (key === "__self" || key === "__source")
            continue;
        if (key === "children") {
            inspectChildren(value, path, depth, options);
            continue;
        }
        if (isReactElement(value)) {
            deepInspectElement(value, `${path}.props.${key}`, depth + 1, options);
            continue;
        }
        if (!Array.isArray(value))
            continue;
        for (let i = 0; i < value.length; i++) {
            const item = value[i];
            if (isReactElement(item)) {
                deepInspectElement(item, `${path}.props.${key}[${i}]`, depth + 1, options);
            }
        }
    }
}
function inspectChildren(children, path, depth, options) {
    if (Array.isArray(children)) {
        for (let i = 0; i < children.length; i++) {
            deepInspectElement(children[i], `${path}.children[${i}]`, depth + 1, options);
        }
        return;
    }
    if (children != null) {
        deepInspectElement(children, `${path}.children`, depth + 1, options);
    }
}
function inspectArray(arr, path, depth, options) {
    if (options.debugMode) {
        logger.debug(`[DEEP INSPECT] ✓ Array at ${path}`, {
            length: arr.length,
            depth,
        });
    }
    for (let i = 0; i < arr.length; i++) {
        deepInspectElement(arr[i], `${path}[${i}]`, depth + 1, options);
    }
}
function handleInvalidObject(element, path, depth) {
    const obj = element;
    const keys = getObjectKeys(element);
    if (hasReactSymbol(obj)) {
        logger.debug(`[DEEP INSPECT] ? Skipping object with React symbol at ${path}`, {
            keys,
            symbolValue: obj.$$typeof,
        });
        return;
    }
    const constructorName = element.constructor?.name;
    const errorDetails = {
        path,
        depth,
        keys,
        hasSymbol: "$$typeof" in obj,
        symbolValue: obj.$$typeof,
        type: obj.type,
        constructor: constructorName,
        sample: getObjectSample(element),
    };
    logger.error(`[DEEP INSPECT] ❌ INVALID OBJECT at ${path} - This will cause React Error #31!`, errorDetails);
    // Throw error to stop rendering and provide clear debugging info
    throw toError(createError({
        type: "config",
        message: `Invalid React child found at ${path}! ` +
            `This object cannot be rendered as a React child. ` +
            `Keys: [${keys.join(", ")}]. ` +
            `Type: ${obj.type || "unknown"}. ` +
            `Constructor: ${constructorName || "unknown"}.`,
    }));
}
