/**
 * Generated AG-UI 1.0 TypeScript event contract.
 *
 * Source: src/events/ag-ui/schema.ts AG_UI_EVENT_SCHEMA.
 * Regenerate with: deno run -A src/events/ag-ui/generate-types.ts
 */

import type { AgUiEventType } from "./schema.ts";

export type AgUiJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly AgUiJsonValue[]
  | { readonly [key: string]: AgUiJsonValue };

export type AgUiMetadata = Record<string, unknown>;
export type AgUiProtocolExtensionFields<
  TExtensions extends Record<string, unknown> = Record<never, never>,
> = { readonly [K in keyof TExtensions]: TExtensions[K] };

export interface AgUiBaseEvent<TType extends AgUiEventType> extends AgUiProtocolExtensionFields {
  readonly type: TType;
  readonly timestamp?: number;
  readonly rawEvent?: unknown;
  readonly metadata?: AgUiMetadata;
  readonly subagentRunId?: string;
}

export type AgUiRunAgentInput = AgUiProtocolExtensionFields & {
  readonly "threadId": string;
  readonly "runId": string;
  readonly "protocolVersion"?: string;
  readonly "parentRunId"?: string;
  readonly "state"?: unknown;
  readonly "messages": readonly (
    | AgUiProtocolExtensionFields & {
      readonly "subagentRunId"?: string;
      readonly "id": string;
      readonly "role": "developer";
      readonly "name"?: string;
      readonly "encryptedValue"?: string;
      readonly "metadata"?: AgUiMetadata;
      readonly "content": string;
    }
    | AgUiProtocolExtensionFields & {
      readonly "subagentRunId"?: string;
      readonly "id": string;
      readonly "role": "system";
      readonly "name"?: string;
      readonly "encryptedValue"?: string;
      readonly "metadata"?: AgUiMetadata;
      readonly "content": string;
    }
    | AgUiProtocolExtensionFields & {
      readonly "subagentRunId"?: string;
      readonly "id": string;
      readonly "role": "assistant";
      readonly "name"?: string;
      readonly "encryptedValue"?: string;
      readonly "metadata"?: AgUiMetadata;
      readonly "content"?: string;
      readonly "toolCalls"?: readonly (AgUiProtocolExtensionFields & {
        readonly "id": string;
        readonly "type": "function";
        readonly "function": AgUiProtocolExtensionFields & {
          readonly "name": string;
          readonly "arguments": string;
        };
        readonly "encryptedValue"?: string;
        readonly "metadata"?: AgUiMetadata;
      })[];
    }
    | AgUiProtocolExtensionFields & {
      readonly "subagentRunId"?: string;
      readonly "id": string;
      readonly "role": "user";
      readonly "name"?: string;
      readonly "encryptedValue"?: string;
      readonly "metadata"?: AgUiMetadata;
      readonly "content":
        | string
        | readonly (
          | AgUiProtocolExtensionFields & {
            readonly "type": "text";
            readonly "id"?: string;
            readonly "text": string;
            readonly "metadata"?: unknown;
          }
          | AgUiProtocolExtensionFields & {
            readonly "type": "image";
            readonly "id"?: string;
            readonly "source":
              | AgUiProtocolExtensionFields & {
                readonly "type": "data";
                readonly "value": string;
                readonly "mimeType": string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "url";
                readonly "value": string;
                readonly "mimeType"?: string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "file";
                readonly "value": string;
                readonly "provider"?: string;
                readonly "mimeType"?: string;
              };
            readonly "metadata"?: unknown;
          }
          | AgUiProtocolExtensionFields & {
            readonly "type": "audio";
            readonly "id"?: string;
            readonly "source":
              | AgUiProtocolExtensionFields & {
                readonly "type": "data";
                readonly "value": string;
                readonly "mimeType": string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "url";
                readonly "value": string;
                readonly "mimeType"?: string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "file";
                readonly "value": string;
                readonly "provider"?: string;
                readonly "mimeType"?: string;
              };
            readonly "metadata"?: unknown;
          }
          | AgUiProtocolExtensionFields & {
            readonly "type": "video";
            readonly "id"?: string;
            readonly "source":
              | AgUiProtocolExtensionFields & {
                readonly "type": "data";
                readonly "value": string;
                readonly "mimeType": string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "url";
                readonly "value": string;
                readonly "mimeType"?: string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "file";
                readonly "value": string;
                readonly "provider"?: string;
                readonly "mimeType"?: string;
              };
            readonly "metadata"?: unknown;
          }
          | AgUiProtocolExtensionFields & {
            readonly "type": "document";
            readonly "id"?: string;
            readonly "source":
              | AgUiProtocolExtensionFields & {
                readonly "type": "data";
                readonly "value": string;
                readonly "mimeType": string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "url";
                readonly "value": string;
                readonly "mimeType"?: string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "file";
                readonly "value": string;
                readonly "provider"?: string;
                readonly "mimeType"?: string;
              };
            readonly "metadata"?: unknown;
          }
        )[];
    }
    | AgUiProtocolExtensionFields & {
      readonly "subagentRunId"?: string;
      readonly "id": string;
      readonly "role": "tool";
      readonly "content":
        | string
        | readonly (
          | AgUiProtocolExtensionFields & {
            readonly "type": "text";
            readonly "id"?: string;
            readonly "text": string;
            readonly "metadata"?: unknown;
          }
          | AgUiProtocolExtensionFields & {
            readonly "type": "image";
            readonly "id"?: string;
            readonly "source":
              | AgUiProtocolExtensionFields & {
                readonly "type": "data";
                readonly "value": string;
                readonly "mimeType": string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "url";
                readonly "value": string;
                readonly "mimeType"?: string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "file";
                readonly "value": string;
                readonly "provider"?: string;
                readonly "mimeType"?: string;
              };
            readonly "metadata"?: unknown;
          }
          | AgUiProtocolExtensionFields & {
            readonly "type": "audio";
            readonly "id"?: string;
            readonly "source":
              | AgUiProtocolExtensionFields & {
                readonly "type": "data";
                readonly "value": string;
                readonly "mimeType": string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "url";
                readonly "value": string;
                readonly "mimeType"?: string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "file";
                readonly "value": string;
                readonly "provider"?: string;
                readonly "mimeType"?: string;
              };
            readonly "metadata"?: unknown;
          }
          | AgUiProtocolExtensionFields & {
            readonly "type": "video";
            readonly "id"?: string;
            readonly "source":
              | AgUiProtocolExtensionFields & {
                readonly "type": "data";
                readonly "value": string;
                readonly "mimeType": string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "url";
                readonly "value": string;
                readonly "mimeType"?: string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "file";
                readonly "value": string;
                readonly "provider"?: string;
                readonly "mimeType"?: string;
              };
            readonly "metadata"?: unknown;
          }
          | AgUiProtocolExtensionFields & {
            readonly "type": "document";
            readonly "id"?: string;
            readonly "source":
              | AgUiProtocolExtensionFields & {
                readonly "type": "data";
                readonly "value": string;
                readonly "mimeType": string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "url";
                readonly "value": string;
                readonly "mimeType"?: string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "file";
                readonly "value": string;
                readonly "provider"?: string;
                readonly "mimeType"?: string;
              };
            readonly "metadata"?: unknown;
          }
        )[];
      readonly "toolCallId": string;
      readonly "error"?: string;
      readonly "encryptedValue"?: string;
      readonly "metadata"?: AgUiMetadata;
    }
    | AgUiProtocolExtensionFields & {
      readonly "subagentRunId"?: string;
      readonly "id": string;
      readonly "role": "activity";
      readonly "activityType": string;
      readonly "content": AgUiMetadata;
      readonly "metadata"?: AgUiMetadata;
    }
    | AgUiProtocolExtensionFields & {
      readonly "subagentRunId"?: string;
      readonly "id": string;
      readonly "role": "reasoning";
      readonly "content": string;
      readonly "encryptedValue"?: string;
      readonly "metadata"?: AgUiMetadata;
    }
  )[];
  readonly "tools"?: readonly (AgUiProtocolExtensionFields & {
    readonly "name": string;
    readonly "description": string;
    readonly "parameters"?: unknown;
    readonly "metadata"?: AgUiMetadata;
  })[];
  readonly "context"?: readonly (AgUiProtocolExtensionFields & {
    readonly "description": string;
    readonly "value": string;
  })[];
  readonly "forwardedProps"?: unknown;
  readonly "resume"?: readonly (AgUiProtocolExtensionFields & {
    readonly "interruptId": string;
    readonly "status": "resolved" | "cancelled";
    readonly "payload"?: unknown;
    readonly "metadata"?: AgUiMetadata;
  })[];
};

