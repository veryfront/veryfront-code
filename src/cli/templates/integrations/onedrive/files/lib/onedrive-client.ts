import { getAccessToken } from "./token-store.ts";

const GRAPH_API_URL = "https://graph.microsoft.com/v1.0";

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

async function onedriveFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with OneDrive. Please connect your account.");
  }

  const url = endpoint.startsWith("http") ? endpoint : `${GRAPH_API_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `OneDrive API error: ${response.status} ${error.error?.message || response.statusText}`,
    );
  }

  return response.json();
}


export function listFiles(
  folderId: string = "root",
  options?: {
    orderBy?: string;
    top?: number;
    select?: string[];
  },
): Promise<ListFilesResult> {
  const params = new URLSearchParams();

  if (options?.orderBy) {
    params.set("$orderby", options.orderBy);
  }
  if (options?.top) {
    params.set("$top", options.top.toString());
  }
  if (options?.select) {
    params.set("$select", options.select.join(","));
  }

  const queryString = params.toString();
  const endpoint = `/me/drive/items/${folderId}/children${queryString ? `?${queryString}` : ""}`;

  return onedriveFetch<ListFilesResult>(endpoint);
}

export function getFile(itemId: string): Promise<DriveItem> {
  return onedriveFetch<DriveItem>(`/me/drive/items/${itemId}`);
}

export async function downloadFile(itemId: string): Promise<{
  content: string;
  metadata: FileMetadata;
}> {
  const item = await getFile(itemId);

  if (!item.file) {
    throw new Error("Item is not a file");
  }

  const downloadUrl = item["@microsoft.graph.downloadUrl"];
  if (!downloadUrl) {
    throw new Error("Download URL not available");
  }

  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`);
  }

  const content = await response.text();

  const metadata: FileMetadata = {
    id: item.id,
    name: item.name,
    size: item.size || 0,
    mimeType: item.file.mimeType,
    createdDateTime: item.createdDateTime,
    lastModifiedDateTime: item.lastModifiedDateTime,
    webUrl: item.webUrl,
    downloadUrl,
  };

  return { content, metadata };
}

export async function uploadFile(
  fileName: string,
  content: string,
  parentFolderId: string = "root",
): Promise<DriveItem> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with OneDrive. Please connect your account.");
  }

  const endpoint = `${GRAPH_API_URL}/me/drive/items/${parentFolderId}:/${fileName}:/content`;

  const response = await fetch(endpoint, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
    },
    body: content,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Failed to upload file: ${error.error?.message || response.statusText}`,
    );
  }

  return response.json();
}

export function createFolder(
  folderName: string,
  parentFolderId: string = "root",
): Promise<DriveItem> {
  return onedriveFetch<DriveItem>(`/me/drive/items/${parentFolderId}/children`, {
    method: "POST",
    body: JSON.stringify({
      name: folderName,
      folder: {},
      "@microsoft.graph.conflictBehavior": "rename",
    }),
  });
}

export function searchFiles(
  query: string,
  options?: {
    top?: number;
  },
): Promise<SearchResult> {
  const params = new URLSearchParams({
    q: query,
  });

  if (options?.top) {
    params.set("$top", options.top.toString());
  }

  return onedriveFetch<SearchResult>(
    `/me/drive/root/search(q='${encodeURIComponent(query)}')?${params.toString()}`,
  );
}

export async function deleteFile(itemId: string): Promise<void> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with OneDrive. Please connect your account.");
  }

  const response = await fetch(`${GRAPH_API_URL}/me/drive/items/${itemId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Failed to delete item: ${error.error?.message || response.statusText}`,
    );
  }
}

export function moveFile(
  itemId: string,
  newParentId: string,
  newName?: string,
): Promise<DriveItem> {
  const body: Record<string, unknown> = {
    parentReference: {
      id: newParentId,
    },
  };

  if (newName) {
    body.name = newName;
  }

  return onedriveFetch<DriveItem>(`/me/drive/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}


export function formatFileSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

export function isFile(item: DriveItem): boolean {
  return item.file !== undefined;
}

export function isFolder(item: DriveItem): boolean {
  return item.folder !== undefined;
}
