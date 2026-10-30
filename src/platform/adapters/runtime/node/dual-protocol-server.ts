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

function isSocket(value: unknown): value is Socket {
  return apply(socketHasInstance, Socket, [value]);
}

const HTTP2_PREFACE = new TextEncoder().encode("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");

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
      socket.off("end", cleanup);
      socket.off("close", cleanup);
      socket.off("error", cleanup);
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
      else apply(emitHttpServerEvent, this, ["connection", socket]);
      socket.resume();
    };
    socket.on("data", data);
    socket.once("end", cleanup);
    socket.once("close", cleanup);
    socket.once("error", cleanup);
  }

  override closeAllConnections(): void {
    apply(setForEach, this.sessions, [(session: ServerHttp2Session) => session.destroy()]);
    super.closeAllConnections();
    apply(setForEach, this.sockets, [(socket: Socket) => socket.destroy()]);
  }
}
