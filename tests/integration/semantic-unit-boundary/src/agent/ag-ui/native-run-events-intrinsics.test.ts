import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildNativeRunEventFrame,
  isNativeRunEventName,
  isNativeRunEventStoredType,
} from "../../../../../../src/agent/ag-ui/native-run-events.ts";

const nativeArrayIterator = Array.prototype[Symbol.iterator];
const nativeSetHas = Set.prototype.has;

describe("agent/ag-ui native run event intrinsic boundaries", () => {
  afterEach(() => {
    Array.prototype[Symbol.iterator] = nativeArrayIterator;
    Set.prototype.has = nativeSetHas;
  });

  it("checks native event membership after project code replaces Set.has", () => {
    let poisonedCalls = 0;
    let toolCallStatusName = false;
    let unknownName = true;
    let toolCallStatusType = false;
    let customType = true;

    Set.prototype.has = function <T>(_value: T): boolean {
      poisonedCalls += 1;
      throw new Error("project Set.prototype.has hook");
    };
    try {
      toolCallStatusName = isNativeRunEventName("tool-call-status");
      unknownName = isNativeRunEventName("state-delta");
      toolCallStatusType = isNativeRunEventStoredType("TOOL_CALL_STATUS_CHANGED");
      customType = isNativeRunEventStoredType("CUSTOM");
    } finally {
      Set.prototype.has = nativeSetHas;
    }

    assertEquals(toolCallStatusName, true);
    assertEquals(unknownName, false);
    assertEquals(toolCallStatusType, true);
    assertEquals(customType, false);
    assertEquals(poisonedCalls, 0);
  });

  it("drops invalid optional strings after project code replaces array iteration", () => {
    let urlFrame: ReturnType<typeof buildNativeRunEventFrame> = null;
    let documentFrame: ReturnType<typeof buildNativeRunEventFrame> = null;
    let fileFrame: ReturnType<typeof buildNativeRunEventFrame> = null;

    Array.prototype[Symbol.iterator] = function (): ReturnType<typeof nativeArrayIterator> {
      throw new Error("project Array.prototype iterator hook");
    };
    try {
      urlFrame = buildNativeRunEventFrame({
        name: "source-url",
        value: { type: "source-url", url: "https://example.com/a", title: "" },
      });
      documentFrame = buildNativeRunEventFrame({
        name: "source-document",
        value: {
          type: "source-document",
          mediaType: "text/markdown",
          title: "",
          filename: "",
        },
      });
      fileFrame = buildNativeRunEventFrame({
        name: "file",
        value: { type: "file", mediaType: "application/pdf", filename: "", url: "" },
      });
    } finally {
      Array.prototype[Symbol.iterator] = nativeArrayIterator;
    }

    assertEquals(urlFrame?.durable, {
      url: "https://example.com/a",
      sourceId: "https://example.com/a",
      type: "URL_CITED",
    });
    assertEquals(documentFrame?.durable, {
      mediaType: "text/markdown",
      sourceId: "text/markdown",
      type: "DOCUMENT_CITED",
    });
    assertEquals(fileFrame?.durable, {
      mediaType: "application/pdf",
      type: "FILE_ATTACHED",
    });
  });
});
