import { assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as agent from "../index.ts";

describe("AG-UI encoder public names", () => {
  it("keeps browser-prefixed functions as compatibility aliases", () => {
    assertStrictEquals(
      agent.buildAgUiFinalizeResponse,
      agent.buildAgUiFinalizeResponse,
    );
    assertStrictEquals(
      agent.createAgUiEncoderState,
      agent.createAgUiEncoderState,
    );
    assertStrictEquals(
      agent.finalizeAgUiEvents,
      agent.finalizeAgUiEvents,
    );
    assertStrictEquals(
      agent.mapRuntimeStreamEventToAgUiEvents,
      agent.mapRuntimeStreamEventToAgUiEvents,
    );
    assertStrictEquals(
      agent.createAgUiChunkEncoder,
      agent.createAgUiChunkEncoder,
    );
    assertStrictEquals(
      agent.createAgUiChatUiChunkEncoder,
      agent.createAgUiChatUiChunkEncoder,
    );
    assertStrictEquals(
      agent.createAgUiChatUiTrackedResponse,
      agent.createAgUiChatUiTrackedResponse,
    );
    assertStrictEquals(
      agent.createAgUiFinalizeTracker,
      agent.createAgUiFinalizeTracker,
    );
    assertStrictEquals(
      agent.createAgUiResponseStream,
      agent.createAgUiResponseStream,
    );
    assertStrictEquals(
      agent.createAgUiRuntimeResponse,
      agent.createAgUiRuntimeResponse,
    );
    assertStrictEquals(
      agent.createAgUiTrackedResponse,
      agent.createAgUiTrackedResponse,
    );
    assertStrictEquals(
      agent.normalizeAgUiRuntimeRequest,
      agent.normalizeAgUiRuntimeRequest,
    );
  });
});
