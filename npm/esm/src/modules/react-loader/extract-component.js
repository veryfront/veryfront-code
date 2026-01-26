import { createError, toError } from "../../errors/veryfront-error.js";
export function extractComponent(mod, filePath) {
    const moduleObj = mod;
    const firstKey = Object.keys(moduleObj)[0];
    const component = moduleObj.default ?? (firstKey ? moduleObj[firstKey] : undefined);
    if (!component) {
        throw toError(createError({
            type: "build",
            message: `No component exported from ${filePath}`,
            context: { file: filePath, phase: "transform" },
        }));
    }
    return component;
}
