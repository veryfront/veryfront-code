import { getAccessToken } from "./token-store.ts";

const DROPBOX_API_URL = "https://api.dropboxapi.com/2";
const DROPBOX_CONTENT_URL = "https://content.dropboxapi.com/2";

// Dropbox API Types
export interface DropboxMetadata {
  ".tag": "file" | "folder" | "deleted";
  name: string;
  path_lower?: string;
  path_display?: string;
  id: string;
}

export interface DropboxFileMetadata extends DropboxMetadata {
  ".tag": "file";
  client_modified: string;
  server_modified: string;
  rev: string;
  size: number;
  is_downloadable: boolean;
  content_hash?: string;
}

export interface DropboxFolderMetadata extends DropboxMetadata {
  ".tag": "folder";
}

export interface ListFolderResult {
  entries: Array<DropboxFileMetadata | DropboxFolderMetadata>;
  cursor: string;
  has_more: boolean;
}

export interface SearchResult {
  matches: Array<{
    match_type: {
      ".tag": "filename" | "content" | "both";
    };
    metadata: {
      ".tag": "metadata";
      metadata: DropboxFileMetadata | DropboxFolderMetadata;
    };
  }>;
  has_more: boolean;
  cursor?: string;
}

export interface AccountInfo {
  account_id: string;
  name: {
    given_name: string;
    surname: string;
    familiar_name: string;
    display_name: string;
  };
  email: string;
  email_verified: boolean;
  disabled: boolean;
  country: string;
  locale: string;
  account_type: {
    ".tag": "basic" | "pro" | "business";
  };
}

export interface SpaceUsage {
  used: number;
  allocation: {
    ".tag": "individual" | "team";
    allocated?: number;
  };
}

export interface SharedLinkMetadata {
  url: string;
  id: string;
  name: string;
  path_lower?: string;
  link_permissions: {
    can_revoke: boolean;
    resolved_visibility?: {
      ".tag": "public" | "team_only" | "password";
    };
  };
}

// Helper function for Dropbox RPC API calls
async function dropboxRPC<T>(
  endpoint: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Dropbox. Please connect your account.");
  }

  const response = await fetch(`${DROPBOX_API_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Dropbox API error: ${response.status} ${error.error_summary || response.statusText}`,
    );
  }

  return response.json();
}

// Helper function for Dropbox Content API calls
async function dropboxContent<T>(
  endpoint: string,
  args: Record<string, unknown>,
  content?: string | Uint8Array,
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Dropbox. Please connect your account.");
  }

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${token}`,
    "Dropbox-API-Arg": JSON.stringify(args),
  };

  let body: string | Uint8Array | undefined;
  if (content) {
    if (typeof content === "string") {
      headers["Content-Type"] = "application/octet-stream";
      body = content;
    } else {
      headers["Content-Type"] = "application/octet-stream";
      body = content;
    }
  }

  const response = await fetch(`${DROPBOX_CONTENT_URL}${endpoint}`, {
    method: "POST",
    headers,
    body,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Dropbox API error: ${response.status} ${error.error_summary || response.statusText}`,
    );
  }

  return response.json();
}

// Account Operations
export async function getCurrentAccount(): Promise<AccountInfo> {
  return dropboxRPC<AccountInfo>("/users/get_current_account");
}

export async function getSpaceUsage(): Promise<SpaceUsage> {
  return dropboxRPC<SpaceUsage>("/users/get_space_usage");
}

// File and Folder Operations
export async function listFolder(
  path: string = "",
  options?: {
    recursive?: boolean;
    includeDeleted?: boolean;
    includeHasExplicitSharedMembers?: boolean;
    limit?: number;
  },
): Promise<ListFolderResult> {
  return dropboxRPC<ListFolderResult>("/files/list_folder", {
    path: path || "",
    recursive: options?.recursive || false,
    include_deleted: options?.includeDeleted || false,
    include_has_explicit_shared_members: options?.includeHasExplicitSharedMembers || false,
    limit: options?.limit || 100,
  });
}

export async function listFolderContinue(cursor: string): Promise<ListFolderResult> {
  return dropboxRPC<ListFolderResult>("/files/list_folder/continue", { cursor });
}

export async function getMetadata(
  path: string,
  options?: {
    includeMediaInfo?: boolean;
    includeDeleted?: boolean;
  },
): Promise<DropboxFileMetadata | DropboxFolderMetadata> {
  return dropboxRPC<DropboxFileMetadata | DropboxFolderMetadata>("/files/get_metadata", {
    path,
    include_media_info: options?.includeMediaInfo || false,
    include_deleted: options?.includeDeleted || false,
  });
}

