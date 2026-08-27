import { useEffect, useRef, useState } from "react";
import {
  AdditiveBlending,
  AmbientLight,
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  NormalBlending,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { G1MonitorState } from "../api";

const MODEL_URL = "/assets/g1/g1_29dof_rev_1_0.glb";

type LoadPhase = "loading" | "ready" | "unsupported" | "failed";

function disposeModel(model: Group) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    geometries.add(object.geometry);
    const entries = Array.isArray(object.material) ? object.material : [object.material];
    entries.forEach((material) => materials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

export function G1Hologram({ streamState }: { streamState: G1MonitorState }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<LoadPhase>("loading");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !("WebGLRenderingContext" in window)) {
      setPhase("unsupported");
      return;
    }

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
    } catch (error) {
      console.warn("G1 hologram WebGL initialization failed", error);
      setPhase("failed");
      return;
    }

    let alive = true;
    let model: Group | null = null;
    const scene = new Scene();
    const camera = new PerspectiveCamera(34, 1, 0.01, 100);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = false;
    controls.enablePan = false;
    controls.minDistance = 0.6;
    controls.maxDistance = 4;
    controls.minPolarAngle = Math.PI * 0.18;
    controls.maxPolarAngle = Math.PI * 0.76;
    scene.add(new AmbientLight(new Color("#a8dcff"), 1.8));
    const keyLight = new DirectionalLight(new Color("#7ac8ff"), 2.4);
    keyLight.position.set(1.4, 1.8, 2.8);
    scene.add(keyLight);
    const rimLight = new DirectionalLight(new Color("#d7f3ff"), 1.2);
    rimLight.position.set(-1.2, 0.6, -2.2);
    scene.add(rimLight);

    const render = () => renderer.render(scene, camera);
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    controls.addEventListener("change", render);

    new GLTFLoader().load(
      MODEL_URL,
      (gltf) => {
        if (!alive) {
          disposeModel(gltf.scene);
          return;
        }
        model = gltf.scene;
        const meshes: Mesh[] = [];
        model.traverse((object) => {
          if (object instanceof Mesh) meshes.push(object);
        });
        meshes.forEach((mesh) => {
          mesh.geometry.computeVertexNormals();
          mesh.material = new MeshPhongMaterial({
            color: new Color("#167fc8"),
            emissive: new Color("#062b4d"),
            emissiveIntensity: 0.75,
            transparent: true,
            opacity: 0.86,
            shininess: 68,
            specular: new Color("#d4f1ff"),
            depthWrite: true,
            blending: NormalBlending,
          });
          const edges = new Mesh(mesh.geometry, new MeshBasicMaterial({
            color: new Color("#d7f0ff"),
            transparent: true,
            opacity: 0.07,
            wireframe: true,
            depthWrite: false,
            blending: AdditiveBlending,
          }));
          mesh.add(edges);
        });
        model.rotation.x = -Math.PI / 2;
        const bounds = new Box3().setFromObject(model);
        const center = bounds.getCenter(new Vector3());
        const size = bounds.getSize(new Vector3());
        model.position.sub(center);
        scene.add(model);
        const extent = Math.max(size.x, size.y, size.z);
        camera.position.set(extent * 0.72, extent * 0.24, extent * 1.45);
        controls.target.set(0, size.y * 0.04, 0);
        controls.update();
        setPhase("ready");
        resize();
      },
      undefined,
      (error) => {
        console.warn("G1 hologram asset load failed", error);
        if (alive) setPhase("failed");
      },
    );

    return () => {
      alive = false;
      observer.disconnect();
      controls.removeEventListener("change", render);
      controls.dispose();
      if (model) disposeModel(model);
      renderer.dispose();
    };
  }, []);

  const status = phase === "loading"
    ? "正在载入官方 G1 几何"
    : phase === "unsupported"
      ? "此浏览器未提供 WebGL"
      : phase === "failed"
        ? "G1 模型未能载入"
        : "拖拽查看机身";

  return (
    <section className={`g1-hologram is-${streamState} is-model-${phase}`} aria-label="Unitree G1 静态外观全息投影">
      <header>
        <span>G1 EXTERIOR / STATIC</span>
        <span>29 DoF · BSD-3-Clause</span>
      </header>
      <div className="g1-hologram-stage">
        <canvas ref={canvasRef} />
        <div className="g1-hologram-plinth" aria-hidden="true" />
        <p className={`g1-hologram-status is-${phase}`} aria-live="polite">{status}</p>
      </div>
      <footer>
        <span>真实外观模型</span>
        <span>姿态未接入</span>
      </footer>
    </section>
  );
}
