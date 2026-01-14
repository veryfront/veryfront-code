import { useEffect, useState } from "react";
import type { FileItem } from "../App.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { Card } from "./Card.tsx";
import { DetailHeader, ErrorState, formatSize, LoadingState, TwoColumnLayout } from "./shared.tsx";

export function FilesTab() {
  const [currentPath, setCurrentPath] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadFiles(currentPath);
  }, [currentPath]);

  async function loadFiles(path: string) {
    setLoading(true);
    try {
      const res = await fetch(`/_dev/api/files?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      setFiles(data.files || []);
    } catch (e) {
      console.error("Failed to load files:", e);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }

  const filteredFiles = search
    ? files.filter((f) => f.name.toLowerCase().includes(search.toLowerCase()))
    : files;

  function handleSelect(id: string) {
    const file = files.find((f) => f.path === id);
    if (!file) return;

    if (file.type === "directory") {
      setCurrentPath(file.path);
      setSelectedFile(null);
      setSearch("");
    } else {
      setSelectedFile(file.path);
    }
  }

  function handleBack() {
    setCurrentPath(currentPath.split("/").slice(0, -1).join("/"));
    setSelectedFile(null);
  }

  const sidebar = (
    <Sidebar
      search={search}
      onSearchChange={setSearch}
      items={filteredFiles.map((f) => ({
        id: f.path,
        label: f.type === "directory" ? `${f.name}/` : f.name,
        bold: f.type === "directory",
      }))}
      selectedId={selectedFile}
      onSelect={handleSelect}
      emptyMessage={loading ? "Loading..." : "No files found"}
      onBack={currentPath && !search ? handleBack : undefined}
    />
  );

  return (
    <TwoColumnLayout sidebar={sidebar}>
      {selectedFile
        ? <FileDetail path={selectedFile} />
        : <DirectoryInfo path={currentPath} fileCount={files.length} />}
    </TwoColumnLayout>
  );
}

function DirectoryInfo({ path, fileCount }: { path: string; fileCount: number }) {
  return (
    <div>
      <DetailHeader title={path || "Project Root"} description={`${fileCount} items`} />
      <Card>
        <div className="p-4 text-sm text-gray-400">Select a file to view its contents</div>
      </Card>
    </div>
  );
}

interface FileContent {
  content?: string;
  lines?: number;
  size?: number;
  isBinary?: boolean;
  message?: string;
  error?: string;
}

function FileDetail({ path }: { path: string }) {
  const [content, setContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(true);

  const filename = path.split("/").pop() || "";
  const ext = path.split(".").pop()?.toLowerCase() || "";

  useEffect(() => {
    setLoading(true);
    fetch(`/_dev/api/file-content?path=${encodeURIComponent(path)}`)
      .then((res) => res.json())
      .then(setContent)
      .catch((e) => setContent({ error: (e as Error).message }))
      .finally(() => setLoading(false));
  }, [path]);

  return (
    <div>
      <DetailHeader title={filename} description={path} />

      <Card title="File Info" className="mb-4">
        <table className="w-full text-sm">
          <tbody>
            <tr className="border-b">
              <td className="px-3 py-2.5 w-24 font-medium text-gray-600">Path</td>
              <td className="px-3 py-2.5 text-gray-900">{path}</td>
            </tr>
            <tr className="border-b">
              <td className="px-3 py-2.5 font-medium text-gray-600">Extension</td>
              <td className="px-3 py-2.5 text-gray-900">{ext}</td>
            </tr>
            {content?.lines && (
              <tr className="border-b">
                <td className="px-3 py-2.5 font-medium text-gray-600">Lines</td>
                <td className="px-3 py-2.5 text-gray-900">{content.lines}</td>
              </tr>
            )}
            {content?.size && (
              <tr>
                <td className="px-3 py-2.5 font-medium text-gray-600">Size</td>
                <td className="px-3 py-2.5 text-gray-900">{formatSize(content.size)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <Card
        title={loading ? undefined : content?.content !== undefined ? "Contents" : undefined}
        titleRight={content?.lines
          ? <span className="text-[11px] text-gray-400 font-normal">{content.lines} lines</span>
          : undefined}
      >
        {loading
          ? <LoadingState message="Loading file contents..." />
          : content?.error
          ? <ErrorState error={content.error} />
          : content?.isBinary
          ? <div className="p-4 text-sm text-gray-400">{content.message}</div>
          : content?.content !== undefined
          ? (
            <pre className="p-3 text-xs font-mono text-gray-600 overflow-auto max-h-[500px] whitespace-pre-wrap bg-gray-50">{content.content}</pre>
          )
          : null}
      </Card>
    </div>
  );
}