export type AgUiRunFinishedOutcome =
  | AgUiProtocolExtensionFields & {
    readonly "type": "success";
    readonly "pendingToolCallIds"?: readonly (string)[];
  }
  | AgUiProtocolExtensionFields & {
    readonly "type": "interrupt";
    readonly "interrupts": readonly [
      AgUiProtocolExtensionFields & {
        readonly "subagentRunId"?: string;
        readonly "id": string;
        readonly "reason": string;
        readonly "message"?: string;
        readonly "toolCallId"?: string;
        readonly "responseSchema"?: AgUiMetadata;
        readonly "expiresAt"?: string;
        readonly "metadata"?: AgUiMetadata;
      },
      ...AgUiProtocolExtensionFields & {
        readonly "subagentRunId"?: string;
        readonly "id": string;
        readonly "reason": string;
        readonly "message"?: string;
        readonly "toolCallId"?: string;
        readonly "responseSchema"?: AgUiMetadata;
        readonly "expiresAt"?: string;
        readonly "metadata"?: AgUiMetadata;
      }[],
    ];
  }
  | AgUiProtocolExtensionFields & {
    readonly "type": "cancelled";
  };

export type AgUiSubagentFinishedOutcome =
  | AgUiProtocolExtensionFields & {
    readonly "type": "success";
  }
  | AgUiProtocolExtensionFields & {
    readonly "type": "suspended";
    readonly "interruptIds"?: readonly (string)[];
  };

