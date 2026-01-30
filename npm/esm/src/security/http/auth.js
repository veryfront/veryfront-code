import * as dntShim from "../../../_dnt.shims.js";
import { BaseHandler } from "./base-handler.js";
import { createError, toError } from "../../errors/veryfront-error.js";
import { constantTimeEqual } from "../utils/constant-time.js";
function encodeBase64(value) {
    if (typeof globalThis.btoa === "function") {
        try {
            return globalThis.btoa(value);
        }
        catch {
            // Fallback for non-Latin1 strings
            const bytes = new TextEncoder().encode(value);
            let binary = "";
            for (const byte of bytes)
                binary += String.fromCharCode(byte);
            return globalThis.btoa(binary);
        }
    }
    const bufferCtor = dntShim.dntGlobalThis.Buffer;
    if (bufferCtor)
        return bufferCtor.from(value, "utf8").toString("base64");
    throw toError(createError({
        type: "not_supported",
        message: "Base64 encoding is not supported in this runtime",
        feature: "Base64 encoding",
    }));
}
export class AuthHandler extends BaseHandler {
    metadata = {
        name: "AuthHandler",
        priority: 0, // CRITICAL priority - runs first
        patterns: [], // Checks all requests
    };
    basicUser = null;
    basicPass = null;
    basicRealm = "Secure Area";
    bearerToken = null;
    handle(req, ctx) {
        this.loadAuthConfig(ctx);
        if (req.method.toUpperCase() === "OPTIONS")
            return Promise.resolve(this.continue());
        if (this.shouldUseBasic()) {
            const result = this.checkBasicAuth(req);
            if (result)
                return Promise.resolve(result);
        }
        if (this.shouldUseBearer()) {
            const result = this.checkBearerAuth(req);
            if (result)
                return Promise.resolve(result);
        }
        return Promise.resolve(this.continue());
    }
    loadAuthConfig(ctx) {
        // Reset per-request auth state to avoid leaking config across requests.
        this.basicUser = null;
        this.basicPass = null;
        this.basicRealm = "Secure Area";
        this.bearerToken = null;
        const authConfig = ctx.securityConfig?.auth;
        if (authConfig?.basic) {
            this.basicUser = authConfig.basic.username;
            this.basicPass = authConfig.basic.password;
            this.basicRealm = authConfig.basic.realm || "Secure Area";
            return;
        }
        if (authConfig?.bearer) {
            this.bearerToken = authConfig.bearer.token;
            return;
        }
        const isTestEnv = dntShim.dntGlobalThis.__vfTestEnv === true;
        if (isTestEnv)
            return;
        this.basicUser = ctx.adapter.env.get("VERYFRONT_BASIC_USER") || "";
        this.basicPass = ctx.adapter.env.get("VERYFRONT_BASIC_PASS") || "";
        this.bearerToken = ctx.adapter.env.get("VERYFRONT_BEARER_TOKEN") || "";
    }
    shouldUseBasic() {
        return Boolean(this.basicUser && this.basicPass);
    }
    shouldUseBearer() {
        return Boolean(this.bearerToken);
    }
    checkBasicAuth(req) {
        const expected = `Basic ${encodeBase64(`${this.basicUser}:${this.basicPass}`)}`;
        const auth = req.headers.get("authorization") || "";
        if (constantTimeEqual(auth, expected))
            return null;
        return this.respond(new dntShim.Response("Unauthorized", {
            status: 401,
            headers: { "WWW-Authenticate": `Basic realm="${this.basicRealm}"` },
        }));
    }
    checkBearerAuth(req) {
        const auth = req.headers.get("authorization") || "";
        if (auth.startsWith("Bearer ") &&
            constantTimeEqual(auth.slice(7), this.bearerToken ?? "")) {
            return null;
        }
        return this.respond(new dntShim.Response("Unauthorized", { status: 401 }));
    }
}
