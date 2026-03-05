import * as React from "react";
import { cn } from "../../theme.ts";
import { FileTextIcon, TrashIcon } from "../../icons/index.ts";

export interface UploadedFile {
  id: string;
  name: string;
  size?: number;
  type?: string;
}

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
              <div className="mb-4 flex items-center justify-center size-14 rounded-2xl bg-[var(--accent)] text-[var(--input-placeholder)]">
                <FileTextIcon className="size-7" />
              </div>
              <p className="text-sm font-medium text-[var(--card-foreground)]">
                No files uploaded
              </p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                Upload files to start asking questions
              </p>
              {onAttach && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-4 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 transition-colors"
                >
                  Upload Files
                </button>
              )}
            </div>
          )
          : (
            <div className="max-w-2xl mx-auto space-y-2">
              {uploads.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 group"
                >
                  <div className="shrink-0 size-9 rounded-lg bg-[var(--accent)] flex items-center justify-center text-[var(--input-placeholder)]">
                    <FileTextIcon className="size-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--card-foreground)] truncate">
                      {doc.name}
                    </p>
                    {doc.size != null && (
                      <p className="text-xs text-[var(--input-placeholder)]">
                        {formatFileSize(doc.size)}
                      </p>
                    )}
                  </div>
                  {onRemoveUpload && (
                    <button
                      type="button"
                      onClick={() => onRemoveUpload(doc.id)}
                      className="shrink-0 p-1.5 rounded-md text-[var(--muted-foreground)] hover:text-[var(--destructive)] hover:bg-[var(--destructive)]/10 transition-colors opacity-0 group-hover:opacity-100"
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
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--input-border)] px-4 py-3 text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:border-[var(--input-border)] transition-all"
                >
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
