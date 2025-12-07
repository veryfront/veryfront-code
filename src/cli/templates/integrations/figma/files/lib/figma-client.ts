import { getAccessToken } from "./token-store.ts";

const FIGMA_BASE_URL = "https://api.figma.com/v1";

// Type definitions for Figma API responses
export interface FigmaFile {
  document: FigmaNode;
  components: Record<string, FigmaComponent>;
  componentSets: Record<string, FigmaComponentSet>;
  schemaVersion: number;
  styles: Record<string, FigmaStyle>;
  name: string;
  lastModified: string;
  thumbnailUrl: string;
  version: string;
  role: string;
  editorType: string;
  linkAccess: string;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  visible?: boolean;
  locked?: boolean;
  absoluteBoundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  fills?: Array<{
    type: string;
    color?: {
      r: number;
      g: number;
      b: number;
      a: number;
    };
  }>;
  strokes?: unknown[];
  strokeWeight?: number;
  effects?: unknown[];
  cornerRadius?: number;
  rectangleCornerRadii?: number[];
  characters?: string;
  style?: {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
    lineHeightPx?: number;
  };
}

export interface FigmaComponent {
  key: string;
  name: string;
  description: string;
  componentSetId?: string;
  documentationLinks: unknown[];
}

export interface FigmaComponentSet {
  key: string;
  name: string;
  description: string;
  documentationLinks: unknown[];
}

export interface FigmaStyle {
  key: string;
  name: string;
  description: string;
  styleType: "FILL" | "TEXT" | "EFFECT" | "GRID";
}

export interface FigmaComment {
  id: string;
  file_key: string;
  parent_id?: string;
  user: {
    id: string;
    handle: string;
    img_url: string;
  };
  created_at: string;
  resolved_at?: string;
  message: string;
  client_meta: {
    x?: number;
    y?: number;
    node_id?: string[];
    node_offset?: { x: number; y: number };
  };
  order_id: string;
}

export interface FigmaProject {
  id: string;
  name: string;
}

export interface FigmaTeamProject {
  id: string;
  name: string;
}

export interface FigmaUser {
  id: string;
  handle: string;
  img_url: string;
  email?: string;
}

async function figmaFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Figma. Please connect your account.");
  }

  const response = await fetch(`${FIGMA_BASE_URL}${endpoint}`, {
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
      `Figma API error: ${response.status} ${error.message || error.err || response.statusText}`,
    );
  }

  return response.json();
}

// Get current user info
export function getMe(): Promise<FigmaUser> {
  return figmaFetch<FigmaUser>("/me");
}

// Get file details
export function getFile(fileKey: string, options?: {
  version?: string;
  ids?: string[];
  depth?: number;
  geometry?: "paths" | "bounds";
  plugin_data?: string;
  branch_data?: boolean;
}): Promise<FigmaFile> {
  const params = new URLSearchParams();

  if (options?.version) params.set("version", options.version);
  if (options?.ids) params.set("ids", options.ids.join(","));
  if (options?.depth) params.set("depth", options.depth.toString());
  if (options?.geometry) params.set("geometry", options.geometry);
  if (options?.plugin_data) params.set("plugin_data", options.plugin_data);
  if (options?.branch_data) params.set("branch_data", "true");

  const query = params.toString();
  return figmaFetch<FigmaFile>(`/files/${fileKey}${query ? `?${query}` : ""}`);
}

// Get file nodes (specific nodes within a file)
export function getFileNodes(fileKey: string, nodeIds: string[]): Promise<{
  name: string;
  lastModified: string;
  thumbnailUrl: string;
  version: string;
  nodes: Record<string, { document: FigmaNode; components: Record<string, FigmaComponent> }>;
}> {
  const params = new URLSearchParams({
    ids: nodeIds.join(","),
  });
  return figmaFetch(`/files/${fileKey}/nodes?${params.toString()}`);
}

