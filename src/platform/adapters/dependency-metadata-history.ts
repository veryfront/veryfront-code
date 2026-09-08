export interface DependencyMetadataHistoryEntry {
  readonly dependencies: Readonly<Record<string, string>>;
  readonly expiresAt: number;
}

export interface DependencyMetadataHistory {
  readonly version: 1;
  readonly projectId: string;
  readonly branch: string | null;
  readonly entries: readonly DependencyMetadataHistoryEntry[];
}
