import { createFileSystem } from "../../../platform/compat/fs.js";
import { createError, toError } from "../../../errors/veryfront-error.js";
const fs = createFileSystem();
export function validateCompileParams(filePath, content, options) {
    if (typeof filePath !== "string" || !filePath) {
        throw new TypeError("filePath must be a non-empty string");
    }
    if (typeof content !== "string") {
        throw new TypeError("content must be a string");
    }
    if (typeof options !== "object" || !options) {
        throw new TypeError("options must be an object");
    }
    if (typeof options.projectDir !== "string" || !options.projectDir) {
        throw new TypeError("options.projectDir must be a non-empty string");
    }
    if (typeof options.outputDir !== "string" || !options.outputDir) {
        throw new TypeError("options.outputDir must be a non-empty string");
    }
    if (options.mode !== "development" && options.mode !== "production") {
        throw new TypeError('options.mode must be either "development" or "production"');
    }
}
export async function validateFileExists(filePath, content) {
    if (content && content.trim() !== "")
        return;
    try {
        if (await fs.exists(filePath))
            return;
    }
    catch {
        // fall through to error below
    }
    throw toError(createError({
        type: "build",
        message: `MDX file not found: ${filePath}`,
    }));
}
export async function pathExists(path) {
    try {
        return await fs.exists(path);
    }
    catch {
        return false;
    }
}