// Get file images (exports)
export function getFileImages(fileKey: string, nodeIds: string[], options?: {
  format?: "jpg" | "png" | "svg" | "pdf";
  scale?: number;
  svg_include_id?: boolean;
  svg_simplify_stroke?: boolean;
  use_absolute_bounds?: boolean;
  version?: string;
}): Promise<{
  err?: string;
  images: Record<string, string | null>;
  status?: number;
}> {
  const params = new URLSearchParams({
    ids: nodeIds.join(","),
    format: options?.format || "png",
  });

  if (options?.scale) params.set("scale", options.scale.toString());
  if (options?.svg_include_id) params.set("svg_include_id", "true");
  if (options?.svg_simplify_stroke) params.set("svg_simplify_stroke", "true");
  if (options?.use_absolute_bounds) params.set("use_absolute_bounds", "true");
  if (options?.version) params.set("version", options.version);

  return figmaFetch(`/images/${fileKey}?${params.toString()}`);
}

// Get comments on a file
export function getComments(fileKey: string): Promise<{ comments: FigmaComment[] }> {
  return figmaFetch<{ comments: FigmaComment[] }>(`/files/${fileKey}/comments`);
}

// Post a comment on a file
export function postComment(fileKey: string, message: string, options?: {
  client_meta?: { x?: number; y?: number; node_id?: string[] };
  parent_id?: string;
}): Promise<FigmaComment> {
  return figmaFetch<FigmaComment>(`/files/${fileKey}/comments`, {
    method: "POST",
    body: JSON.stringify({
      message,
      client_meta: options?.client_meta || {},
      ...(options?.parent_id && { parent_id: options.parent_id }),
    }),
  });
}

// Get team projects
export function getTeamProjects(teamId: string): Promise<{ projects: FigmaTeamProject[] }> {
  return figmaFetch<{ projects: FigmaTeamProject[] }>(`/teams/${teamId}/projects`);
}

// Get project files
export function getProjectFiles(projectId: string): Promise<{
  files: Array<{
    key: string;
    name: string;
    thumbnail_url: string;
    last_modified: string;
  }>;
}> {
  return figmaFetch(`/projects/${projectId}/files`);
}

// Get user's recent files
export function getUserFiles(): Promise<{
  files: Array<{
    key: string;
    name: string;
    thumbnail_url: string;
    last_modified: string;
  }>;
}> {
  // Note: Figma API doesn't have a direct endpoint for user files
  // This would typically require getting the user's teams and then their projects
  // For now, this is a placeholder that returns an error
  throw new Error(
    "Getting user files requires team ID. Use getTeamProjects and getProjectFiles instead.",
  );
}

// Helper to extract component information
export function extractComponents(file: FigmaFile): Array<{
  key: string;
  name: string;
  description: string;
  type: "component" | "component_set";
}> {
  const components: Array<{
    key: string;
    name: string;
    description: string;
    type: "component" | "component_set";
  }> = [];

  // Add regular components
  for (const [key, component] of Object.entries(file.components)) {
    components.push({
      key,
      name: component.name,
      description: component.description,
      type: "component",
    });
  }

  // Add component sets
  for (const [key, componentSet] of Object.entries(file.componentSets)) {
    components.push({
      key,
      name: componentSet.name,
      description: componentSet.description,
      type: "component_set",
    });
  }

  return components;
}

// Helper to extract styles
export function extractStyles(file: FigmaFile): Array<{
  key: string;
  name: string;
  description: string;
  type: string;
}> {
  return Object.entries(file.styles).map(([key, style]) => ({
    key,
    name: style.name,
    description: style.description,
    type: style.styleType,
  }));
}

// Helper to traverse nodes and find specific types
export function findNodesByType(node: FigmaNode, type: string): FigmaNode[] {
  const results: FigmaNode[] = [];

  if (node.type === type) {
    results.push(node);
  }

  if (node.children) {
    for (const child of node.children) {
      results.push(...findNodesByType(child, type));
    }
  }

  return results;
}

// Helper to get a summary of a file
export function getFileSummary(file: FigmaFile): {
  name: string;
  lastModified: string;
  componentCount: number;
  componentSetCount: number;
  styleCount: number;
  pageCount: number;
} {
  const pages = file.document.children || [];

  return {
    name: file.name,
    lastModified: file.lastModified,
    componentCount: Object.keys(file.components).length,
    componentSetCount: Object.keys(file.componentSets).length,
    styleCount: Object.keys(file.styles).length,
    pageCount: pages.length,
  };
}
