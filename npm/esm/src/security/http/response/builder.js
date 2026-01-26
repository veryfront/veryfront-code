import * as dntShim from "../../../../_dnt.shims.js";
import * as fluentMethods from "./fluent-methods.js";
import * as responseMethods from "./response-methods.js";
import * as staticHelpers from "./static-helpers.js";
import { generateNonce } from "./security-handler.js";
export class ResponseBuilder {
    headers;
    status;
    securityConfig;
    isDev;
    nonce;
    cspUserHeader;
    adapter;
    isVeryfrontDomain;
    constructor(config) {
        this.headers = new dntShim.Headers();
        this.status = 200;
        this.securityConfig = config?.securityConfig ?? null;
        this.isDev = config?.isDev ?? false;
        this.nonce = config?.nonce ?? generateNonce();
        this.cspUserHeader = config?.cspUserHeader ?? null;
        this.adapter = config?.adapter;
        this.isVeryfrontDomain = config?.isVeryfrontDomain ?? false;
    }
    withCORS = fluentMethods.withCORS;
    withCORSAsync = fluentMethods.withCORSAsync;
    withSecurity = fluentMethods.withSecurity;
    withCache = fluentMethods.withCache;
    withETag = fluentMethods.withETag;
    withHeaders = fluentMethods.withHeaders;
    withStatus = fluentMethods.withStatus;
    withAllow = fluentMethods.withAllow;
    withClientHints = fluentMethods.withClientHints;
    json = responseMethods.json;
    text = responseMethods.text;
    html = responseMethods.html;
    javascript = responseMethods.javascript;
    withContentType = responseMethods.withContentType;
    build = responseMethods.build;
    notModified = responseMethods.notModified;
    static error = staticHelpers.error;
    static json = staticHelpers.json;
    static html = staticHelpers.html;
    static preflight = staticHelpers.preflight;
    static stream = staticHelpers.stream;
}
staticHelpers.setResponseBuilderClass(ResponseBuilder);
export function createResponseBuilder(config) {
    return new ResponseBuilder(config);
}
