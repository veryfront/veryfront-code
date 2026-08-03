const changedErrors = new WeakSet<object>();
const rejectedPathErrors = new WeakSet<object>();

/** Error raised when a requested snapshot path is not an admissible regular file. */
export class FileSnapshotPathError extends TypeError {
  override readonly name = "FileSnapshotPathError";

  constructor(message: string) {
    super(message);
    rejectedPathErrors.add(this);
  }
}

/** Return whether a value is a framework-created snapshot path rejection. */
export function isFileSnapshotPathError(
  value: unknown,
): value is FileSnapshotPathError {
  return typeof value === "object" && value !== null && rejectedPathErrors.has(value);
}

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
