import * as React from "react";
import { cn } from "../../theme.ts";
import { FileTextIcon, TrashIcon } from "../../icons/index.ts";

export interface DocFile {
  id: string;
  name: string;
  size?: number;
  type?: string;
}

export interface DocsPanelProps {
  documents?: DocFile[];
  onRemoveDocument?: (id: string) => void;
  onAttach?: (files: FileList) => void;
  attachAccept?: string;
  className?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocsPanel({
  documents = [],
  onRemoveDocument,
  onAttach,
  attachAccept,
  className,
}: DocsPanelProps): React.ReactElement {
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {documents.length === 0
          ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="mb-4 flex items-center justify-center size-14 rounded-2xl bg-neutral-100 dark:bg-neutral-800/80 text-neutral-400 dark:text-neutral-500">
                <FileTextIcon className="size-7" />
              </div>
              <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">No documents uploaded</p>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Upload documents to start asking questions</p>
              {onAttach && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-4 px-4 py-2 text-sm font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
                >
                  Upload Documents
                </button>
              )}
            </div>
          )
          : (
            <div className="max-w-2xl mx-auto space-y-2">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center gap-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-3 group"
                >
                  <div className="shrink-0 size-9 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-400 dark:text-neutral-500">
                    <FileTextIcon className="size-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300 truncate">{doc.name}</p>
                    {doc.size != null && (
                      <p className="text-xs text-neutral-400 dark:text-neutral-500">{formatFileSize(doc.size)}</p>
                    )}
                  </div>
                  {onRemoveDocument && (
                    <button
                      type="button"
                      onClick={() => onRemoveDocument(doc.id)}
                      className="shrink-0 p-1.5 rounded-md text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors opacity-0 group-hover:opacity-100"
                      aria-label={`Remove ${doc.name}`}
                    >
                      <TrashIcon className="size-4" />
                    </button>
                  )}
                </div>
              ))}
              {onAttach && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-300 dark:border-neutral-600 px-4 py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800/60 hover:border-neutral-400 dark:hover:border-neutral-500 transition-all"
                >
                  Upload more documents
                </button>
              )}
            </div>
          )}
      </div>
      {onAttach && (
        <input
          ref={fileInputRef}
          type="file"
          accept={attachAccept}
          multiple
          onChange={(e) => {
            if (e.target.files?.length) onAttach(e.target.files);
            e.target.value = "";
          }}
          style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 }}
        />
      )}
    </div>
  );
}
