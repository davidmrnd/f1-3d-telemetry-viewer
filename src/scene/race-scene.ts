import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildVisualPlacements } from "./car-placement";
import { carHeadingToRotationY, createCarVisual } from "./car-models";
import {
  buildTrackCenterline,
  buildTransform,
  buildVisualCircuitPath,
  carLengthInScene,
  createGrassTerrainGeometry,
  createTrackRibbon,
  metersToScene,
  offsetPolyline,
  TRACK_KERB_WIDTH_METERS,
  trackWidthInScene,
  type SceneTransform,
  vectorFromPoint,
} from "./track-geometry";
import {
  applyTrackEnvironment,
  getTrackSurfaceMaterials,
  GROUND_PLANE_SIZE_METERS,
  TRACK_TILE_METERS,
} from "./track-environment";
import { RaceCameraController } from "./cameras/race-camera-controller";
import type { CameraMode } from "./cameras/types";
import type { FrameCarState, ReplayFrame, ReplaySegment, StartingGridSlot } from "../types";
import { XrRig } from "./xr/xr-rig";
import { XrSessionController } from "./xr/xr-session";
import { XrControllers } from "./xr/xr-controllers";
import { VrMenu, type VrMenuDriverOption, type VrMenuState } from "./xr/vr-menu";
import { tryTeleportAlongRay } from "./xr/xr-teleport";

interface CarVisual {
  group: THREE.Group;
  label: THREE.Sprite;
}

export type RaceSceneXrHooks = {
  onSessionStart?: () => void;
  onSessionEnd?: () => void;
  getMenuState?: () => VrMenuState;
  onTogglePlay?: () => void;
  onReset?: () => void;
  onSeek?: (ratio: number) => void;
  onSetSpeed?: (speed: number) => void;
  onSetCameraMode?: (mode: CameraMode) => void;
  onSetFollowDriver?: (driverNumber: number) => void;
};

