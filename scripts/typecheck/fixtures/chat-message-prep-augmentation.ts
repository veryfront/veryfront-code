// Consumer fixture — documented `veryfront/chat/message-prep` declaration merging.
//
// Never executed. It exists so the consumer `tsc --noEmit` gate proves the
// published options contract remains an augmentable interface for downstream
// TypeScript consumers.
import type { PrepareProviderModelMessagesFromUiMessagesOptions } from "veryfront/chat/message-prep";

declare module "veryfront/chat/message-prep" {
  interface PrepareProviderModelMessagesFromUiMessagesOptions {
    downstreamTraceId?: string;
  }
}

const options: PrepareProviderModelMessagesFromUiMessagesOptions = {
  downstreamTraceId: "consumer-owned-field",
};

if (options.downstreamTraceId !== undefined) {
  options.downstreamTraceId.toUpperCase();
}
