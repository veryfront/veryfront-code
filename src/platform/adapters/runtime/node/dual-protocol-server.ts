import { Server as TcpServer, type Socket } from "node:net";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  createServer as createHttp2Server,
  type Http2ServerRequest,
  type Http2ServerResponse,
  type ServerHttp2Session,
} from "node:http2";

const apply = Reflect.apply;
const setAdd = Set.prototype.add;
const setDelete = Set.prototype.delete;
const setForEach = Set.prototype.forEach;

const HTTP2_PREFACE = new TextEncoder().encode("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");

/** Public Node transports sharing Deno's existing cleartext HTTP/1 + h2c port. */
export class DualProtocolServer extends TcpServer {
  private readonly sockets = new Set<Socket>();
  private readonly sessions = new Set<ServerHttp2Session>();
  private readonly http1;
  private readonly http2;

  constructor(
    listener: (
      request: IncomingMessage | Http2ServerRequest,
      response: ServerResponse | Http2ServerResponse,
    ) => void,
    private readonly prefaceTimeoutMs = 10_000,
  ) {
    super();
    this.http1 = createHttpServer(listener);
    this.http2 = createHttp2Server(listener);
    this.http1.on(
      "upgrade",
      (request, socket, head) => this.emit("upgrade", request, socket, head),
    );
    this.http1.on("error", (error) => this.emit("error", error));
    this.http2.on("error", (error) => this.emit("error", error));
    this.http2.on("session", (session) => {
      apply(setAdd, this.sessions, [session]);
      session.on("error", () => session.destroy());
      session.once("close", () => apply(setDelete, this.sessions, [session]));
    });
    this.on("connection", (socket) => this.route(socket));
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
      (matches ? this.http2 : this.http1).emit("connection", socket);
      socket.resume();
    };
    socket.on("data", data);
    socket.once("end", cleanup);
    socket.once("close", cleanup);
    socket.once("error", cleanup);
  }

  closeAllConnections(): void {
    apply(setForEach, this.sessions, [(session: ServerHttp2Session) => session.destroy()]);
    this.http1.closeAllConnections();
    apply(setForEach, this.sockets, [(socket: Socket) => socket.destroy()]);
  }
}
