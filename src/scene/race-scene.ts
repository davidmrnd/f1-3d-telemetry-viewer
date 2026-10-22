import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  buildDriverGridHolds,
  buildVisualPlacements,
  GridLateralOffsetBlender,
} from "./car-placement";
import { applyCarVisualQuality, carHeadingToRotationY, createCarVisual, disposeCarVisual } from "./car-models";
import {
  buildTrackCenterline,
  buildTransform,
  buildVisualCircuitPath,
  buildTrackCrossSections,
  carLengthInScene,
  createGrassTerrainGeometry,
  createTrackRibbon,
  metersToScene,
  TRACK_KERB_WIDTH_METERS,
  trackWidthInScene,
  type SceneTransform,
  type TrackCrossSection,
  vectorFromPoint,
} from "./track-geometry";
import {
  applyTrackEnvironment,
  applySkyQuality,
  applySurfaceQuality,
  getTrackSurfaceMaterials,
  GROUND_PLANE_SIZE_METERS,
  TRACK_TILE_METERS,
} from "./track-environment";
import { RaceCameraController } from "./cameras/race-camera-controller";
import type { CameraMode } from "./cameras/types";
import {
  DEFAULT_GRAPHICS_SETTINGS,
  type GraphicsSettings,
} from "./graphics-settings";
import {
  applyLaunchHoldToFrame,
  createStartFinishDecor,
  type StartFinishDecor,
} from "./start-finish";
import type { FrameCarState, ReplayFrame, ReplaySegment, StartingGridSlot } from "../types";
import { XrRig } from "./xr/xr-rig";
import { XrSessionController } from "./xr/xr-session";
import { XrControllers } from "./xr/xr-controllers";
import { VrMenu, type VrMenuDriverOption, type VrMenuState } from "./xr/vr-menu";
import { tryTeleportAlongRay } from "./xr/xr-teleport";
import { RaceLighting } from "./lighting";
import { CarContactShadows } from "./car-contact-shadows";
import { createTrackDecor, type TrackDecor } from "./track/track-decor";
import { DistantCars } from "./distant-cars";

interface CarVisual {
  group: THREE.Group;
  label: THREE.Sprite;
  color: THREE.Color;
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
  onSetGraphicsSettings?: (settings: GraphicsSettings) => void;
};

