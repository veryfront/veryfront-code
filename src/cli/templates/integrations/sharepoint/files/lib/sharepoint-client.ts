import { getAccessToken } from "./token-store.ts";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

// Type definitions for SharePoint responses
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

async function graphFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Microsoft. Please connect your account.");
  }

  const response = await fetch(`${GRAPH_BASE_URL}${endpoint}`, {
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
      `Microsoft Graph API error: ${response.status} ${
        error.error?.message || response.statusText
      }`,
    );
  }

  return response.json();
}

/**
 * List all SharePoint sites the user has access to
 */
export async function listSites(options?: {
  search?: string;
  limit?: number;
}): Promise<SharePointSite[]> {
  let endpoint = "/sites?search=*";

  if (options?.search) {
    endpoint = `/sites?search=${encodeURIComponent(options.search)}`;
  }

  const response = await graphFetch<GraphResponse<SharePointSite>>(endpoint);
  const sites = response.value || [];

  if (options?.limit) {
    return sites.slice(0, options.limit);
  }

  return sites;
}

/**
 * Get details about a specific SharePoint site
 */
export async function getSite(siteId: string): Promise<SharePointSite> {
  return graphFetch<SharePointSite>(`/sites/${siteId}`);
}

/**
 * Get a site by hostname and path
 */
export async function getSiteByPath(
  hostname: string,
  sitePath: string,
): Promise<SharePointSite> {
  return graphFetch<SharePointSite>(
    `/sites/${hostname}:${sitePath}`,
  );
}

/**
 * List all document libraries (drives) in a site
 */
export async function listDrives(siteId: string): Promise<SharePointDrive[]> {
  const response = await graphFetch<GraphResponse<SharePointDrive>>(
    `/sites/${siteId}/drives`,
  );
  return response.value || [];
}

/**
 * Get the default document library for a site
 */
export async function getDefaultDrive(siteId: string): Promise<SharePointDrive> {
  return graphFetch<SharePointDrive>(`/sites/${siteId}/drive`);
}

/**
 * List files and folders in a drive or folder
 */
export async function listFiles(
  siteId: string,
  driveId: string,
  folderId?: string,
  options?: {
    limit?: number;
    orderBy?: string;
  },
): Promise<SharePointFile[]> {
  let endpoint = folderId
    ? `/sites/${siteId}/drives/${driveId}/items/${folderId}/children`
    : `/sites/${siteId}/drives/${driveId}/root/children`;

  if (options?.orderBy) {
    endpoint += `?$orderby=${options.orderBy}`;
  }

  if (options?.limit) {
    endpoint += `${options.orderBy ? "&" : "?"}$top=${options.limit}`;
  }

  const response = await graphFetch<GraphResponse<SharePointFile>>(endpoint);
  return response.value || [];
}

/**
 * Get file metadata
 */
export async function getFile(
  siteId: string,
  driveId: string,
  itemId: string,
): Promise<SharePointFile> {
  return graphFetch<SharePointFile>(
    `/sites/${siteId}/drives/${driveId}/items/${itemId}`,
  );
}

/**
 * Get file by path
 */
export async function getFileByPath(
  siteId: string,
  driveId: string,
  path: string,
): Promise<SharePointFile> {
  const encodedPath = encodeURIComponent(path);
  return graphFetch<SharePointFile>(
    `/sites/${siteId}/drives/${driveId}/root:/${encodedPath}`,
  );
}

/**
 * Download file content
 */
export async function downloadFile(
  siteId: string,
  driveId: string,
  itemId: string,
): Promise<ArrayBuffer> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Microsoft. Please connect your account.");
  }

  const metadata = await getFile(siteId, driveId, itemId);

  // Get download URL
  const downloadUrl = `${GRAPH_BASE_URL}/sites/${siteId}/drives/${driveId}/items/${itemId}/content`;

  const response = await fetch(downloadUrl, {
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`);
  }

  return response.arrayBuffer();
}

/**
 * Download file content as text
 */
export async function downloadFileAsText(
  siteId: string,
  driveId: string,
  itemId: string,
): Promise<string> {
  const buffer = await downloadFile(siteId, driveId, itemId);
  return new TextDecoder().decode(buffer);
}

/**
 * Upload a file to a folder
 */
export async function uploadFile(
  siteId: string,
  driveId: string,
  fileName: string,
  content: string | ArrayBuffer | Blob,
  folderId?: string,
): Promise<SharePointFile> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Microsoft. Please connect your account.");
  }

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
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
    },
    body,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Failed to upload file: ${error.error?.message || response.statusText}`,
    );
  }

  return response.json();
}

/**
 * Create a folder
 */
export async function createFolder(
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

/**
 * Search for files in a site
 */
export async function searchFiles(
  siteId: string,
  query: string,
  options?: {
    limit?: number;
  },
): Promise<SharePointFile[]> {
  let endpoint = `/sites/${siteId}/drive/root/search(q='${encodeURIComponent(query)}')`;

  if (options?.limit) {
    endpoint += `?$top=${options.limit}`;
  }

  const response = await graphFetch<GraphResponse<SharePointFile>>(endpoint);
  return response.value || [];
}

/**
 * Delete a file or folder
 */
export async function deleteItem(
  siteId: string,
  driveId: string,
  itemId: string,
): Promise<void> {
  await graphFetch<void>(
    `/sites/${siteId}/drives/${driveId}/items/${itemId}`,
    { method: "DELETE" },
  );
}

/**
 * Move or rename a file or folder
 */
export async function moveItem(
  siteId: string,
  driveId: string,
  itemId: string,
  newParentId: string,
  newName?: string,
): Promise<SharePointFile> {
  const body: { parentReference: { id: string }; name?: string } = {
    parentReference: { id: newParentId },
  };

  if (newName) {
    body.name = newName;
  }

  return graphFetch<SharePointFile>(
    `/sites/${siteId}/drives/${driveId}/items/${itemId}`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
    },
  );
}

/**
 * Copy a file or folder
 */
export async function copyItem(
  siteId: string,
  driveId: string,
  itemId: string,
  newParentId: string,
  newName?: string,
): Promise<void> {
  const body: { parentReference: { driveId: string; id: string }; name?: string } = {
    parentReference: { driveId, id: newParentId },
  };

  if (newName) {
    body.name = newName;
  }

  // Copy is async, returns 202 Accepted with a Location header
  await graphFetch<void>(
    `/sites/${siteId}/drives/${driveId}/items/${itemId}/copy`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}