export async function downloadFile(path: string): Promise<{
  content: string;
  metadata: DropboxFileMetadata;
}> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Dropbox. Please connect your account.");
  }

  const response = await fetch(`${DROPBOX_CONTENT_URL}/files/download`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Dropbox-API-Arg": JSON.stringify({ path }),
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Dropbox API error: ${response.status} ${error.error_summary || response.statusText}`,
    );
  }

  const content = await response.text();
  const metadataHeader = response.headers.get("Dropbox-API-Result");
  const metadata = metadataHeader ? JSON.parse(metadataHeader) : {};

  return { content, metadata };
}

export async function uploadFile(
  path: string,
  content: string | Uint8Array,
  options?: {
    mode?: "add" | "overwrite" | "update";
    autorename?: boolean;
    mute?: boolean;
  },
): Promise<DropboxFileMetadata> {
  return dropboxContent<DropboxFileMetadata>(
    "/files/upload",
    {
      path,
      mode: options?.mode || "add",
      autorename: options?.autorename || false,
      mute: options?.mute || false,
    },
    content,
  );
}

export async function deleteFile(
  path: string,
): Promise<DropboxFileMetadata | DropboxFolderMetadata> {
  return dropboxRPC<DropboxFileMetadata | DropboxFolderMetadata>("/files/delete_v2", {
    path,
  }).then((result: any) => result.metadata);
}

export async function moveFile(
  fromPath: string,
  toPath: string,
  options?: {
    allowSharedFolder?: boolean;
    autorename?: boolean;
    allowOwnershipTransfer?: boolean;
  },
): Promise<DropboxFileMetadata | DropboxFolderMetadata> {
  return dropboxRPC<{ metadata: DropboxFileMetadata | DropboxFolderMetadata }>("/files/move_v2", {
    from_path: fromPath,
    to_path: toPath,
    allow_shared_folder: options?.allowSharedFolder || false,
    autorename: options?.autorename || false,
    allow_ownership_transfer: options?.allowOwnershipTransfer || false,
  }).then((result) => result.metadata);
}

export async function copyFile(
  fromPath: string,
  toPath: string,
  options?: {
    allowSharedFolder?: boolean;
    autorename?: boolean;
    allowOwnershipTransfer?: boolean;
  },
): Promise<DropboxFileMetadata | DropboxFolderMetadata> {
  return dropboxRPC<{ metadata: DropboxFileMetadata | DropboxFolderMetadata }>("/files/copy_v2", {
    from_path: fromPath,
    to_path: toPath,
    allow_shared_folder: options?.allowSharedFolder || false,
    autorename: options?.autorename || false,
    allow_ownership_transfer: options?.allowOwnershipTransfer || false,
  }).then((result) => result.metadata);
}

export async function createFolder(
  path: string,
  autorename?: boolean,
): Promise<DropboxFolderMetadata> {
  return dropboxRPC<{ metadata: DropboxFolderMetadata }>("/files/create_folder_v2", {
    path,
    autorename: autorename || false,
  }).then((result) => result.metadata);
}

// Search Operations
export async function searchFiles(
  query: string,
  options?: {
    path?: string;
    maxResults?: number;
    fileCategories?: Array<
      | "image"
      | "document"
      | "pdf"
      | "spreadsheet"
      | "presentation"
      | "audio"
      | "video"
      | "folder"
      | "paper"
      | "others"
    >;
    fileExtensions?: string[];
  },
): Promise<SearchResult> {
  return dropboxRPC<SearchResult>("/files/search_v2", {
    query,
    options: {
      path: options?.path || "",
      max_results: options?.maxResults || 20,
      file_categories: options?.fileCategories,
      filename_only: false,
    },
  });
}

// Sharing Operations
export async function createSharedLink(
  path: string,
  settings?: {
    requestedVisibility?: "public" | "team_only" | "password";
    linkPassword?: string;
    expires?: string;
  },
): Promise<SharedLinkMetadata> {
  try {
    return await dropboxRPC<SharedLinkMetadata>("/sharing/create_shared_link_with_settings", {
      path,
      settings: settings || {},
    });
  } catch (error) {
    // If link already exists, get the existing link
    if (error instanceof Error && error.message.includes("shared_link_already_exists")) {
      const links = await listSharedLinks(path);
      if (links.length > 0) {
        return links[0];
      }
    }
    throw error;
  }
}

export async function listSharedLinks(path?: string): Promise<SharedLinkMetadata[]> {
  const result = await dropboxRPC<{ links: SharedLinkMetadata[] }>("/sharing/list_shared_links", {
    path: path || "",
  });
  return result.links;
}

// Helper Functions
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

export function isFile(metadata: DropboxMetadata): metadata is DropboxFileMetadata {
  return metadata[".tag"] === "file";
}

export function isFolder(metadata: DropboxMetadata): metadata is DropboxFolderMetadata {
  return metadata[".tag"] === "folder";
}
