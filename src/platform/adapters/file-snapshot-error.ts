const changedErrors = new WeakSet<object>();

export class FileSnapshotChangedError extends Error {
  override readonly name = "FileSnapshotChangedError";

  constructor(message = "File snapshot changed during the read") {
    super(message);
    changedErrors.add(this);
  }
}

export function isFileSnapshotChangedError(
  value: unknown,
): value is FileSnapshotChangedError {
  return typeof value === "object" && value !== null && changedErrors.has(value);
}
