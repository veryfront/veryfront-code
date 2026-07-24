import type { StreamLifecycleError } from "./types.ts";

export class StreamAlreadyConsumedError extends Error {
  constructor() {
    super("Stream lifecycle frames support one consumer");
    this.name = "StreamAlreadyConsumedError";
  }
}

export class StreamLifecycleFailure extends Error {
  constructor(readonly lifecycleError: StreamLifecycleError) {
    super(lifecycleError.publicMessage);
    this.name = "StreamLifecycleFailure";
  }
}
