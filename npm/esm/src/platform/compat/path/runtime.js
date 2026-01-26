import * as dntShim from "../../../../_dnt.shims.js";
const globalProcess = dntShim.dntGlobalThis.process;
const hasNodeApis = !!globalProcess?.versions?.node || "Bun" in dntShim.dntGlobalThis;
export const isDeno = typeof dntShim.Deno !== "undefined";
let nodePath = null;
if (hasNodeApis) {
    try {
        const nodeRequire = typeof require !== "undefined" ? require : null;
        if (nodeRequire)
            nodePath = nodeRequire("node:path");
    }
    catch {
        // ignore
    }
}
export { nodePath };
export const sep = nodePath?.sep ?? "/";
export const delimiter = nodePath?.delimiter ?? ":";
export const hasNodePath = nodePath !== null;
