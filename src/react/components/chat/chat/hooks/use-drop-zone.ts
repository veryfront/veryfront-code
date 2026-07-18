/**
 * `useDropZone` — file drag-and-drop state for a container. Returns whether a
 * file drag is currently over the element plus explicit event handlers. A
 * ref-counted enter/leave pair keeps `isDragActive` steady while the
 * cursor moves across child elements (no flicker). Only reacts to drags that
 * carry files, and only fires `onDrop` when `onDrop` is provided.
 *
 * @module react/components/chat/chat/hooks/use-drop-zone
 */

import * as React from "react";

/** Drag handlers to spread onto the drop target. */
export interface DropZoneHandlers {
  onDragEnter: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

/** Result of {@link useDropZone}. */
export interface UseDropZoneResult {
  /** True while a file drag is hovering the target. */
  isDragActive: boolean;
  /** Explicit target handlers. Undefined when `onDrop` is undefined. */
  onDragEnter?: DropZoneHandlers["onDragEnter"];
  onDragLeave?: DropZoneHandlers["onDragLeave"];
  onDragOver?: DropZoneHandlers["onDragOver"];
  onDrop?: DropZoneHandlers["onDrop"];
}

/** Wire file drag-and-drop for a container. */
export function useDropZone(
  onDrop: ((files: FileList) => void) | undefined,
): UseDropZoneResult {
  const [isDragActive, setDragActive] = React.useState(false);
  const dragCounter = React.useRef(0);

  const handleDragEnter = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) setDragActive(true);
  }, []);

  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragActive(false);
  }, []);

  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setDragActive(false);
      if (e.dataTransfer.files.length > 0) onDrop?.(e.dataTransfer.files);
    },
    [onDrop],
  );

  return onDrop
    ? {
      isDragActive,
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDragOver: handleDragOver,
      onDrop: handleDrop,
    }
    : { isDragActive: false };
}
