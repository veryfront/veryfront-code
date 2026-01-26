export function createWatcherIterator(eventQueue, setResolver, isClosed, isAborted) {
    function isDone() {
        return isClosed() || isAborted();
    }
    function doneResult() {
        return { done: true, value: undefined };
    }
    return {
        next() {
            if (isDone())
                return Promise.resolve(doneResult());
            const event = eventQueue.shift();
            if (event)
                return Promise.resolve({ done: false, value: event });
            return new Promise((resolve) => {
                if (isDone()) {
                    resolve(doneResult());
                    return;
                }
                setResolver(resolve);
            });
        },
        return() {
            return Promise.resolve(doneResult());
        },
    };
}
export function enqueueWatchEvent(event, eventQueue, getResolver, setResolver) {
    const resolver = getResolver();
    if (!resolver) {
        eventQueue.push(event);
        return;
    }
    resolver({ done: false, value: event });
    setResolver(null);
}
export function createFileWatcher(iterator, cleanup) {
    return {
        [Symbol.asyncIterator]() {
            return iterator;
        },
        close: cleanup,
    };
}
