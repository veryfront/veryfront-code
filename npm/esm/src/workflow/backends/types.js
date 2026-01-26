export function hasQueueSupport(backend) {
    return (typeof backend.enqueue === "function" &&
        typeof backend.dequeue === "function" &&
        typeof backend.acknowledge === "function");
}
export function hasLockSupport(backend) {
    return (typeof backend.acquireLock === "function" &&
        typeof backend.releaseLock === "function");
}
export function hasEventSupport(backend) {
    return (typeof backend.publishEvent === "function" &&
        typeof backend.subscribeEvents === "function");
}