export type AgUiJsonPatch = readonly (
  | AgUiProtocolExtensionFields & {
    readonly "op": "add";
    readonly "path": string;
    readonly "value": unknown;
  }
  | AgUiProtocolExtensionFields & {
    readonly "op": "remove";
    readonly "path": string;
  }
  | AgUiProtocolExtensionFields & {
    readonly "op": "replace";
    readonly "path": string;
    readonly "value": unknown;
  }
  | AgUiProtocolExtensionFields & {
    readonly "op": "move";
    readonly "from": string;
    readonly "path": string;
  }
  | AgUiProtocolExtensionFields & {
    readonly "op": "copy";
    readonly "from": string;
    readonly "path": string;
  }
  | AgUiProtocolExtensionFields & {
    readonly "op": "test";
    readonly "path": string;
    readonly "value": unknown;
  }
)[];

export type AgUiTextMessageStartEvent = AgUiBaseEvent<"TEXT_MESSAGE_START"> & {
  readonly "messageId": string;
  readonly "role"?: "developer" | "system" | "assistant" | "user";
  readonly "name"?: string;
};

export type AgUiTextMessageContentEvent = AgUiBaseEvent<"TEXT_MESSAGE_CONTENT"> & {
  readonly "messageId": string;
  readonly "delta": string;
};

export type AgUiTextMessageEndEvent = AgUiBaseEvent<"TEXT_MESSAGE_END"> & {
  readonly "messageId": string;
};

export type AgUiTextMessageChunkEvent = AgUiBaseEvent<"TEXT_MESSAGE_CHUNK"> & {
  readonly "messageId"?: string;
  readonly "role"?: "developer" | "system" | "assistant" | "user";
  readonly "delta"?: string;
  readonly "name"?: string;
};

export type AgUiToolCallStartEvent = AgUiBaseEvent<"TOOL_CALL_START"> & {
  readonly "toolCallId": string;
  readonly "toolCallName": string;
  readonly "parentMessageId"?: string;
};

export type AgUiToolCallArgsEvent = AgUiBaseEvent<"TOOL_CALL_ARGS"> & {
  readonly "toolCallId": string;
  readonly "delta": string;
};

export type AgUiToolCallEndEvent = AgUiBaseEvent<"TOOL_CALL_END"> & {
  readonly "toolCallId": string;
};

export type AgUiToolCallChunkEvent = AgUiBaseEvent<"TOOL_CALL_CHUNK"> & {
  readonly "toolCallId"?: string;
  readonly "toolCallName"?: string;
  readonly "parentMessageId"?: string;
  readonly "delta"?: string;
};

