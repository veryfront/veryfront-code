export class StreamAlreadyConsumedError extends Error {
  constructor() {
    super("Stream lifecycle frames support one consumer");
    this.name = "StreamAlreadyConsumedError";
  }
}
