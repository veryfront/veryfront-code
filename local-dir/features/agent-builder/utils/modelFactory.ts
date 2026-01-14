/**
 * @fileoverview Factory for creating 3D models based on type.
 */

import * as THREE from "https://esm.sh/three@0.181.2"
import { GLTFLoader } from "https://esm.sh/three@0.181.2/examples/jsm/loaders/GLTFLoader.js"

/** Available 3D model types for the ASCII scene. */
type ModelType = "agent" | "webapp" | "aiapp" | "webshop" | "dream"

const GLTF_MODEL_URL =
  "https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/animations/head.glb"

/**
 * Creates a 3D model and adds it to the scene.
 *
 * @param type - Type of model to create
 * @param scene - Three.js scene to add model to
 * @returns Promise resolving to the created model
 */
export async function createModel(
  type: ModelType,
  scene: THREE.Scene,
): Promise<THREE.Object3D> {
  switch (type) {
    case "webapp":
      return createWebAppModel(scene)
    case "aiapp":
      return createAIAppModel(scene)
    case "webshop":
      return createWebShopModel(scene)
    case "dream":
      return createDreamModel(scene)
    case "agent":
    default:
      return createAgentModel(scene)
  }
}

/**
 * Creates a wireframe globe for webapp mode.
 */
function createWebAppModel(scene: THREE.Scene): THREE.Object3D {
  const group = new THREE.Group()

  const sphereGeometry = new THREE.SphereGeometry(130, 32, 32)
  const sphereMaterial = new THREE.MeshPhongMaterial({
    flatShading: true,
    wireframe: false,
  })
  const globeSphere = new THREE.Mesh(sphereGeometry, sphereMaterial)
  group.add(globeSphere)

  const wireframeGeometry = new THREE.SphereGeometry(131, 16, 16)
  const wireframeMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    wireframe: true,
    wireframeLinewidth: 2,
  })
  const wireframe = new THREE.Mesh(wireframeGeometry, wireframeMaterial)
  group.add(wireframe)

  group.position.y = 0
  scene.add(group)
  return group
}

/**
 * Creates a neural network visualization for AI app mode.
 */
function createAIAppModel(scene: THREE.Scene): THREE.Object3D {
  const group = new THREE.Group()
  const nodeMaterial = new THREE.MeshPhongMaterial({ flatShading: true })
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0x000000 })

  const layers = [4, 6, 6, 4]
  const layerSpacing = 80
  const nodeRadius = 15
  const nodeSpacing = 40

  // Create nodes
  const nodes: THREE.Vector3[][] = []
  for (let l = 0; l < layers.length; l++) {
    const nodesInLayer = layers[l]
    const xPos = (l - (layers.length - 1) / 2) * layerSpacing
    nodes[l] = []

    for (let n = 0; n < nodesInLayer; n++) {
      const yPos = (n - (nodesInLayer - 1) / 2) * nodeSpacing
      const nodeGeometry = new THREE.SphereGeometry(nodeRadius, 8, 8)
      const node = new THREE.Mesh(nodeGeometry, nodeMaterial)
      node.position.set(xPos, yPos, 0)
      group.add(node)
      nodes[l].push(new THREE.Vector3(xPos, yPos, 0))
    }
  }

  // Create connections
  for (let l = 0; l < layers.length - 1; l++) {
    for (let n1 = 0; n1 < nodes[l].length; n1++) {
      for (let n2 = 0; n2 < nodes[l + 1].length; n2++) {
        const lineGeometry = new THREE.BufferGeometry().setFromPoints([
          nodes[l][n1],
          nodes[l + 1][n2],
        ])
        const line = new THREE.Line(lineGeometry, lineMaterial)
        group.add(line)
      }
    }
  }

  group.position.y = 0
  scene.add(group)
  return group
}

/**
 * Creates a shopping bag visualization for webshop mode.
 */
function createWebShopModel(scene: THREE.Scene): THREE.Object3D {
  const group = new THREE.Group()
  const material = new THREE.MeshPhongMaterial({ flatShading: true })

  // Main bag body
  const bagGeometry = new THREE.CylinderGeometry(90, 70, 140, 4)
  const bag = new THREE.Mesh(bagGeometry, material)
  bag.position.y = -10
  group.add(bag)

  // Handles
  const handleRadius = 12
  const handleCurve = new THREE.TorusGeometry(30, handleRadius, 12, 24, Math.PI)

  const leftHandle = new THREE.Mesh(handleCurve, material)
  leftHandle.position.set(-45, 75, 0)
  leftHandle.rotation.z = Math.PI
  group.add(leftHandle)

  const rightHandle = new THREE.Mesh(handleCurve, material)
  rightHandle.position.set(45, 75, 0)
  rightHandle.rotation.z = Math.PI
  group.add(rightHandle)

  // Products
  for (let i = 0; i < 3; i++) {
    const productGeometry = new THREE.BoxGeometry(25, 40, 25)
    const product = new THREE.Mesh(productGeometry, material)
    product.position.set(-30 + i * 30, 55, 0)
    product.rotation.z = (Math.random() - 0.5) * 0.3
    group.add(product)
  }

  group.position.y = 0
  group.scale.set(1.3, 1.3, 1.3)
  scene.add(group)
  return group
}

/**
 * Creates a dreamy cloud with stars.
 */
function createDreamModel(scene: THREE.Scene): THREE.Object3D {
  const group = new THREE.Group()
  const material = new THREE.MeshPhongMaterial({ flatShading: true })

  // Cloud spheres
  const cloudSpheres = [
    { radius: 50, pos: [0, 0, 0] as const },
    { radius: 40, pos: [-50, 10, 0] as const },
    { radius: 45, pos: [45, 5, 0] as const },
    { radius: 35, pos: [20, 35, 0] as const },
    { radius: 35, pos: [-25, 30, 0] as const },
    { radius: 30, pos: [0, -25, 0] as const },
  ]

  cloudSpheres.forEach(({ radius, pos }) => {
    const sphereGeometry = new THREE.SphereGeometry(radius, 8, 8)
    const sphere = new THREE.Mesh(sphereGeometry, material)
    sphere.position.set(...pos)
    group.add(sphere)
  })

  // Stars
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2
    const distance = 120 + Math.random() * 30
    const starSize = 8 + Math.random() * 8

    const starGeometry = new THREE.ConeGeometry(starSize, starSize * 2, 4)
    const star = new THREE.Mesh(starGeometry, material)
    star.position.set(
      Math.cos(angle) * distance,
      Math.sin(angle) * distance,
      (Math.random() - 0.5) * 50,
    )
    star.rotation.z = angle + Math.PI / 4
    group.add(star)
  }

  group.position.y = 0
  group.scale.set(1.2, 1.2, 1.2)
  scene.add(group)
  return group
}

/**
 * Loads and creates the agent head model from GLTF.
 */
function createAgentModel(scene: THREE.Scene): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader()

    loader.load(
      GLTF_MODEL_URL,
      (gltf) => {
        const model = gltf.scene

        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.material = new THREE.MeshPhongMaterial({ flatShading: true })
          }
        })

        model.scale.set(50, 50, 50)
        model.position.y = -50
        scene.add(model)
        resolve(model)
      },
      undefined,
      (error) => {
        console.error("Failed to load GLTF model:", error)
        reject(error)
      },
    )
  })
}
