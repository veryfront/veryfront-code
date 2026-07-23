import {
  HMR_CLOSE_MESSAGE_TOO_LARGE,
  HMR_CLOSE_RATE_LIMIT,
  HMR_MAX_MESSAGE_SIZE_BYTES,
} from "#veryfront/utils";

const textEncoder = new TextEncoder();
const HMR_CLOSE_CONNECTION_FAILED = 1011;

export type HmrClientMessageSocket = {
  send(message: string): void;
  close(code?: number, reason?: string): void;
};

type HmrClientRateLimiter<TSocket> = {
  check(socket: TSocket): boolean;
};

export function getHmrWebSocketMessageSize(data: unknown): number {
  if (typeof data === "string") return textEncoder.encode(data).byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (data instanceof Blob) return data.size;
  return Number.POSITIVE_INFINITY;
}

export function handleHmrClientMessage<TSocket extends HmrClientMessageSocket>(
  input: {
    socket: TSocket;
    data: unknown;
    rateLimiter: HmrClientRateLimiter<TSocket>;
    onActivity?: () => void;
  },
): boolean {
  const messageSize = getHmrWebSocketMessageSize(input.data);
  if (messageSize > HMR_MAX_MESSAGE_SIZE_BYTES) {
    try {
      input.socket.close(HMR_CLOSE_MESSAGE_TOO_LARGE, "Message too large");
    } catch (_) {
      /* expected: socket may already be closed */
    }
    return false;
  }

  if (!input.rateLimiter.check(input.socket)) {
    try {
      input.socket.close(HMR_CLOSE_RATE_LIMIT, "Rate limit exceeded");
    } catch (_) {
      /* expected: socket may already be closed */
    }
    return false;
  }

  input.onActivity?.();

  if (typeof input.data !== "string") return true;

  let data: unknown;
  try {
    data = JSON.parse(input.data);
  } catch (_) {
    /* expected: ignore malformed JSON from client */
    return true;
  }

  if ((data as { type?: unknown } | null)?.type === "ping") {
    try {
      input.socket.send(JSON.stringify({ type: "pong" }));
    } catch (_) {
      try {
        input.socket.close(HMR_CLOSE_CONNECTION_FAILED, "Connection failed");
      } catch (_) {
        /* expected: socket may already be closed */
      }
      return false;
    }
  }
  return true;
}
