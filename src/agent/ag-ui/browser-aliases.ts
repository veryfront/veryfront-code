import {
  type AgUiChunkEncoder,
  createAgUiChunkEncoder,
  type CreateAgUiChunkEncoderOptions,
} from "./chunk-encoder.ts";
import {
  type AgUiEncodedEvent,
  type AgUiEncoderState,
  type AgUiRunFinishedMetadata,
  buildAgUiFinalizeResponse,
  createAgUiEncoderState,
  finalizeAgUiEvents,
  mapRuntimeStreamEventToAgUiEvents,
} from "./encoder.ts";
import {
  type AgUiFinalizeTracker,
  createAgUiFinalizeTracker,
  type CreateAgUiFinalizeTrackerOptions,
} from "./finalize-tracker.ts";
import {
  type AgUiResponseEncoder,
  type AgUiResponseExecution,
  type AgUiResponseRequestState,
  createAgUiResponseStream,
  type CreateAgUiResponseStreamInput,
} from "./response-stream.ts";
import {
  createAgUiRuntimeResponse,
  type CreateAgUiRuntimeResponseInput,
} from "./runtime-response.ts";
import {
  type AgUiChatUiChunkEncoder,
  createAgUiChatUiChunkEncoder,
  type CreateAgUiChatUiChunkEncoderOptions,
  createAgUiChatUiTrackedResponse,
  type CreateAgUiChatUiTrackedResponseInput,
} from "./chat-ui-chunk-encoder.ts";
import {
  createAgUiTrackedResponse,
  type CreateAgUiTrackedResponseInput,
} from "./tracked-response.ts";
import { normalizeAgUiRuntimeRequest } from "../runtime/ag-ui-contract.ts";

/**
 * Deprecated compatibility alias for {@link AgUiRunFinishedMetadata}.
 * @deprecated Use {@link AgUiRunFinishedMetadata}.
 */
export interface AgUiBrowserRunFinishedMetadata extends AgUiRunFinishedMetadata {}

/**
 * Deprecated compatibility alias for {@link AgUiEncoderState}.
 * @deprecated Use {@link AgUiEncoderState}.
 */
export interface AgUiBrowserEncoderState extends AgUiEncoderState {}

/**
 * Deprecated compatibility alias for {@link AgUiEncodedEvent}.
 * @deprecated Use {@link AgUiEncodedEvent}.
 */
export interface AgUiBrowserEncodedEvent extends AgUiEncodedEvent {}

/**
 * Deprecated compatibility alias for {@link buildAgUiFinalizeResponse}.
 * @deprecated Use {@link buildAgUiFinalizeResponse}.
 */
export const buildAgUiBrowserFinalizeResponse = buildAgUiFinalizeResponse;

/**
 * Deprecated compatibility alias for {@link createAgUiEncoderState}.
 * @deprecated Use {@link createAgUiEncoderState}.
 */
export const createAgUiBrowserEncoderState = createAgUiEncoderState;

/**
 * Deprecated compatibility alias for {@link finalizeAgUiEvents}.
 * @deprecated Use {@link finalizeAgUiEvents}.
 */
export const finalizeAgUiBrowserEvents = finalizeAgUiEvents;

/**
 * Deprecated compatibility alias for {@link mapRuntimeStreamEventToAgUiEvents}.
 * @deprecated Use {@link mapRuntimeStreamEventToAgUiEvents}.
 */
export const mapRuntimeStreamEventToAgUiBrowserEvents = mapRuntimeStreamEventToAgUiEvents;

/**
 * Deprecated compatibility alias for {@link AgUiChunkEncoder}.
 * @deprecated Use {@link AgUiChunkEncoder}.
 */
export interface AgUiBrowserChunkEncoder<TChunk> extends AgUiChunkEncoder<TChunk> {}

/**
 * Deprecated compatibility alias for {@link CreateAgUiChunkEncoderOptions}.
 * @deprecated Use {@link CreateAgUiChunkEncoderOptions}.
 */
export interface CreateAgUiBrowserChunkEncoderOptions<TChunk>
  extends CreateAgUiChunkEncoderOptions<TChunk> {}

/**
 * Deprecated compatibility alias for {@link createAgUiChunkEncoder}.
 * @deprecated Use {@link createAgUiChunkEncoder}.
 */
export const createAgUiBrowserChunkEncoder = createAgUiChunkEncoder;

/**
 * Deprecated compatibility alias for {@link AgUiChatUiChunkEncoder}.
 * @deprecated Use {@link AgUiChatUiChunkEncoder}.
 */
export type AgUiChatUiChunkBrowserEncoder = AgUiChatUiChunkEncoder;

/**
 * Deprecated compatibility alias for {@link CreateAgUiChatUiChunkEncoderOptions}.
 * @deprecated Use {@link CreateAgUiChatUiChunkEncoderOptions}.
 */
