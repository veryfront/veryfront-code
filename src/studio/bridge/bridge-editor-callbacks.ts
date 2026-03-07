/**
 * Bridge Editor Callbacks
 *
 * Callback interface that decouples editor modules from the bridge
 * messaging layer. The bridge registers concrete callbacks at init
 * time; editor modules call them without knowing about postToStudio.
 */

import { logger } from "./bridge-logger.ts";

interface EditorCallbacks {
  onContentChange(
    fileId: string | null,
    filePath: string,
    content: string,
    save?: boolean,
  ): void;
  onEditorReady(fileId: string | null, filePath: string): void;
  onOpenFile(
    filePath: string,
    lineNumber: number,
    columnNumber: number,
    symbolName?: string,
  ): void;
}

let callbacks: EditorCallbacks | null = null;

export function registerEditorCallbacks(cb: EditorCallbacks): void {
  if (callbacks) {
    logger.warn("EditorCallbacks already registered, overwriting");
  }
  callbacks = cb;
}

export function getEditorCallbacks(): EditorCallbacks | null {
  return callbacks;
}