export type AgUiToolCallResultEvent = AgUiBaseEvent<"TOOL_CALL_RESULT"> & {
  readonly "messageId": string;
  readonly "toolCallId": string;
  readonly "content":
    | string
    | readonly (
      | AgUiProtocolExtensionFields & {
        readonly "type": "text";
        readonly "id"?: string;
        readonly "text": string;
        readonly "metadata"?: unknown;
      }
      | AgUiProtocolExtensionFields & {
        readonly "type": "image";
        readonly "id"?: string;
        readonly "source":
          | AgUiProtocolExtensionFields & {
            readonly "type": "data";
            readonly "value": string;
            readonly "mimeType": string;
          }
          | AgUiProtocolExtensionFields & {
            readonly "type": "url";
            readonly "value": string;
            readonly "mimeType"?: string;
          }
          | AgUiProtocolExtensionFields & {
            readonly "type": "file";
            readonly "value": string;
            readonly "provider"?: string;
            readonly "mimeType"?: string;
          };
        readonly "metadata"?: unknown;
      }
      | AgUiProtocolExtensionFields & {
        readonly "type": "audio";
        readonly "id"?: string;
        readonly "source":
          | AgUiProtocolExtensionFields & {
            readonly "type": "data";
            readonly "value": string;
            readonly "mimeType": string;
          }
          | AgUiProtocolExtensionFields & {
            readonly "type": "url";
            readonly "value": string;
            readonly "mimeType"?: string;
          }
          | AgUiProtocolExtensionFields & {
            readonly "type": "file";
            readonly "value": string;
            readonly "provider"?: string;
            readonly "mimeType"?: string;
          };
        readonly "metadata"?: unknown;
      }
      | AgUiProtocolExtensionFields & {
        readonly "type": "video";
        readonly "id"?: string;
        readonly "source":
          | AgUiProtocolExtensionFields & {
            readonly "type": "data";
            readonly "value": string;
            readonly "mimeType": string;
          }
          | AgUiProtocolExtensionFields & {
            readonly "type": "url";
            readonly "value": string;
            readonly "mimeType"?: string;
          }
          | AgUiProtocolExtensionFields & {
            readonly "type": "file";
            readonly "value": string;
            readonly "provider"?: string;
            readonly "mimeType"?: string;
          };
        readonly "metadata"?: unknown;
      }
      | AgUiProtocolExtensionFields & {
        readonly "type": "document";
        readonly "id"?: string;
        readonly "source":
          | AgUiProtocolExtensionFields & {
            readonly "type": "data";
            readonly "value": string;
            readonly "mimeType": string;
          }
          | AgUiProtocolExtensionFields & {
            readonly "type": "url";
            readonly "value": string;
            readonly "mimeType"?: string;
          }
          | AgUiProtocolExtensionFields & {
            readonly "type": "file";
            readonly "value": string;
            readonly "provider"?: string;
            readonly "mimeType"?: string;
          };
        readonly "metadata"?: unknown;
      }
    )[];
  readonly "role"?: "tool";
};

export type AgUiStateSnapshotEvent = AgUiBaseEvent<"STATE_SNAPSHOT"> & {
  readonly "snapshot": unknown;
};

export type AgUiStateDeltaEvent = AgUiBaseEvent<"STATE_DELTA"> & {
  readonly "delta": AgUiJsonPatch;
};

