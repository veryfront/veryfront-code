import { createError, toError } from "../../../errors/veryfront-error.js";
export function parseVersion(versionString) {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(versionString);
    if (!match) {
        throw toError(createError({
            type: "config",
            message: `Invalid React version format: ${versionString}`,
        }));
    }
    const major = match[1];
    const minor = match[2];
    const patch = match[3];
    return {
        major: parseInt(major, 10),
        minor: parseInt(minor, 10),
        patch: parseInt(patch, 10),
    };
}
export function isReact17(major) {
    return major === 17;
}
export function isReact18(major) {
    return major === 18;
}
export function isReact19(major, version) {
    return major === 19 || (major === 18 && version.includes("rc"));
}