export class RaceScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 8000);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly root = new THREE.Group();
  private readonly carVisuals = new Map<number, CarVisual>();
  private readonly viewportSize = new THREE.Vector2();
  private readonly eventBeacon: THREE.Mesh;
  private readonly ground: THREE.Mesh;
  private readonly groundBase: THREE.Mesh;
  private readonly lighting: RaceLighting;
  private trackDecor: TrackDecor | null = null;
  private contactShadows: CarContactShadows | null = null;
  private distantCars: DistantCars | null = null;

  private transform: SceneTransform | null = null;
  private startingGrid: StartingGridSlot[] = [];
  private readonly gridLateralBlender = new GridLateralOffsetBlender();
  private readonly cameraController = new RaceCameraController();
  private startFinish: StartFinishDecor | null = null;
  private lastUpdateMs = performance.now();
  private environmentMap: THREE.Texture | null = null;
  private graphicsSettings: GraphicsSettings = { ...DEFAULT_GRAPHICS_SETTINGS };

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

    this.lighting = new RaceLighting(this.xrRig.worldRoot);

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
    this.renderer.xr.setFramebufferScaleFactor(this.graphicsSettings.xrScale);
    this.renderer.xr.setFoveation(this.graphicsSettings.xrFoveation);
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
    this.environmentMap =
      this.scene.environment instanceof THREE.Texture ? this.scene.environment : null;
    const grass = getTrackSurfaceMaterials().grass;
    grass.polygonOffset = true;
    grass.polygonOffsetFactor = 1;
    grass.polygonOffsetUnits = 1;
    this.ground.material = grass;
    this.configureGrassTextureRepeat();
  }

  getGraphicsSettings(): GraphicsSettings {
    return { ...this.graphicsSettings };
  }

  applyGraphicsSettings(settings: GraphicsSettings) {
    this.graphicsSettings = { ...settings };
    if (!this.renderer.xr.isPresenting) {
      this.renderer.setPixelRatio(settings.maxPixelRatio);
      this.renderer.xr.setFramebufferScaleFactor(settings.xrScale);
    }
    this.renderer.xr.setFoveation(settings.xrFoveation);
    this.resize();
    this.camera.far = settings.drawDistance;
    this.camera.updateProjectionMatrix();
    const fogColor = this.lighting.apply(settings, this.renderer);
    this.scene.environment = settings.environment ? this.environmentMap : null;
    this.scene.fog = settings.fog ? new THREE.Fog(fogColor, settings.drawDistance * 0.22, settings.drawDistance * 0.96) : null;
    applySkyQuality(this.scene, settings, fogColor);
    applySurfaceQuality(settings, this.renderer);
    this.trackDecor?.applySettings(settings);
    if (this.contactShadows) this.contactShadows.mesh.visible = settings.contactShadows;
    this.applyCarVisualGraphics(settings);
    this.vrMenu?.setState({ graphics: this.graphicsSettings });
  }

  private applyCarVisualGraphics(settings: GraphicsSettings) {
    const castShadows = settings.carShadows && settings.shadows !== "off";
    for (const visual of this.carVisuals.values()) {
      applyCarVisualQuality(visual.group, {
        materials: settings.carMaterials,
        castShadows,
      });
    }
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
    crossSections: TrackCrossSection[],
  ) {
    this.ground.geometry.dispose();
    this.ground.geometry = createGrassTerrainGeometry({
      halfExtentMeters: GROUND_PLANE_SIZE_METERS / 2,
      gridSpacingMeters: 16,
      grassTileMeters: TRACK_TILE_METERS.grass,
      centerline: pathPoints,
      centerlineClosed: closed,
      trackHalfWidthMeters: trackWidth / 2 + kerbWidth,
      crossSections,
      outerClearanceMeters: 0.12,
      clearanceFadeMeters: 28,
    });
    this.groundBase.visible = false;
  }

  private disposeRootContents() {
    const finishMaterials = new Set<THREE.Material>();
    this.startFinish?.group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => finishMaterials.add(material));
      }
    });
    finishMaterials.forEach((material) => {
      if (material instanceof THREE.MeshStandardMaterial) material.map?.dispose();
      material.dispose();
    });
    this.startFinish = null;
    for (const visual of this.carVisuals.values()) {
      this.root.remove(visual.group);
      disposeCarVisual(visual.group);
    }
    if (this.trackDecor) {
      this.root.remove(this.trackDecor.group);
      this.trackDecor.dispose();
      this.trackDecor = null;
    }
    if (this.contactShadows) {
      this.root.remove(this.contactShadows.mesh);
      this.contactShadows.dispose();
      this.contactShadows = null;
    }
    if (this.distantCars) {
      this.root.remove(this.distantCars.group);
      this.distantCars.dispose();
      this.distantCars = null;
    }
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
    crossSections: TrackCrossSection[],
  ) {
    const materials = getTrackSurfaceMaterials();
    const ribbonOptions = { closed, crossSections };

    const roadMesh = new THREE.Mesh(
      createTrackRibbon(pathPoints, trackWidth, {
        ...ribbonOptions,
        tileSizeMeters: TRACK_TILE_METERS.road,
      }),
      materials.road,
    );
    roadMesh.receiveShadow = true;
    roadMesh.renderOrder = 2;
    this.root.add(roadMesh);

    const kerbOffset = trackWidth / 2 + kerbWidth / 2;
    for (const offset of [kerbOffset, -kerbOffset]) {
      const kerbMesh = new THREE.Mesh(
        createTrackRibbon(pathPoints, kerbWidth, {
          ...ribbonOptions,
          offsetMeters: offset,
          tileSizeMeters: TRACK_TILE_METERS.kerb,
        }),
        materials.kerb,
      );
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

    const size = this.renderer.getSize(this.viewportSize);
    if (size.x !== width || size.y !== height) {
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
    this.gridLateralBlender.reset(buildDriverGridHolds(segment));

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
    const crossSections = buildTrackCrossSections(pathPoints, closed, trackWidth / 2 + kerbWidth);

    if (pathPoints.length > 1) {
      this.rebuildGrassTerrain(pathPoints, closed, trackWidth, kerbWidth, crossSections);
    }

    if (pathPoints.length > 4) {
      this.buildTrackSurfaces(pathPoints, closed, trackWidth, kerbWidth, crossSections);
      this.trackDecor = createTrackDecor(pathPoints, crossSections, closed, trackWidth, kerbWidth,
        this.ground.geometry, /monte|monaco|baku/i.test(segment.sessionRef.circuitShortName));
      this.root.add(this.trackDecor.group);
    }

    this.startFinish = createStartFinishDecor(segment, pathPoints, transform, trackWidth);
    if (this.startFinish) {
      this.root.add(this.startFinish.group);
    }

    segment.drivers.forEach((driver) => {
      const visual = createCarVisual(driver, carLengthInScene(transform));
      this.carVisuals.set(driver.driverNumber, { ...visual, color: new THREE.Color(driver.teamColor) });
      this.root.add(visual.group);
    });
    this.contactShadows = new CarContactShadows(segment.drivers.length);
    this.root.add(this.contactShadows.mesh);
    this.distantCars = new DistantCars(segment.drivers.length);
    this.root.add(this.distantCars.group);
    this.applyGraphicsSettings(this.graphicsSettings);

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

    const heldFrame = this.startFinish
      ? applyLaunchHoldToFrame(
          frame,
          this.startFinish.greenAt,
          this.startFinish.launchHoldPoses,
        )
      : frame;

    const { offsets: lateralOffsets, rates: lateralRates } = this.gridLateralBlender.resolve(
      heldFrame,
      this.startingGrid,
    );
    const visualPlacements = buildVisualPlacements(heldFrame, transform, {
      lateralOffsets,
      lateralRates,
    });

    visualPlacements.forEach(({ car, position, heading }, index) => {
      const visual = this.carVisuals.get(car.driver.driverNumber);
      if (!visual) {
        return;
      }

      visual.group.position.copy(position);
      visual.group.rotation.y = carHeadingToRotationY(heading);
      visual.group.rotation.x = -car.pitch;
      visual.label.visible = false;
      this.contactShadows?.setCar(index, position, heading, car.pitch);
    });
    this.contactShadows?.finish(visualPlacements.length);

    this.eventBeacon.visible = false;
    this.startFinish?.update(frame.now);

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
    const followed = this.carVisuals.get(this.getFollowDriver() ?? -1);
    this.lighting.update(this.getCameraMode() === "orbit" ? this.controls.target : followed?.group.position ?? this.camera.position);
    let distantCount = 0;
    const distance = this.graphicsSettings.detailedCarDistance;
    for (const visual of this.carVisuals.values()) {
      const threshold = distance * (visual.group.visible ? 1.1 : 0.9);
      visual.group.visible = visual.group.position.distanceToSquared(this.camera.position) < threshold * threshold;
      if (!visual.group.visible) {
        visual.group.updateMatrix();
        this.distantCars?.setCar(distantCount++, visual.group.matrix, visual.color);
      }
    }
    this.distantCars?.finish(distantCount);

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
      graphics: this.graphicsSettings,
    };

    this.vrMenu = new VrMenu(
      {
        onTogglePlay: () => this.xrHooks.onTogglePlay?.(),
        onReset: () => this.xrHooks.onReset?.(),
        onSeek: (ratio) => this.xrHooks.onSeek?.(ratio),
        onSetSpeed: (speed) => this.xrHooks.onSetSpeed?.(speed),
        onSetCameraMode: (mode) => this.xrHooks.onSetCameraMode?.(mode),
        onSetFollowDriver: (driverNumber) => this.xrHooks.onSetFollowDriver?.(driverNumber),
        onSetGraphicsSettings: (settings) => this.xrHooks.onSetGraphicsSettings?.(settings),
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
    this.applyGraphicsSettings(this.graphicsSettings);
    this.xrHooks.onSessionEnd?.();
  }
}
