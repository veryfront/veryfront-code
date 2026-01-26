import { validateNodeId } from "./validation.js";
/** Create a wait-for-approval node. Pauses until human approves/rejects. */
export function waitForApproval(id, options = {}) {
    validateNodeId(id);
    return {
        id,
        config: {
            type: "wait",
            waitType: "approval",
            message: options.message ?? "Approval required",
            payload: options.payload,
            approvers: options.approvers,
            timeout: options.timeout,
            // Always checkpoint before waiting
            checkpoint: true,
            retry: options.retry,
            skip: options.skip,
        },
    };
}
/** Create a wait-for-event node. Pauses until external event is received. */
export function waitForEvent(id, options) {
    validateNodeId(id);
    if (!options.eventName) {
        throw new Error(`waitForEvent "${id}" must specify an eventName`);
    }
    return {
        id,
        config: {
            type: "wait",
            waitType: "event",
            eventName: options.eventName,
            timeout: options.timeout,
            checkpoint: true,
            retry: options.retry,
            skip: options.skip,
        },
    };
}
/** Create a simple delay/sleep node. */
export function delay(id, duration) {
    validateNodeId(id);
    return {
        id,
        config: {
            type: "wait",
            waitType: "event",
            eventName: "__delay__",
            timeout: duration,
            checkpoint: false,
        },
    };
}
