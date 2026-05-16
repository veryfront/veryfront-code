import {
  HMR_CLOSE_MESSAGE_TOO_LARGE,
  HMR_CLOSE_RATE_LIMIT,
  HMR_MAX_MESSAGE_SIZE_BYTES,
} from "#veryfront/utils";

export type HmrClientMessageSocket = {
  send(message: string): void;
  close(code?: number, reason?: string): void;
};

type HmrClientRateLimiter<TSocket> = {
  check(socket: TSocket): boolean;
};

export function getHmrWebSocketMessageSize(data: unknown): number {
  if (typeof data === "string") return data.length;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (data instanceof Blob) return data.size;
  return 0;
}

export function handleHmrClientMessage<TSocket extends HmrClientMessageSocket>(
  input: {
    socket: TSocket;
    data: unknown;
    rateLimiter: HmrClientRateLimiter<TSocket>;
    onActivity?: () => void;
  },
): void {
  const messageSize = getHmrWebSocketMessageSize(input.data);
  if (messageSize > HMR_MAX_MESSAGE_SIZE_BYTES) {
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
