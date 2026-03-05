import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { UIMessage } from "./types.ts";
import { findBranchUserMessageIndex, isLatestRequest, resolveBranchKey } from "./use-chat.ts";

describe("use-chat internal state helpers", () => {
  it("isLatestRequest only accepts matching request ids", () => {
    assertEquals(isLatestRequest(3, 3), true);
    assertEquals(isLatestRequest(3, 2), false);
  });

  it("resolveBranchKey prefers mapped key when message id was remapped", () => {
    const branchMap = new Map([
      [
        "msg-old",
        {
          branches: [],
          currentIndex: 0,
          baseMessages: [] as UIMessage[],
        },
      ],
    ]);
    const branchKeyByMessageId = new Map([["msg-new", "msg-old"]]);

    assertEquals(resolveBranchKey("msg-new", branchMap, branchKeyByMessageId), "msg-old");
  });

  it("resolveBranchKey falls back to direct map key and returns undefined when missing", () => {
    const branchMap = new Map([
      [
        "msg-root",
        {
          branches: [],
          currentIndex: 0,
          baseMessages: [] as UIMessage[],
        },
      ],
    ]);
    const branchKeyByMessageId = new Map<string, string>();

    assertEquals(resolveBranchKey("msg-root", branchMap, branchKeyByMessageId), "msg-root");
    assertEquals(resolveBranchKey("msg-missing", branchMap, branchKeyByMessageId), undefined);
  });

  it("findBranchUserMessageIndex locates the active user branch by mapped key", () => {
    const messages: UIMessage[] = [
      { id: "sys", role: "system", parts: [{ type: "text", text: "S" }] },
      { id: "u1", role: "user", parts: [{ type: "text", text: "old branch" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "A" }] },
      { id: "u2", role: "user", parts: [{ type: "text", text: "new branch" }] },
    ];
    const branchKeyByMessageId = new Map<string, string>([
      ["u1", "root-1"],
      ["u2", "root-2"],
    ]);

    assertEquals(findBranchUserMessageIndex(messages, "root-2", branchKeyByMessageId), 3);
    assertEquals(findBranchUserMessageIndex(messages, "root-1", branchKeyByMessageId), 1);
    assertEquals(findBranchUserMessageIndex(messages, "missing", branchKeyByMessageId), -1);
  });
});
