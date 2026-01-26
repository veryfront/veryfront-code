export type HMRMessageType = "connected" | "update" | "reload";
export interface HMRMessage {
    type: HMRMessageType;
}
export interface HMRConnectedMessage extends HMRMessage {
    type: "connected";
    reactRefresh?: boolean;
}
export interface HMRUpdateMessage extends HMRMessage {
    type: "update";
    path: string;
    timestamp?: number;
}
export interface HMRReloadMessage extends HMRMessage {
    type: "reload";
}
//# sourceMappingURL=hmr.d.ts.map