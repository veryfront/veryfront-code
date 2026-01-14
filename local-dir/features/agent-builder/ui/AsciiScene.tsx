/**
 * @fileoverview ASCII art 3D scene component using Three.js.
 */

import { useRef } from "react"
import { useThreeScene } from "../hooks/useThreeScene"

/** Props for AsciiScene component. */
interface AsciiSceneProps {
  /** Type of 3D model to render. */
  modelType?: ModelType
  /** Whether to enable scroll-to-zoom (default: false). */
  enableScrollZoom?: boolean
}

/**
 * Renders a 3D scene with ASCII effect based on model type.
 *
 * @param props - Component props
 * @returns ASCII-rendered 3D scene
 *
 * @example
 * <AsciiScene modelType="agent" enableScrollZoom={false} />
 */
export function AsciiScene({
  modelType = "agent",
  enableScrollZoom = false,
}: AsciiSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useThreeScene(containerRef, modelType, enableScrollZoom)

  return <div ref={containerRef} />
}
