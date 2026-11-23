import { Socket } from "node:net";
import { type IncomingMessage, Server as HttpServer, type ServerResponse } from "node:http";
import {
  createServer as createHttp2Server,
  type Http2ServerRequest,
  type Http2ServerResponse,
  type ServerHttp2Session,
} from "node:http2";

const apply = Reflect.apply;
const emitHttpServerEvent = HttpServer.prototype.emit;
const socketHasInstance = Function.prototype[Symbol.hasInstance];
const setAdd = Set.prototype.add;
const setDelete = Set.prototype.delete;
const setForEach = Set.prototype.forEach;
const defineProperty = Object.defineProperty;

function isSocket(value: unknown): value is Socket {
  return apply(socketHasInstance, Socket, [value]);
}

const HTTP2_PREFACE = new TextEncoder().encode("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");

type SniffedSocket = Socket & { _handle?: { _consumed?: boolean } | null };

/**
 * Keep the JS stream as the only reader of a sniffed HTTP/1 connection.
 *
 * node:http attaches its native parser straight to a stream-base handle
 * (`parser.consume(handle)`) unless that handle is already marked consumed.
 * The sniffed prefix was read through the JS stream and unshifted back into
 * it, so a native consumer would parse later bytes before that prefix. On a
 * request whose bytes span several reads, the parser then sees body bytes as a
 * request line and node:http answers a bare `400 Bad Request` before any
 * handler runs. Marking the handle keeps node:http on socket `data` events,
 * which deliver the unshifted prefix first. The h2c session already reads
 * through `data` events.
 *
 * The flag is defined as an own data property through a captured intrinsic:
 * plain assignment would run any `_consumed` setter that project code
 * installed on the shared handle prototype, exposing the raw connection.
 * Verified against the node:http bundled with Deno 2.9.7; re-check this
 * contract (and its wire regression) whenever the pinned Deno changes.
 */
function keepJsStreamReader(socket: SniffedSocket): void {
  const handle = socket._handle;
  if (!handle) return;
  defineProperty(handle, "_consumed", {
    value: true,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/**
 * Public Node transports sharing Deno's existing cleartext HTTP/1 + h2c port.
 * HTTP1 owns the real listener: Deno closes persistent responses from unbound
 * HTTP servers, even when another TCP server handed their parser a socket.
 */
export class DualProtocolServer extends HttpServer {
  private readonly sockets = new Set<Socket>();
  private readonly sessions = new Set<ServerHttp2Session>();
  private readonly http2;

  constructor(
    listener: (
      request: IncomingMessage | Http2ServerRequest,
      response: ServerResponse | Http2ServerResponse,
    ) => void,
    private readonly prefaceTimeoutMs = 10_000,
  ) {
    super(listener);
    this.http2 = createHttp2Server(listener);
    this.http2.on("error", (error) => this.emit("error", error));
    this.http2.on("session", (session) => {
      apply(setAdd, this.sessions, [session]);
      session.on("error", () => session.destroy());
      session.once("close", () => apply(setDelete, this.sessions, [session]));
    });
  }

  // Delay only connection dispatch until its public protocol parser is known.
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    if (event === "connection" && isSocket(args[0])) {
      this.route(args[0]);
      return true;
    }
    return apply(emitHttpServerEvent, this, [event, ...args]);
  }

  private route(socket: Socket): void {
    apply(setAdd, this.sockets, [socket]);
    socket.once("close", () => apply(setDelete, this.sockets, [socket]));
    // Only the fixed protocol preface is inspected, never request headers/body.
    // A stalled partial preface must not retain an unbounded live connection.
    const deadline = setTimeout(() => socket.destroy(), this.prefaceTimeoutMs);
    let buffered = new Uint8Array(0);
    const cleanup = () => {
      clearTimeout(deadline);
      socket.off("data", data);
      socket.off("end", retireIncomplete);
      socket.off("close", cleanup);
      socket.off("error", cleanup);
    };
    const retireIncomplete = () => {
      cleanup();
      // The HTTP owner allows half-open sockets, but no protocol parser owns
      // this connection yet. EOF must retire both sides rather than its timer.
      socket.destroy();
    };
    const data = (chunk: Uint8Array) => {
      socket.pause();
      const bytes = new Uint8Array(buffered.length + chunk.length);
      bytes.set(buffered);
      bytes.set(chunk, buffered.length);
      const compared = Math.min(bytes.length, HTTP2_PREFACE.length);
      let matches = true;
      for (let i = 0; i < compared; i++) {
        if (bytes[i] !== HTTP2_PREFACE[i]) {
          matches = false;
          break;
        }
      }
      if (matches && bytes.length < HTTP2_PREFACE.length) {
        buffered = bytes;
        socket.resume();
        return;
      }
      cleanup();
      socket.unshift(bytes);
      if (matches) this.http2.emit("connection", socket);
      else {
        keepJsStreamReader(socket);
        apply(emitHttpServerEvent, this, ["connection", socket]);
      }
      socket.resume();
    };
    socket.on("data", data);
    socket.once("end", retireIncomplete);
    socket.once("close", cleanup);
    socket.once("error", cleanup);
  }

  override closeAllConnections(): void {
    apply(setForEach, this.sessions, [(session: ServerHttp2Session) => session.destroy()]);
    super.closeAllConnections();
    apply(setForEach, this.sockets, [(socket: Socket) => socket.destroy()]);
  }
}
