const changedErrors = new WeakSet<object>();

/** Error raised when a file changes while a stable snapshot is being read. */
export class FileSnapshotChangedError extends Error {
  override readonly name = "FileSnapshotChangedError";

  constructor(message = "File snapshot changed during the read") {
    super(message);
    changedErrors.add(this);
  }
}

/** Return whether a value is a framework-created file snapshot change error. */
export function isFileSnapshotChangedError(
  value: unknown,
): value is FileSnapshotChangedError {
  return typeof value === "object" && value !== null && changedErrors.has(value);
}
