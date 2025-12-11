import { getAccessToken } from "./token-store.ts";

const BOX_BASE_URL = "https://api.box.com/2.0";

interface BoxItemCollection<T> {
  total_count: number;
  entries: T[];
  offset: number;
  limit: number;
}

interface BoxFile {
  id: string;
  type: "file";
  name: string;
  size: number;
  created_at: string;
  modified_at: string;
  description: string;
  path_collection: {
    entries: Array<{ id: string; name: string }>;
  };
  created_by: {
    id: string;
    name: string;
  };
  modified_by: {
    id: string;
    name: string;
  };
  shared_link?: {
    url: string;
  };
}

interface BoxFolder {
  id: string;
  type: "folder";
  name: string;
  created_at: string;
  modified_at: string;
  description: string;
  path_collection: {
    entries: Array<{ id: string; name: string }>;
  };
  created_by: {
    id: string;
    name: string;
  };
  modified_by: {
    id: string;
    name: string;
  };
  item_collection?: {
    total_count: number;
  };
}

type BoxItem = BoxFile | BoxFolder;

interface BoxSearchResult {
  type: "file" | "folder";
  id: string;
  name: string;
  size?: number;
  created_at: string;
  modified_at: string;
  path_collection: {
    entries: Array<{ id: string; name: string }>;
  };
}

async function boxFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Box. Please connect your account.");
  }

  const response = await fetch(`${BOX_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Box API error: ${response.status} ${error.message || response.statusText}`,
    );
  }

  return response.json();
}

export async function listFiles(options: {
  folderId?: string;
  limit?: number;
  offset?: number;
}): Promise<BoxItem[]> {
  const { folderId = "0", limit = 100, offset = 0 } = options;

  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString(),
    fields: "id,type,name,size,created_at,modified_at,description,path_collection,created_by,modified_by",
  });

  const response = await boxFetch<BoxItemCollection<BoxItem>>(
    `/folders/${folderId}/items?${params}`,
  );

  return response.entries;
}

export async function getFile(itemId: string, itemType: "file" | "folder" = "file"): Promise<BoxItem> {
  const endpoint = itemType === "file" ? `/files/${itemId}` : `/folders/${itemId}`;
  const params = new URLSearchParams({
    fields: "id,type,name,size,created_at,modified_at,description,path_collection,created_by,modified_by,shared_link",
  });

  return await boxFetch<BoxItem>(`${endpoint}?${params}`);
}

export async function uploadFile(options: {
  parentFolderId: string;
  fileName: string;
  fileContent: string | Buffer | Blob;
}): Promise<BoxFile> {
  const { parentFolderId, fileName, fileContent } = options;

  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Box. Please connect your account.");
  }

  const formData = new FormData();
  const attributes = JSON.stringify({
    name: fileName,
    parent: { id: parentFolderId },
  });

  formData.append("attributes", attributes);

  const blob = typeof fileContent === "string"
    ? new Blob([fileContent], { type: "text/plain" })
    : fileContent instanceof Buffer
    ? new Blob([fileContent])
    : fileContent;

  formData.append("file", blob, fileName);

  const response = await fetch("https://upload.box.com/api/2.0/files/content", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Box upload error: ${response.status} ${error.message || response.statusText}`,
    );
  }

  const result = await response.json();
  return result.entries[0];
}

export async function downloadFile(fileId: string): Promise<{
  content: ArrayBuffer;
  fileName: string;
  mimeType: string;
}> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Box. Please connect your account.");
  }

  const fileInfo = await getFile(fileId, "file") as BoxFile;

  const response = await fetch(`${BOX_BASE_URL}/files/${fileId}/content`, {
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Box download error: ${response.status} ${error.message || response.statusText}`,
    );
  }

  const content = await response.arrayBuffer();
  const mimeType = response.headers.get("content-type") || "application/octet-stream";

  return {
    content,
    fileName: fileInfo.name,
    mimeType,
  };
}

export async function createFolder(options: {
  parentFolderId: string;
  name: string;
}): Promise<BoxFolder> {
  const { parentFolderId, name } = options;

  const response = await boxFetch<BoxFolder>("/folders", {
    method: "POST",
    body: JSON.stringify({
      name,
      parent: { id: parentFolderId },
    }),
  });

  return response;
}

export async function searchFiles(options: {
  query: string;
  limit?: number;
  offset?: number;
  contentTypes?: string[];
}): Promise<BoxSearchResult[]> {
  const { query, limit = 100, offset = 0, contentTypes } = options;

  const params = new URLSearchParams({
    query,
    limit: limit.toString(),
    offset: offset.toString(),
    fields: "id,type,name,size,created_at,modified_at,path_collection",
  });

  if (contentTypes && contentTypes.length > 0) {
    params.set("content_types", contentTypes.join(","));
  }

  const response = await boxFetch<BoxItemCollection<BoxSearchResult>>(
    `/search?${params}`,
  );

  return response.entries;
}

export async function getMe(): Promise<{ id: string; name: string; login: string }> {
  return await boxFetch<{ id: string; name: string; login: string }>("/users/me");
}
