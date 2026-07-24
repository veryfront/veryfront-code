import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { HMRMessageType, HMRProtocolMessage } from "./hmr.ts";

const legacyMessageTypes: HMRMessageType[] = ["connected", "update", "reload"];

const messages: HMRProtocolMessage[] = [
  { type: "connected", reactRefresh: true },
  {
    type: "update",
    path: "styles.css",
    timestamp: 1,
    styleHref: "/styles.css",
    styleHash: "hash",
  },
  { type: "reload", timestamp: 2 },
  { type: "ping", timestamp: 3 },
  { type: "pong" },
];

// @ts-expect-error Update messages require a changed path.
const invalidUpdate: HMRProtocolMessage = { type: "update" };
void invalidUpdate;

describe("HMR protocol types", () => {
  it("model every wire message kind", () => {
    assertEquals(legacyMessageTypes, ["connected", "update", "reload"]);
    assertEquals(messages.map((message) => message.type), [
      "connected",
      "update",
      "reload",
      "ping",
      "pong",
    ]);
  });
});
