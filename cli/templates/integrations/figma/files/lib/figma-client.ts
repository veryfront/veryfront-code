import { fetchOAuthJson } from "./oauth.ts";

const FIGMA_BASE_URL = "https://api.figma.com/v1";

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

export interface FigmaUser {
  id: string;
  handle: string;
  img_url: string;
  email?: string;
}

export function createFigmaClient(userId: string) {
  function figmaFetch<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    return fetchOAuthJson<T>(userId, "figma", `${FIGMA_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  }

  function getMe(): Promise<FigmaUser> {
    return figmaFetch<FigmaUser>("/me");
  }

  function getFile(
    fileKey: string,
    options?: {
      version?: string;
      ids?: string[];
      depth?: number;
      geometry?: "paths" | "bounds";
      plugin_data?: string;
      branch_data?: boolean;
    },
  ): Promise<FigmaFile> {
    const params = new URLSearchParams();

    if (options?.version) params.set("version", options.version);
    if (options?.ids?.length) params.set("ids", options.ids.join(","));
    if (options?.depth) params.set("depth", String(options.depth));
    if (options?.geometry) params.set("geometry", options.geometry);
    if (options?.plugin_data) params.set("plugin_data", options.plugin_data);
    if (options?.branch_data) params.set("branch_data", "true");

    const query = params.toString();
    const url = query ? `/files/${fileKey}?${query}` : `/files/${fileKey}`;

    return figmaFetch<FigmaFile>(url);
  }

  function getFileNodes(
    fileKey: string,
    nodeIds: string[],
  ): Promise<{
    name: string;
    lastModified: string;
    thumbnailUrl: string;
    version: string;
    nodes: Record<
      string,
      { document: FigmaNode; components: Record<string, FigmaComponent> }
    >;
  }> {
    const params = new URLSearchParams({ ids: nodeIds.join(",") });
    return figmaFetch(`/files/${fileKey}/nodes?${params.toString()}`);
  }

  function getFileImages(
    fileKey: string,
    nodeIds: string[],
    options?: {
      format?: "jpg" | "png" | "svg" | "pdf";
      scale?: number;
      svg_include_id?: boolean;
      svg_simplify_stroke?: boolean;
      use_absolute_bounds?: boolean;
      version?: string;
    },
  ): Promise<{
    err?: string;
    images: Record<string, string | null>;
    status?: number;
  }> {
    const params = new URLSearchParams({
      ids: nodeIds.join(","),
      format: options?.format ?? "png",
    });

    if (options?.scale) params.set("scale", String(options.scale));
    if (options?.svg_include_id) params.set("svg_include_id", "true");
    if (options?.svg_simplify_stroke) params.set("svg_simplify_stroke", "true");
    if (options?.use_absolute_bounds) params.set("use_absolute_bounds", "true");
    if (options?.version) params.set("version", options.version);

    return figmaFetch(`/images/${fileKey}?${params.toString()}`);
  }

  function getComments(fileKey: string): Promise<{ comments: FigmaComment[] }> {
    return figmaFetch<{ comments: FigmaComment[] }>(
      `/files/${fileKey}/comments`,
    );
  }

  function postComment(
    fileKey: string,
    message: string,
    options?: {
      client_meta?: { x?: number; y?: number; node_id?: string[] };
      parent_id?: string;
    },
  ): Promise<FigmaComment> {
    return figmaFetch<FigmaComment>(`/files/${fileKey}/comments`, {
      method: "POST",
      body: JSON.stringify({
        message,
        client_meta: options?.client_meta ?? {},
        ...(options?.parent_id ? { parent_id: options.parent_id } : {}),
      }),
    });
  }

  function extractComponents(file: FigmaFile): Array<{
    key: string;
    name: string;
    description: string;
    type: "component" | "component_set";
  }> {
    const components = Object.entries(file.components).map((
      [key, component],
    ) => ({
      key,
      name: component.name,
      description: component.description,
      type: "component" as const,
    }));

    const componentSets = Object.entries(file.componentSets).map((
      [key, componentSet],
    ) => ({
      key,
      name: componentSet.name,
      description: componentSet.description,
      type: "component_set" as const,
    }));

    return [...components, ...componentSets];
  }

  function extractStyles(file: FigmaFile): Array<{
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

  function findNodesByType(node: FigmaNode, type: string): FigmaNode[] {
    const results: FigmaNode[] = [];

    if (node.type === type) {
      results.push(node);
    }

    for (const child of node.children ?? []) {
      results.push(...findNodesByType(child, type));
    }

    return results;
  }

  function getFileSummary(file: FigmaFile): {
    name: string;
    lastModified: string;
    componentCount: number;
    componentSetCount: number;
    styleCount: number;
    pageCount: number;
  } {
    return {
      name: file.name,
      lastModified: file.lastModified,
      componentCount: Object.keys(file.components).length,
      componentSetCount: Object.keys(file.componentSets).length,
      styleCount: Object.keys(file.styles).length,
      pageCount: file.document.children?.length ?? 0,
    };
  }

  return {
    getMe,
    getFile,
    getFileNodes,
    getFileImages,
    getComments,
    postComment,
    extractComponents,
    extractStyles,
    findNodesByType,
    getFileSummary,
  };
}
