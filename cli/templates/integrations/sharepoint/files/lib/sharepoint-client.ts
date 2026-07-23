import { fetchExternalBytes, fetchOAuthJson } from "./oauth.ts";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const MAX_FILE_BYTES = 10 * 1024 * 1024;

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
  "@microsoft.graph.downloadUrl"?: string;
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

export function createSharePointClient(userId: string) {
  function graphFetch<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    return fetchOAuthJson<T>(
      userId,
      "sharepoint",
      `${GRAPH_BASE_URL}${endpoint}`,
      {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers ?? {}),
        },
      },
    );
  }

  async function listSites(options?: {
    search?: string;
    limit?: number;
  }): Promise<SharePointSite[]> {
    const endpoint = options?.search
      ? `/sites?search=${encodeURIComponent(options.search)}`
      : "/sites?search=*";

    const { value = [] } = await graphFetch<GraphResponse<SharePointSite>>(
      endpoint,
    );
    return options?.limit ? value.slice(0, options.limit) : value;
  }

  function getSite(siteId: string): Promise<SharePointSite> {
    return graphFetch<SharePointSite>(`/sites/${siteId}`);
  }

  function getSiteByPath(
    hostname: string,
    sitePath: string,
  ): Promise<SharePointSite> {
    return graphFetch<SharePointSite>(`/sites/${hostname}:${sitePath}`);
  }

  async function listDrives(siteId: string): Promise<SharePointDrive[]> {
    const { value = [] } = await graphFetch<GraphResponse<SharePointDrive>>(
      `/sites/${siteId}/drives`,
    );
    return value;
  }

  function getDefaultDrive(siteId: string): Promise<SharePointDrive> {
    return graphFetch<SharePointDrive>(`/sites/${siteId}/drive`);
  }

  async function listFiles(
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

    const endpoint = params.size
      ? `${baseEndpoint}?${params.toString()}`
      : baseEndpoint;

    const { value = [] } = await graphFetch<GraphResponse<SharePointFile>>(
      endpoint,
    );
    return value;
  }

  function getFile(
    siteId: string,
    driveId: string,
    itemId: string,
  ): Promise<SharePointFile> {
    return graphFetch<SharePointFile>(
      `/sites/${siteId}/drives/${driveId}/items/${itemId}`,
    );
  }

  function getFileByPath(
    siteId: string,
    driveId: string,
    path: string,
  ): Promise<SharePointFile> {
    const encodedPath = encodeURIComponent(path);
    return graphFetch<SharePointFile>(
      `/sites/${siteId}/drives/${driveId}/root:/${encodedPath}`,
    );
  }

  async function downloadFile(
    siteId: string,
    driveId: string,
    itemId: string,
  ): Promise<ArrayBuffer> {
    const file = await getFile(siteId, driveId, itemId);
    const downloadUrl = file["@microsoft.graph.downloadUrl"];
    if (!downloadUrl) throw new Error("SharePoint download URL is unavailable");
    const bytes = await fetchExternalBytes(
      downloadUrl,
      {},
      MAX_FILE_BYTES,
    );
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
  }

  async function downloadFileAsText(
    siteId: string,
    driveId: string,
    itemId: string,
  ): Promise<string> {
    const buffer = await downloadFile(siteId, driveId, itemId);
    return new TextDecoder().decode(buffer);
  }

  async function uploadFile(
    siteId: string,
    driveId: string,
    fileName: string,
    content: string | ArrayBuffer | Blob,
    folderId?: string,
  ): Promise<SharePointFile> {
    const encodedFileName = encodeURIComponent(fileName);
    const endpoint = folderId
      ? `/sites/${siteId}/drives/${driveId}/items/${folderId}:/${encodedFileName}:/content`
      : `/sites/${siteId}/drives/${driveId}/root:/${encodedFileName}:/content`;

    let body: BodyInit;
    if (typeof content === "string") {
      if (new TextEncoder().encode(content).byteLength > MAX_FILE_BYTES) {
        throw new RangeError(`Upload exceeds ${MAX_FILE_BYTES} bytes`);
      }
      body = content;
    } else if (content instanceof Blob) {
      if (content.size > MAX_FILE_BYTES) {
        throw new RangeError(`Upload exceeds ${MAX_FILE_BYTES} bytes`);
      }
      body = await content.arrayBuffer();
    } else {
      if (content.byteLength > MAX_FILE_BYTES) {
        throw new RangeError(`Upload exceeds ${MAX_FILE_BYTES} bytes`);
      }
      body = content;
    }

    return await fetchOAuthJson<SharePointFile>(
      userId,
      "sharepoint",
      `${GRAPH_BASE_URL}${endpoint}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
        },
        body,
      },
    );
  }

  function createFolder(
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

  async function searchFiles(
    siteId: string,
    query: string,
    options?: {
      limit?: number;
    },
  ): Promise<SharePointFile[]> {
    const baseEndpoint = `/sites/${siteId}/drive/root/search(q='${
      encodeURIComponent(query)
    }')`;
    const endpoint = options?.limit
      ? `${baseEndpoint}?$top=${options.limit}`
      : baseEndpoint;

    const { value = [] } = await graphFetch<GraphResponse<SharePointFile>>(
      endpoint,
    );
    return value;
  }

  async function deleteItem(
    siteId: string,
    driveId: string,
    itemId: string,
  ): Promise<void> {
    await graphFetch<void>(
      `/sites/${siteId}/drives/${driveId}/items/${itemId}`,
      { method: "DELETE" },
    );
  }

  function moveItem(
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

    return graphFetch<SharePointFile>(
      `/sites/${siteId}/drives/${driveId}/items/${itemId}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      },
    );
  }

  async function copyItem(
    siteId: string,
    driveId: string,
    itemId: string,
    newParentId: string,
    newName?: string,
  ): Promise<void> {
    const body: {
      parentReference: { driveId: string; id: string };
      name?: string;
    } = {
      parentReference: { driveId, id: newParentId },
      ...(newName ? { name: newName } : {}),
    };

    await graphFetch<void>(
      `/sites/${siteId}/drives/${driveId}/items/${itemId}/copy`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
  }

  return {
    listSites,
    getSite,
    getSiteByPath,
    listDrives,
    getDefaultDrive,
    listFiles,
    getFile,
    getFileByPath,
    downloadFile,
    downloadFileAsText,
    uploadFile,
    createFolder,
    searchFiles,
    deleteItem,
    moveItem,
    copyItem,
  };
}
