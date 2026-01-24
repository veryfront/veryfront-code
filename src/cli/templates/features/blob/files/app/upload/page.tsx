"use client";

import { useEffect, useState } from "react";

interface FileRef {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  createdAt: number;
  url?: string;
}

export default function UploadPage(): React.JSX.Element {
  const [files, setFiles] = useState<FileRef[]>([]);
  const [uploading, setUploading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    void loadFiles();
  }, []);

  async function loadFiles(): Promise<void> {
    try {
      const response = await fetch("/api/upload");
      const data = await response.json();
      setFiles(data.files ?? []);
    } catch (_error) {
      console.error("Failed to load files:", err);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error("Upload failed");

      await loadFiles();
    } catch (_error) {
      setError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    try {
      await fetch(`/api/upload/${id}`, { method: "DELETE" });
      await loadFiles();
    } catch (_error) {
      console.error("Failed to delete file:", err);
    }
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">File Upload</h1>
        <p className="text-neutral-600 dark:text-neutral-400 mt-1">Upload and manage files</p>
      </div>

      {error
        ? (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl text-sm mb-4">
            {error}
          </div>
        )
        : null}

      <div className="bg-white dark:bg-neutral-800 p-6 rounded-2xl border border-neutral-200 dark:border-neutral-700 mb-6">
        <label className="block">
          <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Select file to upload
          </span>
          <input
            type="file"
            onChange={handleUpload}
            disabled={uploading}
            className="mt-2 block w-full text-sm text-neutral-500 dark:text-neutral-400
              file:mr-4 file:py-2 file:px-4
              file:rounded-xl file:border-0
              file:text-sm file:font-medium
              file:bg-blue-500 file:text-white
              hover:file:bg-blue-600
              disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </label>
        {uploading
          ? <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-2">Uploading...</p>
          : null}
      </div>

      <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-white p-6 border-b border-neutral-200 dark:border-neutral-700">
          Uploaded Files
        </h2>

        {files.length === 0
          ? <p className="p-6 text-neutral-500 dark:text-neutral-400">No files uploaded yet</p>
          : (
            <ul className="divide-y divide-neutral-200 dark:divide-neutral-700">
              {files.map((file) => (
                <li key={file.id} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-neutral-900 dark:text-white">{file.filename}</p>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">
                      {formatSize(file.size)} - {file.mimeType}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <a
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 text-sm bg-neutral-100 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-600"
                    >
                      View
                    </a>
                    <button
                      type="button"
                      onClick={() =>
                        void handleDelete(file.id)}
                      className="px-3 py-1.5 text-sm bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}