export interface CreateAgUiChatUiChunkBrowserEncoderOptions
  extends CreateAgUiChatUiChunkEncoderOptions {}

/**
 * Deprecated compatibility alias for {@link CreateAgUiChatUiTrackedResponseInput}.
 * @deprecated Use {@link CreateAgUiChatUiTrackedResponseInput}.
 */
export interface CreateAgUiChatUiTrackedBrowserResponseInput
  extends CreateAgUiChatUiTrackedResponseInput {}

/**
 * Deprecated compatibility alias for {@link createAgUiChatUiChunkEncoder}.
 * @deprecated Use {@link createAgUiChatUiChunkEncoder}.
 */
export const createAgUiChatUiChunkBrowserEncoder = createAgUiChatUiChunkEncoder;

/**
 * Deprecated compatibility alias for {@link createAgUiChatUiTrackedResponse}.
 * @deprecated Use {@link createAgUiChatUiTrackedResponse}.
 */
export const createAgUiChatUiTrackedBrowserResponse = createAgUiChatUiTrackedResponse;

/**
 * Deprecated compatibility alias for {@link AgUiFinalizeTracker}.
 * @deprecated Use {@link AgUiFinalizeTracker}.
 */
export interface AgUiBrowserFinalizeTracker<TChunk> extends AgUiFinalizeTracker<TChunk> {}

/**
 * Deprecated compatibility alias for {@link CreateAgUiFinalizeTrackerOptions}.
 * @deprecated Use {@link CreateAgUiFinalizeTrackerOptions}.
 */
export interface CreateAgUiBrowserFinalizeTrackerOptions<TChunk>
  extends CreateAgUiFinalizeTrackerOptions<TChunk> {}

/**
 * Deprecated compatibility alias for {@link createAgUiFinalizeTracker}.
 * @deprecated Use {@link createAgUiFinalizeTracker}.
 */
export const createAgUiBrowserFinalizeTracker = createAgUiFinalizeTracker;

/**
 * Deprecated compatibility alias for {@link AgUiResponseRequestState}.
 * @deprecated Use {@link AgUiResponseRequestState}.
 */
export interface AgUiBrowserResponseRequestState extends AgUiResponseRequestState {}

/**
 * Deprecated compatibility alias for {@link AgUiResponseExecution}.
 * @deprecated Use {@link AgUiResponseExecution}.
 */
export interface AgUiBrowserResponseExecution<TChunk> extends AgUiResponseExecution<TChunk> {}

/**
 * Deprecated compatibility alias for {@link AgUiResponseEncoder}.
 * @deprecated Use {@link AgUiResponseEncoder}.
 */
export interface AgUiBrowserResponseEncoder<TChunk> extends AgUiResponseEncoder<TChunk> {}

/**
 * Deprecated compatibility alias for {@link CreateAgUiResponseStreamInput}.
 * @deprecated Use {@link CreateAgUiResponseStreamInput}.
 */
export interface CreateAgUiBrowserResponseStreamInput<TChunk, TState>
  extends CreateAgUiResponseStreamInput<TChunk, TState> {}

/**
 * Deprecated compatibility alias for {@link createAgUiResponseStream}.
 * @deprecated Use {@link createAgUiResponseStream}.
 */
export const createAgUiBrowserResponseStream = createAgUiResponseStream;

/**
 * Deprecated compatibility alias for {@link CreateAgUiRuntimeResponseInput}.
 * @deprecated Use {@link CreateAgUiRuntimeResponseInput}.
 */
export interface CreateAgUiRuntimeBrowserResponseInput<TChunk, TState>
  extends CreateAgUiRuntimeResponseInput<TChunk, TState> {}

/**
 * Deprecated compatibility alias for {@link createAgUiRuntimeResponse}.
 * @deprecated Use {@link createAgUiRuntimeResponse}.
 */
export const createAgUiRuntimeBrowserResponse = createAgUiRuntimeResponse;

/**
 * Deprecated compatibility alias for {@link CreateAgUiTrackedResponseInput}.
 * @deprecated Use {@link CreateAgUiTrackedResponseInput}.
 */
export interface CreateAgUiTrackedBrowserResponseInput<TChunk>
  extends CreateAgUiTrackedResponseInput<TChunk> {}

/**
 * Deprecated compatibility alias for {@link createAgUiTrackedResponse}.
 * @deprecated Use {@link createAgUiTrackedResponse}.
 */
export const createAgUiTrackedBrowserResponse = createAgUiTrackedResponse;

/**
 * Deprecated compatibility alias for {@link normalizeAgUiRuntimeRequest}.
 * @deprecated Use {@link normalizeAgUiRuntimeRequest}.
 */
export const normalizeAgUiBrowserRuntimeRequest = normalizeAgUiRuntimeRequest;