export type AgUiMessagesSnapshotEvent = AgUiBaseEvent<"MESSAGES_SNAPSHOT"> & {
  readonly "messages": readonly (
    | AgUiProtocolExtensionFields & {
      readonly "subagentRunId"?: string;
      readonly "id": string;
      readonly "role": "developer";
      readonly "name"?: string;
      readonly "encryptedValue"?: string;
      readonly "metadata"?: AgUiMetadata;
      readonly "content": string;
    }
    | AgUiProtocolExtensionFields & {
      readonly "subagentRunId"?: string;
      readonly "id": string;
      readonly "role": "system";
      readonly "name"?: string;
      readonly "encryptedValue"?: string;
      readonly "metadata"?: AgUiMetadata;
      readonly "content": string;
    }
    | AgUiProtocolExtensionFields & {
      readonly "subagentRunId"?: string;
      readonly "id": string;
      readonly "role": "assistant";
      readonly "name"?: string;
      readonly "encryptedValue"?: string;
      readonly "metadata"?: AgUiMetadata;
      readonly "content"?: string;
      readonly "toolCalls"?: readonly (AgUiProtocolExtensionFields & {
        readonly "id": string;
        readonly "type": "function";
        readonly "function": AgUiProtocolExtensionFields & {
          readonly "name": string;
          readonly "arguments": string;
        };
        readonly "encryptedValue"?: string;
        readonly "metadata"?: AgUiMetadata;
      })[];
    }
    | AgUiProtocolExtensionFields & {
      readonly "subagentRunId"?: string;
      readonly "id": string;
      readonly "role": "user";
      readonly "name"?: string;
      readonly "encryptedValue"?: string;
      readonly "metadata"?: AgUiMetadata;
      readonly "content":
        | string
        | readonly (
          | AgUiProtocolExtensionFields & {
            readonly "type": "text";
            readonly "id"?: string;
            readonly "text": string;
            readonly "metadata"?: unknown;
          }
          | AgUiProtocolExtensionFields & {
            readonly "type": "image";
            readonly "id"?: string;
            readonly "source":
              | AgUiProtocolExtensionFields & {
                readonly "type": "data";
                readonly "value": string;
                readonly "mimeType": string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "url";
                readonly "value": string;
                readonly "mimeType"?: string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "file";
                readonly "value": string;
                readonly "provider"?: string;
                readonly "mimeType"?: string;
              };
            readonly "metadata"?: unknown;
          }
          | AgUiProtocolExtensionFields & {
            readonly "type": "audio";
            readonly "id"?: string;
            readonly "source":
              | AgUiProtocolExtensionFields & {
                readonly "type": "data";
                readonly "value": string;
                readonly "mimeType": string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "url";
                readonly "value": string;
                readonly "mimeType"?: string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "file";
                readonly "value": string;
                readonly "provider"?: string;
                readonly "mimeType"?: string;
              };
            readonly "metadata"?: unknown;
          }
          | AgUiProtocolExtensionFields & {
            readonly "type": "video";
            readonly "id"?: string;
            readonly "source":
              | AgUiProtocolExtensionFields & {
                readonly "type": "data";
                readonly "value": string;
                readonly "mimeType": string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "url";
                readonly "value": string;
                readonly "mimeType"?: string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "file";
                readonly "value": string;
                readonly "provider"?: string;
                readonly "mimeType"?: string;
              };
            readonly "metadata"?: unknown;
          }
          | AgUiProtocolExtensionFields & {
            readonly "type": "document";
            readonly "id"?: string;
            readonly "source":
              | AgUiProtocolExtensionFields & {
                readonly "type": "data";
                readonly "value": string;
                readonly "mimeType": string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "url";
                readonly "value": string;
                readonly "mimeType"?: string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "file";
                readonly "value": string;
                readonly "provider"?: string;
                readonly "mimeType"?: string;
              };
            readonly "metadata"?: unknown;
          }
        )[];
    }
    | AgUiProtocolExtensionFields & {
      readonly "subagentRunId"?: string;
      readonly "id": string;
      readonly "role": "tool";
      readonly "content":
        | string
        | readonly (
          | AgUiProtocolExtensionFields & {
            readonly "type": "text";
            readonly "id"?: string;
            readonly "text": string;
            readonly "metadata"?: unknown;
          }
          | AgUiProtocolExtensionFields & {
            readonly "type": "image";
            readonly "id"?: string;
            readonly "source":
              | AgUiProtocolExtensionFields & {
                readonly "type": "data";
                readonly "value": string;
                readonly "mimeType": string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "url";
                readonly "value": string;
                readonly "mimeType"?: string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "file";
                readonly "value": string;
                readonly "provider"?: string;
                readonly "mimeType"?: string;
              };
            readonly "metadata"?: unknown;
          }
          | AgUiProtocolExtensionFields & {
            readonly "type": "audio";
            readonly "id"?: string;
            readonly "source":
              | AgUiProtocolExtensionFields & {
                readonly "type": "data";
                readonly "value": string;
                readonly "mimeType": string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "url";
                readonly "value": string;
                readonly "mimeType"?: string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "file";
                readonly "value": string;
                readonly "provider"?: string;
                readonly "mimeType"?: string;
              };
            readonly "metadata"?: unknown;
          }
          | AgUiProtocolExtensionFields & {
            readonly "type": "video";
            readonly "id"?: string;
            readonly "source":
              | AgUiProtocolExtensionFields & {
                readonly "type": "data";
                readonly "value": string;
                readonly "mimeType": string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "url";
                readonly "value": string;
                readonly "mimeType"?: string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "file";
                readonly "value": string;
                readonly "provider"?: string;
                readonly "mimeType"?: string;
              };
            readonly "metadata"?: unknown;
          }
          | AgUiProtocolExtensionFields & {
            readonly "type": "document";
            readonly "id"?: string;
            readonly "source":
              | AgUiProtocolExtensionFields & {
                readonly "type": "data";
                readonly "value": string;
                readonly "mimeType": string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "url";
                readonly "value": string;
                readonly "mimeType"?: string;
              }
              | AgUiProtocolExtensionFields & {
                readonly "type": "file";
                readonly "value": string;
                readonly "provider"?: string;
                readonly "mimeType"?: string;
              };
            readonly "metadata"?: unknown;
          }
        )[];
      readonly "toolCallId": string;
      readonly "error"?: string;
      readonly "encryptedValue"?: string;
      readonly "metadata"?: AgUiMetadata;
    }
    | AgUiProtocolExtensionFields & {
      readonly "subagentRunId"?: string;
      readonly "id": string;
      readonly "role": "activity";
      readonly "activityType": string;
      readonly "content": AgUiMetadata;
      readonly "metadata"?: AgUiMetadata;
    }
    | AgUiProtocolExtensionFields & {
      readonly "subagentRunId"?: string;
      readonly "id": string;
      readonly "role": "reasoning";
      readonly "content": string;
      readonly "encryptedValue"?: string;
      readonly "metadata"?: AgUiMetadata;
    }
  )[];
};