export class RaceScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 8000);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly root = new THREE.Group();
  private readonly carVisuals = new Map<number, CarVisual>();
  private readonly eventBeacon: THREE.Mesh;
  private readonly ground: THREE.Mesh;
  private readonly groundBase: THREE.Mesh;

  private transform: SceneTransform | null = null;
  private startingGrid: StartingGridSlot[] = [];
  private readonly cameraController = new RaceCameraController();
  private lastUpdateMs = performance.now();

  private readonly xrRig = new XrRig();
  private readonly xrSession: XrSessionController;
  private readonly xrControllers: XrControllers;
  private vrMenu: VrMenu | null = null;
  private xrHooks: RaceSceneXrHooks = {};
  private selectHeld = [false, false];
  private selectHoldBusy = false;
  private driversForMenu: VrMenuDriverOption[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera.position.set(120, 45, 120);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 8, 0);
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 1800;

    this.scene.add(this.xrRig.worldRoot);

    const ambient = new THREE.AmbientLight("#eef2f8", 0.45);
    this.xrRig.worldRoot.add(ambient);

    const hemi = new THREE.HemisphereLight("#dbeafe", "#4a5568", 0.75);
    this.xrRig.worldRoot.add(hemi);

    const key = new THREE.DirectionalLight("#fff8f0", 2.2);
    key.position.set(180, 320, 120);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 900;
    key.shadow.camera.left = -400;
    key.shadow.camera.right = 400;
    key.shadow.camera.top = 400;
    key.shadow.camera.bottom = -400;
    this.xrRig.worldRoot.add(key);

    const fill = new THREE.DirectionalLight("#c8d8f0", 0.55);
    fill.position.set(-120, 80, -160);
    this.xrRig.worldRoot.add(fill);

    const fallbackGroundMaterial = new THREE.MeshStandardMaterial({
      color: "#3d5a40",
      roughness: 0.92,
      metalness: 0.02,
    });

    this.groundBase = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_PLANE_SIZE_METERS, GROUND_PLANE_SIZE_METERS),
      new THREE.MeshStandardMaterial({
        color: "#2d4a30",
        roughness: 0.95,
        metalness: 0,
      }),
    );
    this.groundBase.rotation.x = -Math.PI / 2;
    this.groundBase.position.y = -3;
    this.groundBase.receiveShadow = true;
    this.groundBase.renderOrder = -1;
    this.xrRig.worldRoot.add(this.groundBase);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fallbackGroundMaterial.clone());
    this.ground.receiveShadow = true;
    this.ground.renderOrder = 0;
    this.xrRig.worldRoot.add(this.ground);

    this.eventBeacon = new THREE.Mesh(
      new THREE.TorusGeometry(2.2, 0.12, 16, 64),
      new THREE.MeshBasicMaterial({
        color: "#ff8c42",
        transparent: true,
        opacity: 0.85,
      }),
    );
    this.eventBeacon.rotation.x = Math.PI / 2;
    this.eventBeacon.visible = false;
    this.xrRig.worldRoot.add(this.eventBeacon);
    this.xrRig.worldRoot.add(this.root);

    this.xrSession = new XrSessionController(this.renderer, {
      onSessionStart: () => this.handleXrSessionStart(),
      onSessionEnd: () => this.handleXrSessionEnd(),
    });

    this.xrControllers = new XrControllers(this.renderer, {
      onMenuButton: () => this.toggleVrMenu(),
      onSelectStart: (index) => this.handleSelectStart(index),
      onSelectEnd: (index) => {
        this.selectHeld[index] = false;
        this.vrMenu?.endPointer();
      },
    });
    this.xrControllers.setVisible(false);
    this.scene.add(this.xrControllers.group);

    this.cameraController.setMode("broadcast", this.controls);
  }

  setXrHooks(hooks: RaceSceneXrHooks) {
    this.xrHooks = hooks;
  }

  getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  isXrPresenting(): boolean {
    return this.xrSession.isPresenting();
  }

  async enterVr(): Promise<void> {
    await this.xrSession.enterVr();
  }

  async exitVr(): Promise<void> {
    await this.xrSession.exitVr();
  }

  setAnimationLoop(callback: XRFrameRequestCallback | null) {
    this.renderer.setAnimationLoop(callback);
  }

  pollXrInput() {
    if (!this.renderer.xr.isPresenting) {
      return;
    }
    this.xrControllers.update();
    this.updateSelectHold();
  }

  initTrackEnvironment() {
    applyTrackEnvironment(this.scene, this.renderer);
    const grass = getTrackSurfaceMaterials().grass;
    grass.polygonOffset = true;
    grass.polygonOffsetFactor = 1;
    grass.polygonOffsetUnits = 1;
    this.ground.material = grass;
    this.configureGrassTextureRepeat();
  }

  private configureGrassTextureRepeat() {
    const grass = getTrackSurfaceMaterials().grass;
    const maps = [grass.map, grass.normalMap, grass.roughnessMap, grass.aoMap];
    for (const map of maps) {
      if (map) {
        map.repeat.set(1, 1);
        map.needsUpdate = true;
      }
    }
  }

  private rebuildGrassTerrain(
    pathPoints: THREE.Vector3[],
    closed: boolean,
    trackWidth: number,
    kerbWidth: number,
  ) {
    const depressionHalfWidth = trackWidth / 2 + kerbWidth + 1.5;
    this.ground.geometry.dispose();
    this.ground.geometry = createGrassTerrainGeometry({
      halfExtentMeters: GROUND_PLANE_SIZE_METERS / 2,
      gridSpacingMeters: 24,
      grassTileMeters: TRACK_TILE_METERS.grass,
      centerline: pathPoints,
      centerlineClosed: closed,
      trackDepressionHalfWidthMeters: depressionHalfWidth,
      depressionClearanceMeters: 0.75,
      outerClearanceMeters: 0.12,
      clearanceFadeMeters: 28,
    });
    this.groundBase.visible = false;
  }

  private disposeRootContents() {
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
      }
    });
    this.root.clear();
  }

  private buildTrackSurfaces(
    pathPoints: THREE.Vector3[],
    closed: boolean,
    trackWidth: number,
    kerbWidth: number,
  ) {
    const materials = getTrackSurfaceMaterials();
    for (const material of [materials.road, materials.kerb]) {
      material.polygonOffset = true;
      material.polygonOffsetFactor = -4;
      material.polygonOffsetUnits = -4;
    }
    const ribbonOptions = { closed };

    const roadMesh = new THREE.Mesh(
      createTrackRibbon(pathPoints, trackWidth, {
        ...ribbonOptions,
        tileSizeMeters: TRACK_TILE_METERS.road,
      }),
      materials.road,
    );
    roadMesh.position.y = 0.03;
    roadMesh.receiveShadow = true;
    roadMesh.renderOrder = 2;
    this.root.add(roadMesh);

    const kerbOffset = trackWidth / 2 + kerbWidth / 2;
    for (const offset of [kerbOffset, -kerbOffset]) {
      const kerbPath = offsetPolyline(pathPoints, offset, closed);
      const kerbMesh = new THREE.Mesh(
        createTrackRibbon(kerbPath, kerbWidth, {
          ...ribbonOptions,
          tileSizeMeters: TRACK_TILE_METERS.kerb,
        }),
        materials.kerb,
      );
      kerbMesh.position.y = 0.035;
      kerbMesh.receiveShadow = true;
      kerbMesh.renderOrder = 3;
      this.root.add(kerbMesh);
    }
  }

  resize() {
    if (this.renderer.xr.isPresenting) {
      return;
    }
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
  }

  private framePreviewCamera(samplePoints: THREE.Vector3[]) {
    if (samplePoints.length === 0) {
      return;
    }

    const bounds = new THREE.Box3().setFromPoints(samplePoints);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 40) * 0.55;
    const eyeHeight = Math.max(center.y + 12, 14);

    this.controls.target.copy(center);
    this.camera.position.set(center.x + radius, eyeHeight, center.z + radius);
    this.controls.minDistance = 3;
    this.controls.maxDistance = Math.max(radius * 6, 400);
    this.controls.update();
  }

  loadSegment(segment: ReplaySegment) {
    this.disposeRootContents();
    this.carVisuals.clear();
    const transform = buildTransform(segment);
    this.transform = transform;
    this.startingGrid = segment.startingGrid ?? [];

    this.driversForMenu = segment.drivers.map((driver) => ({
      driverNumber: driver.driverNumber,
      label: driver.acronym || driver.fullName || `#${driver.driverNumber}`,
    }));

    const { path: pathPoints, closed } = buildVisualCircuitPath(
      buildTrackCenterline(segment).map((point) => vectorFromPoint(point, transform)),
    );
    const samplePoints = Object.values(segment.samples)
      .flat()
      .map((sample) =>
        vectorFromPoint(
          {
            x: sample.x,
            y: sample.y,
            z: sample.z,
          },
          transform,
        ),
      );

    const trackWidth = trackWidthInScene(transform);
    const kerbWidth = metersToScene(TRACK_KERB_WIDTH_METERS, transform);

    if (pathPoints.length > 1) {
      this.rebuildGrassTerrain(pathPoints, closed, trackWidth, kerbWidth);
    }

    if (pathPoints.length > 4) {
      this.buildTrackSurfaces(pathPoints, closed, trackWidth, kerbWidth);
    }

    for (const corner of segment.circuit.corners) {
      const markerPoint = vectorFromPoint(
        {
          x: corner.x,
          y: 0,
          z: corner.y,
        },
        transform,
      );
      const marker = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, 1.2, 12),
        new THREE.MeshStandardMaterial({
          color: "#ff8c42",
          emissive: "#ff8c42",
          emissiveIntensity: 0.35,
        }),
      );
      marker.position.copy(markerPoint);
      marker.position.y += 0.6;
      this.root.add(marker);
    }

    segment.drivers.forEach((driver) => {
      const visual = createCarVisual(driver, carLengthInScene(transform));
      this.carVisuals.set(driver.driverNumber, visual);
      this.root.add(visual.group);
    });

    this.cameraController.loadSegment(segment, transform);
    if (this.cameraController.getMode() === "orbit") {
      this.framePreviewCamera(samplePoints);
    }

    if (this.vrMenu) {
      this.vrMenu.setState({ drivers: this.driversForMenu });
    }
  }

  setCameraMode(mode: CameraMode) {
    this.cameraController.setMode(mode, this.controls);
    this.vrMenu?.setState({ cameraMode: mode });
  }

  setFollowDriver(driverNumber: number) {
    this.cameraController.setFollowDriver(driverNumber);
    this.vrMenu?.setState({ followDriver: driverNumber });
  }

  getFollowDriver(): number | null {
    return this.cameraController.getFollowDriver();
  }

  getCameraMode(): CameraMode {
    return this.cameraController.getMode();
  }

  getActiveCameraLabel(): string {
    return this.cameraController.getActiveLabel();
  }

  syncVrMenuState(partial: Partial<VrMenuState>) {
    this.vrMenu?.setState(partial);
  }

  /** Actualiza simulación y cámara; no renderiza (usar con setAnimationLoop). */
  update(frame: ReplayFrame) {
    const nowMs = performance.now();
    const deltaSeconds = Math.min((nowMs - this.lastUpdateMs) / 1000, 0.1);
    this.lastUpdateMs = nowMs;

    this.resize();
    const xrPresenting = this.renderer.xr.isPresenting;
    const transform = this.transform;
    if (!transform) {
      return;
    }

    const visualPlacements = buildVisualPlacements(frame, transform, {
      startingGrid: this.startingGrid,
    });

    visualPlacements.forEach(({ car, position }) => {
      const visual = this.carVisuals.get(car.driver.driverNumber);
      if (!visual) {
        return;
      }

      visual.group.position.copy(position);
      visual.group.rotation.y = carHeadingToRotationY(car.heading);
      visual.group.rotation.x = -car.pitch;
      visual.label.visible = frame.activeEvent?.drivers.includes(car.driver.driverNumber) ?? false;
    });

    if (frame.activeEvent) {
      const [a, b] = frame.activeEvent.drivers
        .map((driverNumber) => frame.cars.find((car) => car.driver.driverNumber === driverNumber))
        .filter(Boolean) as FrameCarState[];

      if (a && b) {
        const positionA = this.carVisuals.get(a.driver.driverNumber)?.group.position;
        const positionB = this.carVisuals.get(b.driver.driverNumber)?.group.position;
        if (positionA && positionB) {
          this.eventBeacon.visible = true;
          this.eventBeacon.position.copy(positionA.clone().lerp(positionB, 0.5));
          this.eventBeacon.position.y = Math.max(positionA.y, positionB.y) + 2.4;
          const pulse = 1 + Math.sin(performance.now() * 0.008) * 0.08;
          this.eventBeacon.scale.setScalar(pulse);
        }
      }
    } else {
      this.eventBeacon.visible = false;
    }

    if (xrPresenting) {
      this.controls.enabled = false;
    }

    this.cameraController.update(
      visualPlacements,
      this.camera,
      this.controls,
      deltaSeconds,
      xrPresenting,
    );

    if (xrPresenting) {
      this.xrRig.applyDesiredCamera(this.camera);
      this.vrMenu?.update();
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  private ensureVrMenu() {
    if (this.vrMenu) {
      return this.vrMenu;
    }

    const initial: VrMenuState = this.xrHooks.getMenuState?.() ?? {
      playing: true,
      normalizedTime: 0,
      timeLabel: "00:00.0 / 00:00.0",
      speed: 1,
      cameraMode: this.getCameraMode(),
      followDriver: this.getFollowDriver(),
      drivers: this.driversForMenu,
    };

    this.vrMenu = new VrMenu(
      {
        onTogglePlay: () => this.xrHooks.onTogglePlay?.(),
        onReset: () => this.xrHooks.onReset?.(),
        onSeek: (ratio) => this.xrHooks.onSeek?.(ratio),
        onSetSpeed: (speed) => this.xrHooks.onSetSpeed?.(speed),
        onSetCameraMode: (mode) => this.xrHooks.onSetCameraMode?.(mode),
        onSetFollowDriver: (driverNumber) => this.xrHooks.onSetFollowDriver?.(driverNumber),
        onClose: () => this.vrMenu?.setOpen(false),
      },
      initial,
    );
    this.scene.add(this.vrMenu.group);
    return this.vrMenu;
  }

  private toggleVrMenu() {
    if (!this.isXrPresenting()) {
      return;
    }
    const menu = this.ensureVrMenu();
    const opening = !menu.isOpen();
    if (opening) {
      const state = this.xrHooks.getMenuState?.();
      if (state) {
        menu.setState(state);
      }
      const xrCamera = this.renderer.xr.getCamera();
      menu.placeInFrontOf(xrCamera);
    }
    menu.setOpen(opening);
  }

  private handleSelectStart(controllerIndex: number) {
    this.selectHeld[controllerIndex] = true;
    if (!this.isXrPresenting()) {
      return;
    }

    const raycaster = this.xrControllers.getRaycaster(controllerIndex);
    if (!raycaster) {
      return;
    }

    const menu = this.vrMenu;
    if (menu?.isOpen()) {
      if (menu.handleRaycast(raycaster)) {
        return;
      }
    }

    if (this.getCameraMode() === "orbit" && !menu?.isOpen()) {
      this.xrRig.worldRoot.updateMatrixWorld(true);
      tryTeleportAlongRay(raycaster, this.camera, [this.ground, this.groundBase, this.root]);
      this.xrRig.applyDesiredCamera(this.camera);
    }
  }

  private updateSelectHold() {
    const menu = this.vrMenu;
    if (!menu?.isOpen() || this.selectHoldBusy) {
      return;
    }
    this.selectHoldBusy = true;
    try {
      for (let i = 0; i < this.selectHeld.length; i += 1) {
        if (!this.selectHeld[i]) {
          continue;
        }
        const raycaster = this.xrControllers.getRaycaster(i);
        if (raycaster) {
          menu.handleRaycastHold(raycaster);
        }
      }
    } finally {
      this.selectHoldBusy = false;
    }
  }

  private handleXrSessionStart() {
    this.xrRig.setActive(true);
    this.xrControllers.setVisible(true);
    this.controls.enabled = false;
    this.ensureVrMenu();
    this.xrHooks.onSessionStart?.();
  }

  private handleXrSessionEnd() {
    this.xrRig.setActive(false);
    this.xrRig.reset();
    this.xrControllers.setVisible(false);
    this.vrMenu?.setOpen(false);
    this.selectHeld = [false, false];
    if (this.getCameraMode() !== "orbit" && this.getCameraMode() !== "onboard") {
      this.controls.enabled = false;
    }
    
    this.cameraController.setMode(this.getCameraMode(), this.controls);
    this.resize();
    this.xrHooks.onSessionEnd?.();
  }
}
