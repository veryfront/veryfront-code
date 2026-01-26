import * as dntShim from "../../../../../_dnt.shims.js";
import { createError, toError } from "../../../../errors/index.js";
import { serverLogger } from "../../../../utils/index.js";
import { registerWebSocketUpgrade } from "./http-server.js";
import * as crypto from "node:crypto";
export class NodeServerAdapter {
    upgradeWebSocket(request) {
        const key = request.headers.get("sec-websocket-key");
        const protocol = request.headers.get("sec-websocket-protocol");
        if (!key) {
            throw toError(createError({
                type: "network",
                message: "Missing Sec-WebSocket-Key header",
            }));
        }
        const socket = new NodeWebSocket();
        registerWebSocketUpgrade(key)
            .then((ws) => {
            socket._attachRealSocket(ws);
        })
            .catch((error) => {
            serverLogger.error("WebSocket upgrade failed:", error);
            socket._emitError(error);
        });
        const headers = {
            Upgrade: "websocket",
            Connection: "Upgrade",
            "Sec-WebSocket-Accept": this.generateAcceptKey(key),
        };
        if (protocol) {
            headers["Sec-WebSocket-Protocol"] = protocol;
        }
        const response = new dntShim.Response(null, {
            status: 101,
            statusText: "Switching Protocols",
            headers,
        });
        return { socket: socket, response };
    }
    generateAcceptKey(key) {
        const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
        return crypto.createHash("sha1").update(key + GUID).digest("base64");
    }
}
export class NodeWebSocket {
    ws = null;
    readyState = 0; // CONNECTING
    onopen = null;
    onclose = null;
    onerror = null;
    onmessage = null;
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    pendingMessages = [];
    _attachRealSocket(ws) {
        this.ws = ws;
        this.readyState = 1; // OPEN
        ws.on("open", () => {
            this.readyState = 1;
            this.onopen?.(new Event("open"));
        });
        ws.on("message", (data) => {
            this.onmessage?.(new MessageEvent("message", { data: data.toString() }));
        });
        ws.on("close", () => {
            this.readyState = 3;
            this.onclose?.(new CloseEvent("close"));
        });
        ws.on("error", (error) => {
            this.onerror?.(new ErrorEvent("error", { error }));
        });
        for (const msg of this.pendingMessages)
            ws.send(msg);
        this.pendingMessages = [];
        this.onopen?.(new Event("open"));
    }
    _emitError(error) {
        this.readyState = 3; // CLOSED
        this.onerror?.(new ErrorEvent("error", { error }));
    }
    send(data) {
        if (this.ws && this.readyState === 1) {
            this.ws.send(data);
            return;
        }
        if (this.readyState === 0) {
            this.pendingMessages.push(data);
            return;
        }
        throw toError(createError({
            type: "network",
            message: "WebSocket is not open",
        }));
    }
    close(code, reason) {
        this.ws?.close(code, reason);
        this.readyState = 2; // CLOSING
    }
    addEventListener(type, listener) {
        switch (type) {
            case "open":
                this.onopen = listener;
                return;
            case "close":
                this.onclose = listener;
                return;
            case "error":
                this.onerror = listener;
                return;
            case "message":
                this.onmessage = listener;
                return;
        }
    }
    removeEventListener(type, _listener) {
        switch (type) {
            case "open":
                this.onopen = null;
                return;
            case "close":
                this.onclose = null;
                return;
            case "error":
                this.onerror = null;
                return;
            case "message":
                this.onmessage = null;
                return;
        }
    }
}
