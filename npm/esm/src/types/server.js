export var HandlerPriority;
(function (HandlerPriority) {
    HandlerPriority[HandlerPriority["CRITICAL"] = 0] = "CRITICAL";
    HandlerPriority[HandlerPriority["HIGH"] = 100] = "HIGH";
    HandlerPriority[HandlerPriority["MEDIUM"] = 500] = "MEDIUM";
    HandlerPriority[HandlerPriority["LOW"] = 1000] = "LOW";
    HandlerPriority[HandlerPriority["FALLBACK"] = 10000] = "FALLBACK";
})(HandlerPriority || (HandlerPriority = {}));
