import { getAccessToken } from "./token-store.ts";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

export interface SharePointSite {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  webUrl: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  siteCollection?: {
    hostname: string;
  };
}

export interface SharePointDrive {
  id: string;
  name: string;
  description?: string;
  driveType: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  webUrl: string;
  quota?: {
    total: number;
    used: number;
    remaining: number;
  };
}

export interface SharePointFile {
  id: string;
  name: string;
  size: number;
  createdDateTime: string;
  lastModifiedDateTime: string;
  webUrl: string;
  file?: {
    mimeType: string;
    hashes?: {
      sha1Hash?: string;
      quickXorHash?: string;
    };
  };
  folder?: {
    childCount: number;
  };
  parentReference?: {
    driveId: string;
    id: string;
    path: string;
  };
  createdBy?: {
    user?: {
      displayName: string;
      email?: string;
    };
  };
  lastModifiedBy?: {
    user?: {
      displayName: string;
      email?: string;
    };
  };
}

interface GraphResponse<T> {
  value: T[];
  "@odata.nextLink"?: string;
}

async function requireAccessToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error("Not authenticated with Microsoft. Please connect your account.");
  return token;
}

async function graphFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = await requireAccessToken();

  const response = await fetch(`${GRAPH_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (response.ok) return response.json();

  const error = await response.json().catch(() => ({}));
  throw new Error(
    `Microsoft Graph API error: ${response.status} ${error.error?.message ?? response.statusText}`,
  );
}

export async function listSites(options?: {
  search?: string;
  limit?: number;
}): Promise<SharePointSite[]> {
  const endpoint = options?.search
    ? `/sites?search=${encodeURIComponent(options.search)}`
    : "/sites?search=*";

  const { value = [] } = await graphFetch<GraphResponse<SharePointSite>>(endpoint);
  return options?.limit ? value.slice(0, options.limit) : value;
}

export function getSite(siteId: string): Promise<SharePointSite> {
  return graphFetch<SharePointSite>(`/sites/${siteId}`);
}

export function getSiteByPath(hostname: string, sitePath: string): Promise<SharePointSite> {
  return graphFetch<SharePointSite>(`/sites/${hostname}:${sitePath}`);
}

export async function listDrives(siteId: string): Promise<SharePointDrive[]> {
  const { value = [] } = await graphFetch<GraphResponse<SharePointDrive>>(`/sites/${siteId}/drives`);
  return value;
}

export function getDefaultDrive(siteId: string): Promise<SharePointDrive> {
  return graphFetch<SharePointDrive>(`/sites/${siteId}/drive`);
}

export async function listFiles(
  siteId: string,
  driveId: string,
  folderId?: string,
  options?: {
    limit?: number;
    orderBy?: string;
  },
): Promise<SharePointFile[]> {
  const baseEndpoint = folderId
    ? `/sites/${siteId}/drives/${driveId}/items/${folderId}/children`
    : `/sites/${siteId}/drives/${driveId}/root/children`;

  const params = new URLSearchParams();
  if (options?.orderBy) params.set("$orderby", options.orderBy);
  if (options?.limit) params.set("$top", String(options.limit));

  const endpoint = params.size ? `${baseEndpoint}?${params.toString()}` : baseEndpoint;

  const { value = [] } = await graphFetch<GraphResponse<SharePointFile>>(endpoint);
  return value;
}

export function getFile(siteId: string, driveId: string, itemId: string): Promise<SharePointFile> {
  return graphFetch<SharePointFile>(`/sites/${siteId}/drives/${driveId}/items/${itemId}`);
}

export function getFileByPath(
  siteId: string,
  driveId: string,
  path: string,
): Promise<SharePointFile> {
  const encodedPath = encodeURIComponent(path);
  return graphFetch<SharePointFile>(`/sites/${siteId}/drives/${driveId}/root:/${encodedPath}`);
}

export async function downloadFile(
  siteId: string,
  driveId: string,
  itemId: string,
): Promise<ArrayBuffer> {
  const token = await requireAccessToken();

  await getFile(siteId, driveId, itemId);

  const response = await fetch(
    `${GRAPH_BASE_URL}/sites/${siteId}/drives/${driveId}/items/${itemId}/content`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!response.ok) throw new Error(`Failed to download file: ${response.statusText}`);

  return response.arrayBuffer();
}

export async function downloadFileAsText(
  siteId: string,
  driveId: string,
  itemId: string,
): Promise<string> {
  const buffer = await downloadFile(siteId, driveId, itemId);
  return new TextDecoder().decode(buffer);
}

export async function uploadFile(
  siteId: string,
  driveId: string,
  fileName: string,
  content: string | ArrayBuffer | Blob,
  folderId?: string,
): Promise<SharePointFile> {
  const token = await requireAccessToken();

  const encodedFileName = encodeURIComponent(fileName);
  const endpoint = folderId
    ? `/sites/${siteId}/drives/${driveId}/items/${folderId}:/${encodedFileName}:/content`
    : `/sites/${siteId}/drives/${driveId}/root:/${encodedFileName}:/content`;

  let body: ArrayBuffer;
  if (typeof content === "string") {
    body = new TextEncoder().encode(content);
  } else if (content instanceof Blob) {
    body = await content.arrayBuffer();
  } else {
    body = content;
  }

  const response = await fetch(`${GRAPH_BASE_URL}${endpoint}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
    },
    body,
  });

  if (response.ok) return response.json();

  const error = await response.json().catch(() => ({}));
  throw new Error(`Failed to upload file: ${error.error?.message ?? response.statusText}`);
}

export function createFolder(
  siteId: string,
  driveId: string,
  folderName: string,
  parentFolderId?: string,
): Promise<SharePointFile> {
  const endpoint = parentFolderId
    ? `/sites/${siteId}/drives/${driveId}/items/${parentFolderId}/children`
    : `/sites/${siteId}/drives/${driveId}/root/children`;

  return graphFetch<SharePointFile>(endpoint, {
    method: "POST",
    body: JSON.stringify({
      name: folderName,
      folder: {},
      "@microsoft.graph.conflictBehavior": "rename",
    }),
  });
}

export async function searchFiles(
  siteId: string,
  query: string,
  options?: {
    limit?: number;
  },
): Promise<SharePointFile[]> {
  const baseEndpoint = `/sites/${siteId}/drive/root/search(q='${encodeURIComponent(query)}')`;
  const endpoint = options?.limit ? `${baseEndpoint}?$top=${options.limit}` : baseEndpoint;

  const { value = [] } = await graphFetch<GraphResponse<SharePointFile>>(endpoint);
  return value;
}

export async function deleteItem(siteId: string, driveId: string, itemId: string): Promise<void> {
  await graphFetch<void>(`/sites/${siteId}/drives/${driveId}/items/${itemId}`, { method: "DELETE" });
}

export function moveItem(
  siteId: string,
  driveId: string,
  itemId: string,
  newParentId: string,
  newName?: string,
): Promise<SharePointFile> {
  const body: { parentReference: { id: string }; name?: string } = {
    parentReference: { id: newParentId },
    ...(newName ? { name: newName } : {}),
  };

  return graphFetch<SharePointFile>(`/sites/${siteId}/drives/${driveId}/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function copyItem(
  siteId: string,
  driveId: string,
  itemId: string,
  newParentId: string,
  newName?: string,
): Promise<void> {
  const body: { parentReference: { driveId: string; id: string }; name?: string } = {
    parentReference: { driveId, id: newParentId },
    ...(newName ? { name: newName } : {}),
  };

  await graphFetch<void>(`/sites/${siteId}/drives/${driveId}/items/${itemId}/copy`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
