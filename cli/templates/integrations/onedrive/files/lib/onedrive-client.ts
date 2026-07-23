import { fetchExternalBytes, fetchOAuthJson } from "./oauth.ts";

const GRAPH_API_URL = "https://graph.microsoft.com/v1.0";
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface DriveItem {
  id: string;
  name: string;
  size?: number;
  createdDateTime: string;
  lastModifiedDateTime: string;
  webUrl: string;
  parentReference?: {
    driveId: string;
    id: string;
    path: string;
  };
  file?: {
    mimeType: string;
    hashes?: {
      quickXorHash?: string;
      sha1Hash?: string;
      sha256Hash?: string;
    };
  };
  folder?: {
    childCount: number;
  };
  "@microsoft.graph.downloadUrl"?: string;
}

export interface FileMetadata {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  webUrl: string;
  downloadUrl?: string;
}

export interface FolderMetadata {
  id: string;
  name: string;
  childCount: number;
  createdDateTime: string;
  lastModifiedDateTime: string;
  webUrl: string;
}

export interface ListFilesResult {
  value: DriveItem[];
  "@odata.nextLink"?: string;
}

export interface SearchResult {
  value: DriveItem[];
  "@odata.nextLink"?: string;
}

export function createOneDriveClient(userId: string) {
  function onedriveFetch<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = endpoint.startsWith("http")
      ? endpoint
      : `${GRAPH_API_URL}${endpoint}`;

    return fetchOAuthJson<T>(userId, "onedrive", url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  }

  function listFiles(
    folderId: string = "root",
    options?: {
      orderBy?: string;
      top?: number;
      select?: string[];
    },
  ): Promise<ListFilesResult> {
    const params = new URLSearchParams();

    if (options?.orderBy) params.set("$orderby", options.orderBy);
    if (options?.top) params.set("$top", options.top.toString());
    if (options?.select?.length) {
      params.set("$select", options.select.join(","));
    }

    const queryString = params.toString();
    const endpoint = `/me/drive/items/${folderId}/children${
      queryString ? `?${queryString}` : ""
    }`;

    return onedriveFetch<ListFilesResult>(endpoint);
  }

  function getFile(itemId: string): Promise<DriveItem> {
    return onedriveFetch<DriveItem>(`/me/drive/items/${itemId}`);
  }

  async function downloadFile(itemId: string): Promise<{
    content: string;
    metadata: FileMetadata;
  }> {
    const item = await getFile(itemId);

    if (!item.file) throw new Error("Item is not a file");

    const downloadUrl = item["@microsoft.graph.downloadUrl"];
    if (!downloadUrl) throw new Error("Download URL not available");

    const content = new TextDecoder().decode(
      await fetchExternalBytes(downloadUrl, {}, MAX_FILE_BYTES),
    );

    return {
      content,
      metadata: {
        id: item.id,
        name: item.name,
        size: item.size ?? 0,
        mimeType: item.file.mimeType,
        createdDateTime: item.createdDateTime,
        lastModifiedDateTime: item.lastModifiedDateTime,
        webUrl: item.webUrl,
        downloadUrl,
      },
    };
  }

  async function uploadFile(
    fileName: string,
    content: string,
    parentFolderId: string = "root",
  ): Promise<DriveItem> {
    if (new TextEncoder().encode(content).byteLength > MAX_FILE_BYTES) {
      throw new RangeError(`Upload exceeds ${MAX_FILE_BYTES} bytes`);
    }
    const endpoint = `${GRAPH_API_URL}/me/drive/items/${parentFolderId}:/${
      encodeURIComponent(fileName)
    }:/content`;

    return await fetchOAuthJson<DriveItem>(userId, "onedrive", endpoint, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
      },
      body: content,
    });
  }

  function createFolder(
    folderName: string,
    parentFolderId: string = "root",
  ): Promise<DriveItem> {
    return onedriveFetch<DriveItem>(
      `/me/drive/items/${parentFolderId}/children`,
      {
        method: "POST",
        body: JSON.stringify({
          name: folderName,
          folder: {},
          "@microsoft.graph.conflictBehavior": "rename",
        }),
      },
    );
  }

  function searchFiles(
    query: string,
    options?: {
      top?: number;
    },
  ): Promise<SearchResult> {
    const params = new URLSearchParams({ q: query });
    if (options?.top) params.set("$top", options.top.toString());

    return onedriveFetch<SearchResult>(
      `/me/drive/root/search(q='${
        encodeURIComponent(query)
      }')?${params.toString()}`,
    );
  }

  async function deleteFile(itemId: string): Promise<void> {
    await fetchOAuthJson<void>(
      userId,
      "onedrive",
      `${GRAPH_API_URL}/me/drive/items/${itemId}`,
      { method: "DELETE" },
    );
  }

  function moveFile(
    itemId: string,
    newParentId: string,
    newName?: string,
  ): Promise<DriveItem> {
    const body: Record<string, unknown> = {
      parentReference: { id: newParentId },
      ...(newName ? { name: newName } : {}),
    };

    return onedriveFetch<DriveItem>(`/me/drive/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  function formatFileSize(bytes: number): string {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  function isFile(item: DriveItem): boolean {
    return item.file !== undefined;
  }

  function isFolder(item: DriveItem): boolean {
    return item.folder !== undefined;
  }

  return {
    listFiles,
    getFile,
    downloadFile,
    uploadFile,
    createFolder,
    searchFiles,
    deleteFile,
    moveFile,
    formatFileSize,
    isFile,
    isFolder,
  };
}
