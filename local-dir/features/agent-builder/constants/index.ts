/**
 * @fileoverview Constants for agent builder feature.
 */

/** ASCII character set for rendering effect. */
export const ASCII_CHARS = " .:-=+*#%@"

/** Z-index layers for UI elements. */
export const Z_INDEX = {
  SCENE: 1,
  OVERLAY: 10,
  DROPDOWN: 50,
} as const

/** Camera configuration for 3D scene. */
export const CAMERA_CONFIG = {
  FOV: 50,
  NEAR: 1,
  FAR: 1000,
  POSITION_Y: 0,
  POSITION_Z: 500,
} as const

/** Lighting configuration for 3D scene. */
export const LIGHTING = {
  KEY: { color: 0xffffff, intensity: 2, position: [300, 300, 500] as const },
  FILL: {
    color: 0xffffff,
    intensity: 0.5,
    position: [-300, -100, -300] as const,
  },
  BACK: { color: 0xffffff, intensity: 1.5, position: [0, 200, -300] as const },
} as const

/** Trackball controls configuration. */
export const CONTROLS_CONFIG = {
  MIN_DISTANCE: 300,
  MAX_DISTANCE: 700,
} as const

/** Placeholder text by mode. */
export const PLACEHOLDERS: Record<string, string> = {
  agent: "1. Agent instructions",
  webapp: "Describe your web app...",
  aiapp: "Describe your AI app...",
  webshop: "Describe your web shop...",
  dream: "Describe your dream...",
} as const
