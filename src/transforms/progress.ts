/** A concrete milestone reached while transforming a module graph. */
export interface TransformProgressEvent {
  phase: string;
  filePath?: string;
}

/** Receives transform milestones. Callers use these as idle-deadline heartbeats. */
export type TransformProgressListener = (event: TransformProgressEvent) => void;
