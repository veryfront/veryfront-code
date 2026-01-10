/**
 * Shared types for filesystem adapters
 * Extracted to avoid circular dependencies between adapter type modules
 */

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
}
