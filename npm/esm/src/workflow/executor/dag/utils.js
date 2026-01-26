import * as dntShim from "../../../../_dnt.shims.js";
export function deriveNodeStatus(completed, waiting) {
    if (completed)
        return "completed";
    if (waiting)
        return "running";
    return "failed";
}
export function shouldCheckpoint(node) {
    return node.config.checkpoint ?? false;
}
export function sleep(ms) {
    return new Promise((resolve) => dntShim.setTimeout(resolve, ms));
}
