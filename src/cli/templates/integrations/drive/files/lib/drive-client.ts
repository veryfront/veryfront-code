
import { tokenStore as _tokenStore } from "./token-store.ts";
import { getValidToken } from "./oauth.ts";

function getEnv(key: string): string | undefined {
  if (typeof Deno !== "undefined") {
    return Deno.env.get(key);
  }
  else if (typeof process !== "undefined" && process.env) {
    return process.env[key];
  }
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

export const driveOAuthProvider = {
  name: "drive",
  authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  clientId: getEnv("GOOGLE_CLIENT_ID") || "",
  clientSecret: getEnv("GOOGLE_CLIENT_SECRET") || "",
  scopes: [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
  ],
  callbackPath: "/api/auth/drive/callback",
};

export function createDriveClient(userId: string) {
  async function getAccessToken(): Promise<string> {
    const token = await getValidToken(driveOAuthProvider, userId, "drive");
    if (!token) {
      throw new Error("Google Drive not connected. Please connect your Google account first.");
    }
    return token;
  }

  async function driveApiRequest<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
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

  return {
    async listFiles(options: ListFilesOptions = {}): Promise<DriveFileList> {
      const params = new URLSearchParams({
        fields:
          "nextPageToken,incompleteSearch,files(id,name,mimeType,kind,createdTime,modifiedTime,size,webViewLink,webContentLink,iconLink,thumbnailLink,parents,starred,trashed,shared,owners,lastModifyingUser,capabilities)",
        pageSize: String(options.pageSize || 100),
        orderBy: options.orderBy || "modifiedTime desc",
      });

      let query = "trashed=false";

      if (options.folderId) {
        query += ` and '${options.folderId}' in parents`;
      }

      if (options.query) {
        query += ` and ${options.query}`;
      }

      params.append("q", query);

      if (options.pageToken) {
        params.append("pageToken", options.pageToken);
      }

      return driveApiRequest<DriveFileList>(`/files?${params.toString()}`);
    },

    async getFile(fileId: string): Promise<DriveFile> {
      const params = new URLSearchParams({
        fields:
          "id,name,mimeType,kind,createdTime,modifiedTime,size,webViewLink,webContentLink,iconLink,thumbnailLink,parents,starred,trashed,shared,owners,lastModifyingUser,capabilities",
      });

      return driveApiRequest<DriveFile>(`/files/${fileId}?${params.toString()}`);
    },

    async searchFiles(options: SearchFilesOptions): Promise<DriveFileList> {
      const params = new URLSearchParams({
        fields:
          "nextPageToken,incompleteSearch,files(id,name,mimeType,kind,createdTime,modifiedTime,size,webViewLink,webContentLink,iconLink,thumbnailLink,parents,starred,trashed)",
        pageSize: String(options.pageSize || 100),
        q: `${options.query} and trashed=false`,
        orderBy: options.orderBy || "modifiedTime desc",
      });

      if (options.pageToken) {
        params.append("pageToken", options.pageToken);
      }

      return driveApiRequest<DriveFileList>(`/files?${params.toString()}`);
    },

    async createFolder(options: CreateFolderOptions): Promise<DriveFile> {
      const metadata: Record<string, unknown> = {
        name: options.name,
        mimeType: "application/vnd.google-apps.folder",
      };

      if (options.parentId) {
        metadata.parents = [options.parentId];
      }

      if (options.description) {
        metadata.description = options.description;
      }

      return driveApiRequest<DriveFile>("/files", {
        method: "POST",
        body: JSON.stringify(metadata),
      });
    },

    async uploadFile(options: UploadFileOptions): Promise<DriveFile> {
      const accessToken = await getAccessToken();

      const boundary = "-------314159265358979323846";
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelimiter = `\r\n--${boundary}--`;

      const metadata: Record<string, unknown> = {
        name: options.name,
        mimeType: options.mimeType,
      };

      if (options.parentId) {
        metadata.parents = [options.parentId];
      }

      if (options.description) {
        metadata.description = options.description;
      }

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

    async downloadFile(fileId: string): Promise<string> {
      const accessToken = await getAccessToken();

      const response = await fetch(
        `${DRIVE_API_BASE}/files/${fileId}?alt=media`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Drive download error: ${response.status} - ${error}`);
      }

      return response.text();
    },

    async deleteFile(fileId: string): Promise<void> {
      await driveApiRequest(`/files/${fileId}`, {
        method: "DELETE",
      });
    },

    async copyFile(
      fileId: string,
      name: string,
      parentId?: string,
    ): Promise<DriveFile> {
      const metadata: Record<string, unknown> = {
        name,
      };

      if (parentId) {
        metadata.parents = [parentId];
      }

      return driveApiRequest<DriveFile>(`/files/${fileId}/copy`, {
        method: "POST",
        body: JSON.stringify(metadata),
      });
    },

    async updateFile(
      fileId: string,
      updates: {
        name?: string;
        description?: string;
        starred?: boolean;
      },
    ): Promise<DriveFile> {
      return driveApiRequest<DriveFile>(`/files/${fileId}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
    },
  };
}

export type DriveClient = ReturnType<typeof createDriveClient>;
