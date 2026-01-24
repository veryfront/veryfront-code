/**
 * Google Drive API Client
 *
 * Provides a type-safe interface to Google Drive API operations.
 */

import { getValidToken } from "./oauth.ts";

// Helper for Cross-Platform environment access
function getEnv(key: string): string | undefined {
  // @ts-ignore - Deno global
  if (typeof Deno !== "undefined") return Deno.env.get(key);
  // @ts-ignore - process global
  if (typeof process !== "undefined" && process.env) return process.env[key];
  return undefined;
}

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";

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

/**
 * Google Drive OAuth provider configuration
 */
export const driveOAuthProvider = {
  name: "drive",
  authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  clientId: getEnv("GOOGLE_CLIENT_ID") ?? "",
  clientSecret: getEnv("GOOGLE_CLIENT_SECRET") ?? "",
  scopes: [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
  ],
  callbackPath: "/api/auth/drive/callback",
};

/**
 * Create a Drive client for a specific user
 */
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
  async function getAccessToken(): Promise<string> {
    const token = await getValidToken(driveOAuthProvider, userId, "drive");
    if (!token) {
      throw new Error("Google Drive not connected. Please connect your Google account first.");
    }
    return token;
  }

  async function driveApiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const accessToken = await getAccessToken();

    const response = await fetch(`${DRIVE_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Drive API error: ${response.status} - ${error}`);
    }

    return response.json();
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

  return {
    /**
     * List files in a folder (or root if no folderId provided)
     */
    async listFiles(options: ListFilesOptions = {}): Promise<DriveFileList> {
      const params = new URLSearchParams({
        fields:
          "nextPageToken,incompleteSearch,files(id,name,mimeType,kind,createdTime,modifiedTime,size,webViewLink,webContentLink,iconLink,thumbnailLink,parents,starred,trashed,shared,owners,lastModifyingUser,capabilities)",
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

    /**
     * Get metadata about a specific file
     */
    async getFile(fileId: string): Promise<DriveFile> {
      const params = new URLSearchParams({
        fields:
          "id,name,mimeType,kind,createdTime,modifiedTime,size,webViewLink,webContentLink,iconLink,thumbnailLink,parents,starred,trashed,shared,owners,lastModifyingUser,capabilities",
      });

      return driveApiRequest<DriveFile>(`/files/${fileId}?${params.toString()}`);
    },

    /**
     * Search for files using Drive query syntax
     */
    async searchFiles(options: SearchFilesOptions): Promise<DriveFileList> {
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

    /**
     * Create a new folder
     */
    async createFolder(options: CreateFolderOptions): Promise<DriveFile> {
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

    /**
     * Upload a text file to Drive
     */
    async uploadFile(options: UploadFileOptions): Promise<DriveFile> {
      const accessToken = await getAccessToken();

      const boundary = "-------314159265358979323846";
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelimiter = `\r\n--${boundary}--`;

      const metadata = buildMetadata({
        name: options.name,
        mimeType: options.mimeType,
        parentId: options.parentId,
        description: options.description,
      });

      const multipartRequestBody =
        delimiter +
        "Content-Type: application/json\r\n\r\n" +
        JSON.stringify(metadata) +
        delimiter +
        `Content-Type: ${options.mimeType}\r\n\r\n` +
        options.content +
        closeDelimiter;

      const response = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,kind,createdTime,modifiedTime,size,webViewLink,webContentLink",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body: multipartRequestBody,
        },
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Drive upload error: ${response.status} - ${error}`);
      }

      return response.json();
    },

    /**
     * Download file content as text
     */
    async downloadFile(fileId: string): Promise<string> {
      const accessToken = await getAccessToken();

      const response = await fetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Drive download error: ${response.status} - ${error}`);
      }

      return response.text();
    },

    /**
     * Delete a file or folder (move to trash)
     */
    async deleteFile(fileId: string): Promise<void> {
      await driveApiRequest(`/files/${fileId}`, { method: "DELETE" });
    },

    /**
     * Copy a file
     */
    async copyFile(fileId: string, name: string, parentId?: string): Promise<DriveFile> {
      const metadata: Record<string, unknown> = { name };
      if (parentId) metadata.parents = [parentId];

      return driveApiRequest<DriveFile>(`/files/${fileId}/copy`, {
        method: "POST",
        body: JSON.stringify(metadata),
      });
    },

    /**
     * Update file metadata
     */
    async updateFile(
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
