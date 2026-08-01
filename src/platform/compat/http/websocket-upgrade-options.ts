import { INVALID_ARGUMENT, NOT_SUPPORTED } from "#veryfront/errors/error-registry/general.ts";

const HTTP_TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const MANAGED_WEBSOCKET_HEADERS = new Set([
  "connection",
  "sec-websocket-accept",
  "sec-websocket-extensions",
  "sec-websocket-protocol",
  "upgrade",
]);

export interface PortableWebSocketUpgradeOptions {
  readonly protocol?: string;
  readonly headers?: Headers | Record<string, string>;
  readonly idleTimeout?: number;
}

export interface PortableWebSocketUpgradeConfig {
  readonly platform: string;
  readonly runtimeName: string;
  readonly supportsNonzeroIdleTimeout?: boolean;
  readonly unsupportedIdleTimeoutDetail?: string;
  readonly supportsResponseHeaders?: boolean;
  readonly unsupportedResponseHeadersDetail?: string;
}

function invalidArgument(
  config: PortableWebSocketUpgradeConfig,
  detail: string,
  context: Record<string, unknown> = {},
  cause?: unknown,
): Error {
  return INVALID_ARGUMENT.create({
    detail,
    cause,
    context: {
      platform: config.platform,
      operation: "upgradeWebSocket",
      ...context,
    },
  });
}

function parseOfferedProtocols(
  request: Request,
  config: PortableWebSocketUpgradeConfig,
): ReadonlySet<string> {
  const value = request.headers.get("sec-websocket-protocol");
  if (value === null) return new Set();

  const protocols = new Set<string>();
  for (const part of value.split(",")) {
    const protocol = part.trim();
    if (!HTTP_TOKEN_PATTERN.test(protocol) || protocols.has(protocol)) {
      throw invalidArgument(
        config,
        `${config.runtimeName} WebSocket request has an invalid Sec-WebSocket-Protocol header`,
      );
    }
    protocols.add(protocol);
  }
  return protocols;
}

/**
 * Validate the portable portion of a server-side WebSocket upgrade contract.
 *
 * Native transports remain responsible for the RFC 6455 handshake itself.
 * This helper owns the behavior shared by runtimes: fail-closed request
 * detection, application header isolation, explicit subprotocol selection,
 * and deterministic idle-timeout validation.
 */
export function resolvePortableWebSocketUpgradeHeaders(
  request: Request,
  options: PortableWebSocketUpgradeOptions = {},
  config: PortableWebSocketUpgradeConfig,
): Headers {
  if (request.headers.get("upgrade")?.trim().toLowerCase() !== "websocket") {
    throw invalidArgument(
      config,
      `${config.runtimeName} WebSocket upgrade requires an Upgrade: websocket request`,
    );
  }

  if (
    options.idleTimeout !== undefined &&
    (!Number.isFinite(options.idleTimeout) || options.idleTimeout < 0)
  ) {
    throw invalidArgument(
      config,
      `${config.runtimeName} WebSocket idleTimeout must be a non-negative finite number`,
    );
  }
  if (
    options.idleTimeout !== undefined &&
    options.idleTimeout !== 0 &&
    config.supportsNonzeroIdleTimeout !== true
  ) {
    throw NOT_SUPPORTED.create({
      detail: config.unsupportedIdleTimeoutDetail ??
        `${config.runtimeName} does not support per-connection WebSocket idle timeouts`,
      context: {
        platform: config.platform,
        operation: "upgradeWebSocket",
      },
    });
  }

  let headers: Headers;
  try {
    headers = new Headers(options.headers);
  } catch (cause) {
    throw invalidArgument(
      config,
      `${config.runtimeName} WebSocket response headers are invalid`,
      {},
      cause,
    );
  }
  for (const name of MANAGED_WEBSOCKET_HEADERS) {
    if (headers.has(name)) {
      throw invalidArgument(
        config,
        `${config.runtimeName} manages the ${name} WebSocket handshake header`,
        { header: name },
      );
    }
  }
  if (
    config.supportsResponseHeaders === false &&
    !headers.keys().next().done
  ) {
    throw NOT_SUPPORTED.create({
      detail: config.unsupportedResponseHeadersDetail ??
        `${config.runtimeName} does not support custom WebSocket response headers`,
      context: {
        platform: config.platform,
        operation: "upgradeWebSocket",
      },
    });
  }

  const offeredProtocols = parseOfferedProtocols(request, config);
  const protocol = options.protocol;
  if (protocol !== undefined) {
    if (!HTTP_TOKEN_PATTERN.test(protocol)) {
      throw invalidArgument(
        config,
        `${config.runtimeName} WebSocket protocol must be a valid HTTP token`,
      );
    }
    if (!offeredProtocols.has(protocol)) {
      throw invalidArgument(
        config,
        `${config.runtimeName} WebSocket protocol was not offered by the client`,
      );
    }
    headers.set("Sec-WebSocket-Protocol", protocol);
  }

  return headers;
}