export type AgUiActivitySnapshotEvent = AgUiBaseEvent<"ACTIVITY_SNAPSHOT"> & {
  readonly "messageId": string;
  readonly "activityType": string;
  readonly "content": AgUiMetadata;
  readonly "replace"?: boolean;
};

export type AgUiActivityDeltaEvent = AgUiBaseEvent<"ACTIVITY_DELTA"> & {
  readonly "messageId": string;
  readonly "activityType": string;
  readonly "patch": AgUiJsonPatch;
};

export type AgUiRawEvent = AgUiBaseEvent<"RAW"> & {
  readonly "event": unknown;
  readonly "source"?: string;
};

export type AgUiCustomEvent = AgUiBaseEvent<"CUSTOM"> & {
  readonly "name": string;
  readonly "value": unknown;
};

export type AgUiRunStartedEvent = AgUiBaseEvent<"RUN_STARTED"> & {
  readonly "threadId": string;
  readonly "runId": string;
  readonly "protocolVersion"?: string;
  readonly "parentRunId"?: string;
  readonly "input"?: AgUiRunAgentInput;
};

export type AgUiRunFinishedEvent = AgUiBaseEvent<"RUN_FINISHED"> & {
  readonly "threadId": string;
  readonly "runId": string;
  readonly "result"?: unknown;
  readonly "outcome"?: AgUiRunFinishedOutcome;
  readonly "usage"?: readonly (AgUiProtocolExtensionFields & {
    readonly "provider"?: string;
    readonly "model"?: string;
    readonly "inputTokens"?: number;
    readonly "outputTokens"?: number;
    readonly "totalTokens"?: number;
    readonly "reasoningTokens"?: number;
    readonly "cachedInputTokens"?: number;
    readonly "cacheWriteInputTokens"?: number;
  })[];
};

export type AgUiRunErrorEvent = AgUiBaseEvent<"RUN_ERROR"> & {
  readonly "message": string;
  readonly "code"?: string;
  readonly "usage"?: readonly (AgUiProtocolExtensionFields & {
    readonly "provider"?: string;
    readonly "model"?: string;
    readonly "inputTokens"?: number;
    readonly "outputTokens"?: number;
    readonly "totalTokens"?: number;
    readonly "reasoningTokens"?: number;
    readonly "cachedInputTokens"?: number;
    readonly "cacheWriteInputTokens"?: number;
  })[];
};

