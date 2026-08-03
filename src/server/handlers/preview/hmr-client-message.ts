import {
  HMR_CLOSE_MESSAGE_TOO_LARGE,
  HMR_CLOSE_RATE_LIMIT,
  HMR_MAX_MESSAGE_SIZE_BYTES,
} from "#veryfront/utils";
import {
  getWebSocketMessageAdmission,
  getWebSocketMessageSizeBytes,
} from "#veryfront/utils/websocket-message-size.ts";

export type HmrClientMessageSocket = {
  send(message: string): void;
  close(code?: number, reason?: string): void;
};

type HmrClientRateLimiter<TSocket> = {
  check(socket: TSocket): boolean;
};

export const getHmrWebSocketMessageSize = getWebSocketMessageSizeBytes;

export function handleHmrClientMessage<TSocket extends HmrClientMessageSocket>(
  input: {
    socket: TSocket;
    data: unknown;
    rateLimiter: HmrClientRateLimiter<TSocket>;
    onActivity?: () => void;
  },
): void {
  const admission = getWebSocketMessageAdmission(
    input.data,
    HMR_MAX_MESSAGE_SIZE_BYTES,
  );
  if (!admission.accepted) {
    try {
      input.socket.close(HMR_CLOSE_MESSAGE_TOO_LARGE, "Message too large");
    } catch (_) {
      /* expected: socket may already be closed */
    }
    return;
  }

  if (!input.rateLimiter.check(input.socket)) {
    try {
      input.socket.close(HMR_CLOSE_RATE_LIMIT, "Rate limit exceeded");
    } catch (_) {
      /* expected: socket may already be closed */
    }
    return;
  }

  input.onActivity?.();

  if (typeof input.data !== "string") return;

  try {
    const data = JSON.parse(input.data);
    if (data?.type === "ping") {
      input.socket.send(JSON.stringify({ type: "pong" }));
    }
  } catch (_) {
    /* expected: ignore malformed JSON from client */
  }
}
