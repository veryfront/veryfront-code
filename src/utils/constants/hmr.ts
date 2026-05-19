import { KB_IN_BYTES } from "./http.ts";

/** Shared HMR max message size bytes value. */
export const HMR_MAX_MESSAGE_SIZE_BYTES = 1024 * KB_IN_BYTES;
/** Shared HMR max messages per minute value. */
export const HMR_MAX_MESSAGES_PER_MINUTE = 100;
/** Shared HMR client reload delay ms value. */
export const HMR_CLIENT_RELOAD_DELAY_MS = 3000;
export const HMR_PORT_OFFSET = 1;
/** Shared HMR rate limit window ms value. */
export const HMR_RATE_LIMIT_WINDOW_MS = 60000;
/** Shared HMR close normal value. */
export const HMR_CLOSE_NORMAL = 1000;
/** Shared HMR close rate limit value. */
export const HMR_CLOSE_RATE_LIMIT = 1008;
/** Shared HMR close message too large value. */
export const HMR_CLOSE_MESSAGE_TOO_LARGE = 1009;

export const HMR_MESSAGE_TYPES = {
  CONNECTED: "connected",
  UPDATE: "update",
  RELOAD: "reload",
  PING: "ping",
  PONG: "pong",
} as const;

export function isValidHMRMessageType(
  type: string,
): type is (typeof HMR_MESSAGE_TYPES)[keyof typeof HMR_MESSAGE_TYPES] {
  return (Object.values(HMR_MESSAGE_TYPES) as readonly string[]).includes(type);
}
