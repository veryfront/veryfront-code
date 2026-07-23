/** Discriminator values used by the Veryfront hot module reload protocol. */
export type HMRMessageType = "connected" | "update" | "reload" | "ping" | "pong";

/** Common fields carried by every hot module reload message. */
export interface HMRMessage {
  /** Message discriminator. */
  type: HMRMessageType;
}

/** Initial message sent after a hot module reload client connects. */
export interface HMRConnectedMessage extends HMRMessage {
  /** Connected-message discriminator. */
  type: "connected";
  /** Whether the server supports React Fast Refresh. */
  reactRefresh?: boolean;
}

/** Message notifying the client that one source path changed. */
export interface HMRUpdateMessage extends HMRMessage {
  /** Update-message discriminator. */
  type: "update";
  /** Project-relative path that changed. */
  path: string;
  /** Server timestamp for the update. */
  timestamp?: number;
  /** Updated stylesheet URL when the change is CSS-only. */
  styleHref?: string;
  /** Content fingerprint for the updated stylesheet. */
  styleHash?: string;
}

/** Message instructing the browser to perform a full reload. */
export interface HMRReloadMessage extends HMRMessage {
  /** Reload-message discriminator. */
  type: "reload";
  /** Server timestamp for the reload request. */
  timestamp?: number;
}

/** Heartbeat request sent over the hot module reload connection. */
export interface HMRPingMessage extends HMRMessage {
  /** Ping-message discriminator. */
  type: "ping";
  /** Server timestamp for the heartbeat. */
  timestamp?: number;
}

/** Heartbeat response sent over the hot module reload connection. */
export interface HMRPongMessage extends HMRMessage {
  /** Pong-message discriminator. */
  type: "pong";
  /** Timestamp copied from the corresponding heartbeat. */
  timestamp?: number;
}

/** Complete discriminated union for hot module reload wire messages. */
export type HMRProtocolMessage =
  | HMRConnectedMessage
  | HMRUpdateMessage
  | HMRReloadMessage
  | HMRPingMessage
  | HMRPongMessage;
