export class MetricsRecorder {
    _instruments;
    runtimeState;
    constructor(_instruments, runtimeState) {
        this._instruments = _instruments;
        this.runtimeState = runtimeState;
    }
    /** Update instruments after late initialization */
    set instruments(instruments) {
        this._instruments = instruments;
    }
    get instruments() {
        return this._instruments;
    }
    recordHttpRequest(attributes) {
        this.instruments.httpRequestCounter?.add(1, attributes);
        this.instruments.httpActiveRequests?.add(1, attributes);
        this.runtimeState.activeRequests++;
    }
    recordHttpRequestComplete(durationMs, attributes) {
        this.instruments.httpRequestDuration?.record(durationMs, attributes);
        this.instruments.httpActiveRequests?.add(-1, attributes);
        this.runtimeState.activeRequests--;
    }
    recordCacheGet(hit, attributes) {
        this.instruments.cacheGetCounter?.add(1, attributes);
        (hit ? this.instruments.cacheHitCounter : this.instruments.cacheMissCounter)?.add(1, attributes);
    }
    recordCacheSet(attributes) {
        this.instruments.cacheSetCounter?.add(1, attributes);
        this.runtimeState.cacheSize++;
    }
    recordCacheInvalidate(count, attributes) {
        this.instruments.cacheInvalidateCounter?.add(count, attributes);
        this.runtimeState.cacheSize = Math.max(0, this.runtimeState.cacheSize - count);
    }
    setCacheSize(size) {
        this.runtimeState.cacheSize = size;
    }
    recordRender(durationMs, attributes) {
        this.instruments.renderDuration?.record(durationMs, attributes);
        this.instruments.renderCounter?.add(1, attributes);
    }
    recordRenderError(attributes) {
        this.instruments.renderErrorCounter?.add(1, attributes);
    }
    recordRSCRender(durationMs, attributes) {
        this.instruments.rscRenderDuration?.record(durationMs, attributes);
    }
    recordRSCStream(durationMs, attributes) {
        this.instruments.rscStreamDuration?.record(durationMs, attributes);
    }
    recordRSCRequest(type, attributes) {
        switch (type) {
            case "manifest":
                this.instruments.rscManifestCounter?.add(1, attributes);
                return;
            case "page":
                this.instruments.rscPageCounter?.add(1, attributes);
                return;
            case "stream":
                this.instruments.rscStreamCounter?.add(1, attributes);
                return;
            case "action":
                this.instruments.rscActionCounter?.add(1, attributes);
                return;
        }
    }
    recordRSCError(attributes) {
        this.instruments.rscErrorCounter?.add(1, attributes);
    }
    recordBuild(durationMs, attributes) {
        this.instruments.buildDuration?.record(durationMs, attributes);
    }
    recordBundle(sizeKb, attributes) {
        this.instruments.bundleSizeHistogram?.record(sizeKb, attributes);
        this.instruments.bundleCounter?.add(1, attributes);
    }
    recordDataFetch(durationMs, attributes) {
        this.instruments.dataFetchDuration?.record(durationMs, attributes);
        this.instruments.dataFetchCounter?.add(1, attributes);
    }
    recordDataFetchError(attributes) {
        this.instruments.dataFetchErrorCounter?.add(1, attributes);
    }
    recordCorsRejection(attributes) {
        this.instruments.corsRejectionCounter?.add(1, attributes);
    }
    recordSecurityHeaders(attributes) {
        this.instruments.securityHeadersCounter?.add(1, attributes);
    }
}
