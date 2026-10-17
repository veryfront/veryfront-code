/** Narrow host readers: no credential, arbitrary request or mutable file alias reaches the application. */
export type HostedAcceptedChildEvidence = Readonly<{
  readParentToolResults(): Promise<readonly Readonly<Record<string, unknown>>[]>;
  readCommittedVersion(
    path: string,
    versionId: string,
  ): Promise<{ path: string; versionId: string; content: string }>;
}>;
