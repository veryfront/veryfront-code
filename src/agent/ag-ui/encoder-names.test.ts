import { assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as agent from "../index.ts";

describe("AG-UI encoder public names", () => {
  it("keeps browser-prefixed functions as compatibility aliases", () => {
    assertStrictEquals(
      agent.buildAgUiFinalizeResponse,
      agent.buildAgUiBrowserFinalizeResponse,
    );
    assertStrictEquals(
      agent.createAgUiEncoderState,
      agent.createAgUiBrowserEncoderState,
    );
    assertStrictEquals(
      agent.finalizeAgUiEvents,
      agent.finalizeAgUiBrowserEvents,
    );
    assertStrictEquals(
      agent.mapRuntimeStreamEventToAgUiEvents,
      agent.mapRuntimeStreamEventToAgUiBrowserEvents,
    );
    assertStrictEquals(
      agent.createAgUiChunkEncoder,
      agent.createAgUiBrowserChunkEncoder,
    );
    assertStrictEquals(
      agent.createAgUiChatUiChunkEncoder,
      agent.createAgUiChatUiChunkBrowserEncoder,
    );
    assertStrictEquals(
      agent.createAgUiChatUiTrackedResponse,
      agent.createAgUiChatUiTrackedBrowserResponse,
    );
    assertStrictEquals(
      agent.createAgUiFinalizeTracker,
      agent.createAgUiBrowserFinalizeTracker,
    );
    assertStrictEquals(
      agent.createAgUiResponseStream,
      agent.createAgUiBrowserResponseStream,
    );
    assertStrictEquals(
      agent.createAgUiRuntimeResponse,
      agent.createAgUiRuntimeBrowserResponse,
    );
    assertStrictEquals(
      agent.createAgUiTrackedResponse,
      agent.createAgUiTrackedBrowserResponse,
    );
    assertStrictEquals(
      agent.normalizeAgUiRuntimeRequest,
      agent.normalizeAgUiBrowserRuntimeRequest,
    );
  });
});
