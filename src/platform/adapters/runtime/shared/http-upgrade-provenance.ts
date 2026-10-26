import { INVALID_ARGUMENT } from "#veryfront/errors/error-registry/general.ts";

// Capture before authored code can replace collection methods and observe
// credential-bearing inbound requests at the transport boundary.
const apply = Reflect.apply;
const mapSet = WeakMap.prototype.set;
const mapGet = WeakMap.prototype.get;
const mapHas = WeakMap.prototype.has;
const mapDelete = WeakMap.prototype.delete;
const setAdd = WeakSet.prototype.add;
const setHas = WeakSet.prototype.has;

const requests = new WeakMap<Request, string>();
const idleTimeouts = new WeakMap<object, number>();

/** @internal Only the listener grants upgrade ownership to its exact request. */
export function recordNodeWebSocketUpgradeRequest(request: Request, id: string): void {
  apply(mapSet, requests, [request, id]);
}

/** @internal Cloning a request does not transfer its live transport. */
export function hasNodeWebSocketUpgradeRequest(request: Request): boolean {
  return apply(mapHas, requests, [request]);
}

/** @internal An upgrade grant is consumed once by the owning request. */
export function consumeNodeWebSocketUpgradeRequest(request: Request): string {
  const id = apply(mapGet, requests, [request]) as string | undefined;
  if (id === undefined) {
    throw INVALID_ARGUMENT.create({
      detail: "WebSocket upgrade requires the original request from its HTTP listener",
    });
  }
  apply(mapDelete, requests, [request]);
  return id;
}

/** @internal Response policy never travels through caller-controlled headers. */
export function recordWebSocketUpgradeIdleTimeout(response: object, seconds: number): void {
  apply(mapSet, idleTimeouts, [response, seconds]);
}

/** @internal Read the policy attached by the trusted upgrade adapter. */
export function getWebSocketUpgradeIdleTimeout(response: object): number | undefined {
  return apply(mapGet, idleTimeouts, [response]) as number | undefined;
}

/** @internal Revoke any unused grant when the listener finishes handling it. */
export function revokeNodeWebSocketUpgradeRequest(request: Request): void {
  apply(mapDelete, requests, [request]);
}

const domResponses = new WeakSet<object>();
const bufferedAmounts = new WeakMap<object, () => number>();

export function recordDenoWebSocketResponse(response: object): void {
  apply(setAdd, domResponses, [response]);
}
export function isDenoWebSocketResponse(response: object): boolean {
  return apply(setHas, domResponses, [response]);
}
export function recordWebSocketBufferedAmount(connection: object, read: () => number): void {
  apply(mapSet, bufferedAmounts, [connection, read]);
}
export function readWebSocketBufferedAmount(connection: object): number {
  const read = apply(mapGet, bufferedAmounts, [connection]) as (() => number) | undefined;
  if (!read) {
    throw new TypeError("WebSocket provider does not expose its transport buffered amount");
  }
  return read();
}
