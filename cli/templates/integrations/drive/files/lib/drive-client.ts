import { fetchOAuthJson, fetchOAuthText } from "./oauth.ts";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const MAX_UPLOAD_CONTENT_LENGTH = 10 * 1024 * 1024;

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  kind: string;
  createdTime: string;
  modifiedTime: string;
  size?: string;
  webViewLink?: string;
  webContentLink?: string;
  iconLink?: string;
  thumbnailLink?: string;
  parents?: string[];
  starred?: boolean;
  trashed?: boolean;
  shared?: boolean;
  owners?: Array<{
    displayName: string;
    emailAddress: string;
    photoLink?: string;
  }>;
  lastModifyingUser?: {
    displayName: string;
    emailAddress: string;
    photoLink?: string;
  };
  capabilities?: {
    canEdit?: boolean;
    canComment?: boolean;
    canShare?: boolean;
    canDelete?: boolean;
    canDownload?: boolean;
  };
}

export interface DriveFileList {
  files: DriveFile[];
  nextPageToken?: string;
  incompleteSearch?: boolean;
}

export interface CreateFolderOptions {
  name: string;
  parentId?: string;
  description?: string;
}

export interface UploadFileOptions {
  name: string;
  content: string;
  mimeType: string;
  parentId?: string;
  description?: string;
}

export interface ListFilesOptions {
  folderId?: string;
  pageSize?: number;
  pageToken?: string;
  orderBy?: string;
  query?: string;
}

export interface SearchFilesOptions {
  query: string;
  pageSize?: number;
  pageToken?: string;
  orderBy?: string;
}

export function createDriveClient(userId: string): {
  listFiles(options?: ListFilesOptions): Promise<DriveFileList>;
  getFile(fileId: string): Promise<DriveFile>;
  searchFiles(options: SearchFilesOptions): Promise<DriveFileList>;
  createFolder(options: CreateFolderOptions): Promise<DriveFile>;
  uploadFile(options: UploadFileOptions): Promise<DriveFile>;
  downloadFile(fileId: string): Promise<string>;
  deleteFile(fileId: string): Promise<void>;
  copyFile(fileId: string, name: string, parentId?: string): Promise<DriveFile>;
  updateFile(
    fileId: string,
    updates: { name?: string; description?: string; starred?: boolean },
  ): Promise<DriveFile>;
} {
  function driveApiRequest<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    return fetchOAuthJson<T>(userId, "drive", `${DRIVE_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  }

  function buildMetadata(options: {
    name: string;
    mimeType: string;
    parentId?: string;
    description?: string;
  }): Record<string, unknown> {
    const metadata: Record<string, unknown> = {
      name: options.name,
      mimeType: options.mimeType,
    };

    if (options.parentId) metadata.parents = [options.parentId];
    if (options.description) metadata.description = options.description;

    return metadata;
  }

  const fileFields =
    "id,name,mimeType,kind,createdTime,modifiedTime,size,webViewLink,webContentLink,iconLink,thumbnailLink,parents,starred,trashed,shared,owners,lastModifyingUser,capabilities";

  return {
    listFiles(options: ListFilesOptions = {}): Promise<DriveFileList> {
      const params = new URLSearchParams({
        fields: `nextPageToken,incompleteSearch,files(${fileFields})`,
        pageSize: String(options.pageSize ?? 100),
        orderBy: options.orderBy ?? "modifiedTime desc",
      });

      let query = "trashed=false";
      if (options.folderId) query += ` and '${options.folderId}' in parents`;
      if (options.query) query += ` and ${options.query}`;

      params.append("q", query);
      if (options.pageToken) params.append("pageToken", options.pageToken);

      return driveApiRequest<DriveFileList>(`/files?${params.toString()}`);
    },

    getFile(fileId: string): Promise<DriveFile> {
      const params = new URLSearchParams({ fields: fileFields });
      return driveApiRequest<DriveFile>(
        `/files/${fileId}?${params.toString()}`,
      );
    },

    searchFiles(options: SearchFilesOptions): Promise<DriveFileList> {
      const params = new URLSearchParams({
        fields:
          "nextPageToken,incompleteSearch,files(id,name,mimeType,kind,createdTime,modifiedTime,size,webViewLink,webContentLink,iconLink,thumbnailLink,parents,starred,trashed)",
        pageSize: String(options.pageSize ?? 100),
        q: `${options.query} and trashed=false`,
        orderBy: options.orderBy ?? "modifiedTime desc",
      });

      if (options.pageToken) params.append("pageToken", options.pageToken);

      return driveApiRequest<DriveFileList>(`/files?${params.toString()}`);
    },

    createFolder(options: CreateFolderOptions): Promise<DriveFile> {
      const metadata = buildMetadata({
        name: options.name,
        mimeType: "application/vnd.google-apps.folder",
        parentId: options.parentId,
        description: options.description,
      });

      return driveApiRequest<DriveFile>("/files", {
        method: "POST",
        body: JSON.stringify(metadata),
      });
    },

    async uploadFile(options: UploadFileOptions): Promise<DriveFile> {
      if (options.content.length > MAX_UPLOAD_CONTENT_LENGTH) {
        throw new RangeError(
          `Upload content exceeds ${MAX_UPLOAD_CONTENT_LENGTH} characters`,
        );
      }

      const boundary = "-------314159265358979323846";
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelimiter = `\r\n--${boundary}--`;

      const metadata = buildMetadata({
        name: options.name,
        mimeType: options.mimeType,
        parentId: options.parentId,
        description: options.description,
      });

      const multipartRequestBody = delimiter +
        "Content-Type: application/json\r\n\r\n" +
        JSON.stringify(metadata) +
        delimiter +
        `Content-Type: ${options.mimeType}\r\n\r\n` +
        options.content +
        closeDelimiter;

      return await fetchOAuthJson<DriveFile>(
        userId,
        "drive",
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,kind,createdTime,modifiedTime,size,webViewLink,webContentLink",
        {
          method: "POST",
          headers: {
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body: multipartRequestBody,
        },
      );
    },

    downloadFile(fileId: string): Promise<string> {
      return fetchOAuthText(
        userId,
        "drive",
        `${DRIVE_API_BASE}/files/${fileId}?alt=media`,
        {},
        10 * 1024 * 1024,
      );
    },

    async deleteFile(fileId: string): Promise<void> {
      await driveApiRequest(`/files/${fileId}`, { method: "DELETE" });
    },

    copyFile(
      fileId: string,
      name: string,
      parentId?: string,
    ): Promise<DriveFile> {
      const metadata: Record<string, unknown> = { name };
      if (parentId) metadata.parents = [parentId];

      return driveApiRequest<DriveFile>(`/files/${fileId}/copy`, {
        method: "POST",
        body: JSON.stringify(metadata),
      });
    },

    updateFile(
      fileId: string,
      updates: { name?: string; description?: string; starred?: boolean },
    ): Promise<DriveFile> {
      return driveApiRequest<DriveFile>(`/files/${fileId}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
    },
  };
}

export type DriveClient = ReturnType<typeof createDriveClient>;
