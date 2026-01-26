// Import as namespace to handle both Deno std (named export) and mri (default export)
import * as flagsModule from "mri";
// Handle both export styles: Deno std uses { parse }, mri uses default
function getParser() {
    const mod = flagsModule;
    if (typeof mod.default === "function")
        return mod.default;
    if (typeof mod.parse === "function")
        return mod.parse;
    throw new Error("flags module has no parse function");
}
const flagsParse = getParser();
function toArray(value) {
    if (!value)
        return [];
    return Array.isArray(value) ? value : [value];
}
export function parse(args, options = {}) {
    const parsed = flagsParse(args, options);
    for (const key of toArray(options.collect)) {
        if (key in parsed && !Array.isArray(parsed[key])) {
            parsed[key] = [parsed[key]];
        }
    }
    for (const key of toArray(options.negatable)) {
        const noKey = `no-${key}`;
        if (noKey in parsed) {
            parsed[key] = !parsed[noKey];
            delete parsed[noKey];
        }
    }
    return parsed;
}
