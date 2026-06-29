import * as React from "react";
import { cn } from "../../theme.ts";
import { FileTextIcon, TrashIcon } from "../../icons/index.ts";

/** Public API contract for uploaded file. */
export interface UploadedFile {
  id: string;
  name: string;
  size?: number;
  type?: string;
  url?: string;
}

/** Props accepted by uploads panel. */
export interface UploadsPanelProps {
  uploads?: UploadedFile[];
  onRemoveUpload?: (id: string) => void;
  onAttach?: (files: FileList) => void;
  attachAccept?: string;
  className?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Render uploads panel. */
export function UploadsPanel({
  uploads = [],
  onRemoveUpload,
  onAttach,
  attachAccept,
  className,
}: UploadsPanelProps): React.ReactElement {
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {uploads.length === 0
          ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <h1 className="text-base font-medium text-[var(--foreground)]">
                No files uploaded
              </h1>
              <p className="mt-1 max-w-sm text-sm leading-6 text-[var(--faint)]">
                Upload files to start asking questions
              </p>
              {onAttach && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-4 h-[38px] rounded-full bg-[var(--primary)] px-4 text-sm font-normal text-[var(--secondary)] shadow-sm transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
                >
                  Upload files
                </button>
              )}
            </div>
          )
          : (
            <div className="max-w-2xl mx-auto space-y-1.5">
              {uploads.map((doc) => (
                <div
                  key={doc.id}
                  className="group flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 transition-colors hover:bg-[var(--secondary)]"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--secondary)] text-[var(--faint)]">
                    <FileTextIcon className="size-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    {doc.url
                      ? (
                        <a
                          href={doc.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate text-sm text-[var(--foreground)] hover:underline"
                        >
                          {doc.name}
                        </a>
                      )
                      : (
                        <p className="truncate text-sm text-[var(--foreground)]">
                          {doc.name}
                        </p>
                      )}
                    {doc.size != null && (
                      <p className="text-xs text-[var(--faint)]">
                        {formatFileSize(doc.size)}
                      </p>
                    )}
                  </div>
                  {onRemoveUpload && (
                    <button
                      type="button"
                      onClick={() => onRemoveUpload(doc.id)}
                      className="shrink-0 rounded-[var(--radius-md)] p-1.5 text-[var(--faint)] opacity-0 transition-colors hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] group-hover:opacity-100"
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
                  className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] px-3 py-2.5 text-sm text-[var(--faint)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
                >
                  <span className="text-xs">+</span>
                  Upload more files
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
          aria-label="Upload file"
          onChange={(e) => {
            if (e.target.files?.length) onAttach(e.target.files);
            e.target.value = "";
          }}
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: "hidden",
            clip: "rect(0,0,0,0)",
            whiteSpace: "nowrap",
            border: 0,
          }}
        />
      )}
    </div>
  );
}
