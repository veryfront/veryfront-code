/**
 * @fileoverview Custom hook for managing Three.js scene lifecycle.
 */

import { useEffect, useRef, type RefObject } from "react"
import * as THREE from "https://esm.sh/three@0.181.2"
import { TrackballControls } from "https://esm.sh/three@0.181.2/examples/jsm/controls/TrackballControls.js"
import { AsciiEffect } from "https://esm.sh/three@0.181.2/examples/jsm/effects/AsciiEffect.js"

import { createModel } from "../utils/modelFactory"
import {
  ASCII_CHARS,
  CAMERA_CONFIG,
  LIGHTING,
  CONTROLS_CONFIG,
  Z_INDEX,
} from "../constants"

/** Available 3D model types for the ASCII scene. */
type ModelType = "agent" | "webapp" | "aiapp" | "webshop" | "dream"

/**
 * Manages Three.js scene initialization, animation, and cleanup.
 *
 * @param containerRef - Ref to container element for rendering
 * @param modelType - Type of 3D model to render
 * @param enableScrollZoom - Whether to enable scroll-to-zoom (default: false)
 */
export function useThreeScene(
  containerRef: RefObject<HTMLDivElement>,
  modelType: ModelType,
  enableScrollZoom: boolean = false,
): void {
  const animationIdRef = useRef<number>()

  useEffect(() => {
    if (!containerRef.current) return

    let camera: THREE.PerspectiveCamera
    let scene: THREE.Scene
    let renderer: THREE.WebGLRenderer
    let effect: any
    let controls: TrackballControls
    let model: THREE.Object3D | null = null
    const startTime = Date.now()

    /**
     * Initializes Three.js scene, camera, lights, and renderer.
     */
    function initScene(): void {
      // Camera setup
      camera = new THREE.PerspectiveCamera(
        CAMERA_CONFIG.FOV,
        window.innerWidth / window.innerHeight,
        CAMERA_CONFIG.NEAR,
        CAMERA_CONFIG.FAR,
      )
      camera.position.y = CAMERA_CONFIG.POSITION_Y
      camera.position.z = CAMERA_CONFIG.POSITION_Z

      // Scene setup
      scene = new THREE.Scene()
      scene.background = null

      // Lighting
      const keyLight = new THREE.DirectionalLight(
        LIGHTING.KEY.color,
        LIGHTING.KEY.intensity,
      )
      keyLight.position.set(...LIGHTING.KEY.position)
      scene.add(keyLight)

      const fillLight = new THREE.DirectionalLight(
        LIGHTING.FILL.color,
        LIGHTING.FILL.intensity,
      )
      fillLight.position.set(...LIGHTING.FILL.position)
      scene.add(fillLight)

      const backLight = new THREE.DirectionalLight(
        LIGHTING.BACK.color,
        LIGHTING.BACK.intensity,
      )
      backLight.position.set(...LIGHTING.BACK.position)
      scene.add(backLight)

      // Create model
      createModel(modelType, scene).then((createdModel) => {
        model = createdModel
      })

      // Renderer
      renderer = new THREE.WebGLRenderer({ alpha: true })
      renderer.setSize(window.innerWidth, window.innerHeight)
      renderer.setClearColor(0x000000, 0)

      // ASCII Effect
      effect = new AsciiEffect(renderer, ASCII_CHARS, { invert: false })
      effect.setSize(window.innerWidth, window.innerHeight)
      effect.domElement.style.color = "#1ABCFE"
      effect.domElement.style.backgroundColor = "transparent"
      effect.domElement.style.position = "absolute"
      effect.domElement.style.top = "0"
      effect.domElement.style.left = "0"
      effect.domElement.style.zIndex = String(Z_INDEX.SCENE)

      containerRef.current?.appendChild(effect.domElement)

      // Controls
      controls = new TrackballControls(camera, effect.domElement)
      controls.minDistance = CONTROLS_CONFIG.MIN_DISTANCE
      controls.maxDistance = CONTROLS_CONFIG.MAX_DISTANCE
      controls.noZoom = !enableScrollZoom

      window.addEventListener("resize", handleResize)
    }

    /**
     * Handles window resize events.
     */
    function handleResize(): void {
      camera.aspect = window.innerWidth / window.innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(window.innerWidth, window.innerHeight)
      effect.setSize(window.innerWidth, window.innerHeight)
    }

    /**
     * Animation loop.
     */
    function animate(): void {
      animationIdRef.current = requestAnimationFrame(animate)
      render()
    }

    /**
     * Renders the scene.
     */
    function render(): void {
      const elapsed = Date.now() - startTime

      if (model) {
        model.rotation.y = elapsed * 0.0005
      }

      controls.update()
      effect.render(scene, camera)
    }

    initScene()
    animate()

    // Cleanup
    return () => {
      window.removeEventListener("resize", handleResize)

      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current)
      }

      if (containerRef.current && effect?.domElement) {
        containerRef.current.removeChild(effect.domElement)
      }

      // Dispose Three.js resources
      scene?.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry?.dispose()
          if (Array.isArray(object.material)) {
            object.material.forEach((material) => material?.dispose())
          } else {
            object.material?.dispose()
          }
        }
      })

      renderer?.dispose()
    }
  }, [containerRef, modelType, enableScrollZoom])
}
