import { HMR_RATE_LIMIT_WINDOW_MS } from "../../utils/index.js";
export class RateLimiter {
    maxMessages;
    messageCounts = new Map();
    windowMs = HMR_RATE_LIMIT_WINDOW_MS;
    constructor(maxMessages) {
        this.maxMessages = maxMessages;
    }
    check(socket) {
        const now = Date.now();
        const record = this.messageCounts.get(socket);
        if (!record || now > record.resetTime) {
            this.messageCounts.set(socket, { count: 1, resetTime: now + this.windowMs });
            return true;
        }
        if (record.count >= this.maxMessages)
            return false;
        record.count++;
        return true;
    }
    cleanup(socket) {
        this.messageCounts.delete(socket);
    }
}
