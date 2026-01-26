export declare const HMR_MAX_MESSAGE_SIZE_BYTES: number;
export declare const HMR_MAX_MESSAGES_PER_MINUTE = 100;
export declare const HMR_CLIENT_RELOAD_DELAY_MS = 3000;
export declare const HMR_PORT_OFFSET = 1;
export declare const HMR_RATE_LIMIT_WINDOW_MS = 60000;
export declare const HMR_CLOSE_NORMAL = 1000;
export declare const HMR_CLOSE_RATE_LIMIT = 1008;
export declare const HMR_CLOSE_MESSAGE_TOO_LARGE = 1009;
export declare const HMR_MESSAGE_TYPES: {
    readonly CONNECTED: "connected";
    readonly UPDATE: "update";
    readonly RELOAD: "reload";
    readonly PING: "ping";
    readonly PONG: "pong";
};
export declare function isValidHMRMessageType(type: string): type is keyof typeof HMR_MESSAGE_TYPES;
//# sourceMappingURL=hmr.d.ts.map