export type AgUiStepStartedEvent = AgUiBaseEvent<"STEP_STARTED"> & {
  readonly "stepName": string;
};

export type AgUiStepFinishedEvent = AgUiBaseEvent<"STEP_FINISHED"> & {
  readonly "stepName": string;
};

export type AgUiReasoningStartEvent = AgUiBaseEvent<"REASONING_START"> & {
  readonly "messageId": string;
};

export type AgUiReasoningMessageStartEvent = AgUiBaseEvent<"REASONING_MESSAGE_START"> & {
  readonly "messageId": string;
  readonly "role": "reasoning";
};

export type AgUiReasoningMessageContentEvent = AgUiBaseEvent<"REASONING_MESSAGE_CONTENT"> & {
  readonly "messageId": string;
  readonly "delta": string;
};

export type AgUiReasoningMessageEndEvent = AgUiBaseEvent<"REASONING_MESSAGE_END"> & {
  readonly "messageId": string;
};

export type AgUiReasoningMessageChunkEvent = AgUiBaseEvent<"REASONING_MESSAGE_CHUNK"> & {
  readonly "messageId"?: string;
  readonly "delta"?: string;
};

export type AgUiReasoningEndEvent = AgUiBaseEvent<"REASONING_END"> & {
  readonly "messageId": string;
};

export type AgUiReasoningEncryptedValueEvent = AgUiBaseEvent<"REASONING_ENCRYPTED_VALUE"> & {
  readonly "subtype": "tool-call" | "message";
  readonly "entityId": string;
  readonly "encryptedValue": string;
};

export type AgUiSubagentStartedEvent = AgUiBaseEvent<"SUBAGENT_STARTED"> & {
  readonly "subagentRunId": string;
  readonly "name": string;
  readonly "description"?: string;
  readonly "parentSubagentRunId"?: string;
  readonly "parentToolCallId"?: string;
  readonly "parentMessageId"?: string;
};

export type AgUiSubagentFinishedEvent = AgUiBaseEvent<"SUBAGENT_FINISHED"> & {
  readonly "subagentRunId": string;
  readonly "result"?: unknown;
  readonly "outcome"?: AgUiSubagentFinishedOutcome;
};

export type AgUiSubagentErrorEvent = AgUiBaseEvent<"SUBAGENT_ERROR"> & {
  readonly "subagentRunId": string;
  readonly "message": string;
  readonly "code"?: string;
};

export type AgUiEvent =
  | AgUiTextMessageStartEvent
  | AgUiTextMessageContentEvent
  | AgUiTextMessageEndEvent
  | AgUiTextMessageChunkEvent
  | AgUiToolCallStartEvent
  | AgUiToolCallArgsEvent
  | AgUiToolCallEndEvent
  | AgUiToolCallChunkEvent
  | AgUiToolCallResultEvent
  | AgUiStateSnapshotEvent
  | AgUiStateDeltaEvent
  | AgUiMessagesSnapshotEvent
  | AgUiActivitySnapshotEvent
  | AgUiActivityDeltaEvent
  | AgUiRawEvent
  | AgUiCustomEvent
  | AgUiRunStartedEvent
  | AgUiRunFinishedEvent
  | AgUiRunErrorEvent
  | AgUiStepStartedEvent
  | AgUiStepFinishedEvent
  | AgUiReasoningStartEvent
  | AgUiReasoningMessageStartEvent
  | AgUiReasoningMessageContentEvent
  | AgUiReasoningMessageEndEvent
  | AgUiReasoningMessageChunkEvent
  | AgUiReasoningEndEvent
  | AgUiReasoningEncryptedValueEvent
  | AgUiSubagentStartedEvent
  | AgUiSubagentFinishedEvent
  | AgUiSubagentErrorEvent;

export type AgUiEventWithExtensions<
  TEvent extends AgUiEvent = AgUiEvent,
  TExtensions extends Record<string, unknown> = Record<string, unknown>,
> = TEvent & AgUiProtocolExtensionFields<TExtensions>;

export type AgUiEventByType = {
  readonly [TType in AgUiEventType]: Extract<AgUiEvent, { readonly type: TType }>;
};

export type AgUiEventOf<TType extends AgUiEventType> = AgUiEventByType[TType];
