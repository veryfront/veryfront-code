export type NodeType =
  | "DOCUMENT"
  | "CANVAS"
  | "FRAME"
  | "GROUP"
  | "VECTOR"
  | "BOOLEAN_OPERATION"
  | "STAR"
  | "LINE"
  | "ELLIPSE"
  | "REGULAR_POLYGON"
  | "RECTANGLE"
  | "TEXT"
  | "SLICE"
  | "COMPONENT"
  | "COMPONENT_SET"
  | "INSTANCE";

export type BlendMode =
  | "NORMAL"
  | "DARKEN"
  | "MULTIPLY"
  | "LINEAR_BURN"
  | "COLOR_BURN"
  | "LIGHTEN"
  | "SCREEN"
  | "LINEAR_DODGE"
  | "COLOR_DODGE"
  | "OVERLAY"
  | "SOFT_LIGHT"
  | "HARD_LIGHT"
  | "DIFFERENCE"
  | "EXCLUSION"
  | "HUE"
  | "SATURATION"
  | "COLOR"
  | "LUMINOSITY";

export type EasingType = "EASE_IN" | "EASE_OUT" | "EASE_IN_AND_OUT" | "LINEAR";

export interface Vector2D {
  x: number;
  y: number;
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Transform {
  /** 2D transformation matrix [[a, b, tx], [c, d, ty]] */
  matrix: [[number, number, number], [number, number, number]];
}

export type PaintType =
  | "SOLID"
  | "GRADIENT_LINEAR"
  | "GRADIENT_RADIAL"
  | "GRADIENT_ANGULAR"
  | "GRADIENT_DIAMOND"
  | "IMAGE"
  | "EMOJI";

export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface ColorStop {
  position: number;
  color: Color;
}

export interface Paint {
  type: PaintType;
  visible?: boolean;
  opacity?: number;
  color?: Color;
  blendMode?: BlendMode;
  gradientHandlePositions?: Vector2D[];
  gradientStops?: ColorStop[];
  scaleMode?: "FILL" | "FIT" | "TILE" | "STRETCH";
  imageTransform?: Transform;
  scalingFactor?: number;
  imageRef?: string;
  gifRef?: string;
}

export type EffectType = "INNER_SHADOW" | "DROP_SHADOW" | "LAYER_BLUR" | "BACKGROUND_BLUR";

export interface Effect {
  type: EffectType;
  visible?: boolean;
  radius?: number;
  color?: Color;
  blendMode?: BlendMode;
  offset?: Vector2D;
  spread?: number;
}

export type LayoutConstraintVertical = "TOP" | "BOTTOM" | "CENTER" | "TOP_BOTTOM" | "SCALE";
export type LayoutConstraintHorizontal = "LEFT" | "RIGHT" | "CENTER" | "LEFT_RIGHT" | "SCALE";

export interface LayoutConstraint {
  vertical: LayoutConstraintVertical;
  horizontal: LayoutConstraintHorizontal;
}

export type LayoutAlign = "MIN" | "CENTER" | "MAX" | "STRETCH" | "INHERIT";
export type LayoutMode = "NONE" | "HORIZONTAL" | "VERTICAL";

export interface LayoutGrid {
  pattern: "COLUMNS" | "ROWS" | "GRID";
  sectionSize?: number;
  visible?: boolean;
  color?: Color;
  alignment?: "MIN" | "MAX" | "CENTER" | "STRETCH";
  gutterSize?: number;
  offset?: number;
  count?: number;
}

export type TextAlignHorizontal = "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
export type TextAlignVertical = "TOP" | "CENTER" | "BOTTOM";
export type TextCase = "ORIGINAL" | "UPPER" | "LOWER" | "TITLE";
export type TextDecoration = "NONE" | "STRIKETHROUGH" | "UNDERLINE";

export interface TypeStyle {
  fontFamily: string;
  fontPostScriptName?: string;
  paragraphSpacing?: number;
  paragraphIndent?: number;
  italic?: boolean;
  fontWeight: number;
  fontSize: number;
  textAlignHorizontal?: TextAlignHorizontal;
  textAlignVertical?: TextAlignVertical;
  letterSpacing?: number;
  fills?: Paint[];
  lineHeightPx?: number;
  lineHeightPercent?: number;
  lineHeightPercentFontSize?: number;
  lineHeightUnit?: "PIXELS" | "FONT_SIZE_%" | "INTRINSIC_%";
}

export interface Component {
  key: string;
  name: string;
  description: string;
  componentSetId?: string;
  documentationLinks: string[];
  remote?: boolean;
}

export interface ComponentSet {
  key: string;
  name: string;
  description: string;
  documentationLinks: string[];
  remote?: boolean;
}

export type StyleType = "FILL" | "TEXT" | "EFFECT" | "GRID";

export interface Style {
  key: string;
  name: string;
  description: string;
  styleType: StyleType;
  remote?: boolean;
}

export type ExportFormat = "JPG" | "PNG" | "SVG" | "PDF";

export interface ExportSettings {
  suffix: string;
  format: ExportFormat;
  constraint?: {
    type: "SCALE" | "WIDTH" | "HEIGHT";
    value: number;
  };
}

export interface Comment {
  id: string;
  file_key: string;
  parent_id?: string;
  user: User;
  created_at: string;
  resolved_at?: string;
  message: string;
  client_meta: CommentClientMeta;
  order_id: string;
}

export interface CommentClientMeta {
  x?: number;
  y?: number;
  node_id?: string[];
  node_offset?: Vector2D;
}

export interface User {
  id: string;
  handle: string;
  img_url: string;
  email?: string;
}

export interface FileResponse {
  document: Node;
  components: Record<string, Component>;
  componentSets: Record<string, ComponentSet>;
  schemaVersion: number;
  styles: Record<string, Style>;
  name: string;
  lastModified: string;
  thumbnailUrl: string;
  version: string;
  role: "owner" | "editor" | "viewer";
  editorType: "figma" | "figjam";
  linkAccess: "view" | "edit" | "org_view" | "org_edit";
}

export interface NodeBase {
  id: string;
  name: string;
  visible?: boolean;
  type: NodeType;
  pluginData?: unknown;
  sharedPluginData?: unknown;
  locked?: boolean;
}

export interface NodeWithChildren extends NodeBase {
  children: Node[];
}

export interface DocumentNode extends NodeWithChildren {
  type: "DOCUMENT";
}

export interface CanvasNode extends NodeWithChildren {
  type: "CANVAS";
  backgroundColor: Color;
  prototypeStartNodeID?: string;
  prototypeDevice?: {
    type: string;
    rotation: "NONE" | "CCW_90";
  };
  exportSettings?: ExportSettings[];
}

export interface FrameNode extends NodeWithChildren {
  type: "FRAME";
  absoluteBoundingBox?: Rectangle;
  absoluteRenderBounds?: Rectangle;
  constraints?: LayoutConstraint;
  clipsContent?: boolean;
  background: Paint[];
  backgroundColor?: Color;
  fills?: Paint[];
  strokes?: Paint[];
  strokeWeight?: number;
  strokeAlign?: "INSIDE" | "OUTSIDE" | "CENTER";
  strokeDashes?: number[];
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  exportSettings?: ExportSettings[];
  blendMode?: BlendMode;
  preserveRatio?: boolean;
  layoutAlign?: LayoutAlign;
  layoutGrow?: number;
  layoutMode?: LayoutMode;
  primaryAxisSizingMode?: "FIXED" | "AUTO";
  counterAxisSizingMode?: "FIXED" | "AUTO";
  primaryAxisAlignItems?: LayoutAlign;
  counterAxisAlignItems?: LayoutAlign;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  layoutGrids?: LayoutGrid[];
  effects?: Effect[];
  isMask?: boolean;
  isMaskOutline?: boolean;
  transitionNodeID?: string;
  transitionDuration?: number;
  transitionEasing?: EasingType;
  opacity?: number;
}

export interface GroupNode extends NodeWithChildren {
  type: "GROUP";
  absoluteBoundingBox?: Rectangle;
  absoluteRenderBounds?: Rectangle;
  constraints?: LayoutConstraint;
  clipsContent?: boolean;
  blendMode?: BlendMode;
  effects?: Effect[];
  opacity?: number;
}

export interface VectorNode extends NodeBase {
  type: "VECTOR" | "BOOLEAN_OPERATION" | "STAR" | "LINE" | "ELLIPSE" | "REGULAR_POLYGON" | "RECTANGLE";
  absoluteBoundingBox?: Rectangle;
  absoluteRenderBounds?: Rectangle;
  constraints?: LayoutConstraint;
  fills?: Paint[];
  fillGeometry?: unknown[];
  strokes?: Paint[];
  strokeWeight?: number;
  strokeCap?: "NONE" | "ROUND" | "SQUARE" | "LINE_ARROW" | "TRIANGLE_ARROW";
  strokeJoin?: "MITER" | "BEVEL" | "ROUND";
  strokeDashes?: number[];
  strokeAlign?: "INSIDE" | "OUTSIDE" | "CENTER";
  strokeGeometry?: unknown[];
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  exportSettings?: ExportSettings[];
  blendMode?: BlendMode;
  preserveRatio?: boolean;
  layoutAlign?: LayoutAlign;
  layoutGrow?: number;
  effects?: Effect[];
  isMask?: boolean;
  opacity?: number;
}

export interface TextNode extends NodeBase {
  type: "TEXT";
  absoluteBoundingBox?: Rectangle;
  absoluteRenderBounds?: Rectangle;
  constraints?: LayoutConstraint;
  fills?: Paint[];
  strokes?: Paint[];
  strokeWeight?: number;
  strokeAlign?: "INSIDE" | "OUTSIDE" | "CENTER";
  strokeDashes?: number[];
  exportSettings?: ExportSettings[];
  blendMode?: BlendMode;
  preserveRatio?: boolean;
  layoutAlign?: LayoutAlign;
  layoutGrow?: number;
  effects?: Effect[];
  characters: string;
  style: TypeStyle;
  characterStyleOverrides?: number[];
  styleOverrideTable?: Record<number, TypeStyle>;
  opacity?: number;
}

export interface ComponentNode extends FrameNode {
  type: "COMPONENT";
}

export interface ComponentSetNode extends FrameNode {
  type: "COMPONENT_SET";
}

export interface InstanceNode extends FrameNode {
  type: "INSTANCE";
  componentId: string;
  overrides?: unknown[];
}

export type Node =
  | DocumentNode
  | CanvasNode
  | FrameNode
  | GroupNode
  | VectorNode
  | TextNode
  | ComponentNode
  | ComponentSetNode
  | InstanceNode;

export interface Project {
  id: string;
  name: string;
}

export interface FileReference {
  key: string;
  name: string;
  thumbnail_url: string;
  last_modified: string;
}

export interface ProjectFilesResponse {
  files: FileReference[];
}

export interface TeamProjectsResponse {
  projects: Project[];
}

export interface Version {
  id: string;
  created_at: string;
  label?: string;
  description?: string;
  user: User;
  thumbnail_url?: string;
}

export interface VersionsResponse {
  versions: Version[];
  pagination?: {
    next_page?: number;
  };
}
