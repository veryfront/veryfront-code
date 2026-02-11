/**
 * Bridges OpenTelemetry trace context into the logger.
 *
 * Import this module as a side-effect after OTLP initialization to
 * automatically populate `traceId` and `spanId` in every JSON log entry
 * when an OTel span is active.
 *
 * @module
 */

import { getTraceContext } from "#veryfront/observability/tracing/otlp-setup.ts";
import { __registerTraceContextGetter } from "./logger.ts";

__registerTraceContextGetter(getTraceContext);
