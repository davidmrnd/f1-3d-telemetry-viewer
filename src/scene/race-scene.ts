import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  buildDriverGridHolds,
  buildVisualPlacements,
  GridLateralOffsetBlender,
} from "./car-placement";
import {
  applyCarVisualQuality,
  carHeadingToRotationY,
  createCarVisual,
  disposeCarVisual,
} from "./car-models";
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
import type { DriverInfo, FrameCarState, ReplayFrame, ReplaySegment, StartingGridSlot } from "../types";
import { XrRig } from "./xr/xr-rig";
import { XrSessionController } from "./xr/xr-session";
import { XrControllers } from "./xr/xr-controllers";
import { XrFlight } from "./xr/xr-flight";
import { XrInterface } from "./xr/xr-interface";
import type { XrPlaybackState } from "./xr/xr-controls-panel";
import { RaceLighting } from "./lighting";
import { CarContactShadows } from "./car-contact-shadows";
import { createTrackDecor, type TrackDecor } from "./track/track-decor";
import { TabletopModel } from "./tabletop/tabletop-model";
import { TabletopXr } from "./tabletop/tabletop-xr";

export type PresentationMode = "realistic" | "tabletop";

interface CarVisual {
  group: THREE.Group;
  detailed: THREE.Group;
  lowpoly: THREE.Group;
  label: THREE.Sprite;
  color: THREE.Color;
}

export type RaceSceneXrHooks = {
  onTogglePlay?: () => void;
  getPlaybackState?: () => XrPlaybackState;
  onJump?: (seconds: number) => void;
  onSeek?: (ratio: number) => void;
  onSetSpeed?: (speed: number) => void;
  getWristVisible?: () => boolean;
  onWristVisible?: (visible: boolean) => void;
  onSessionStart?: () => void;
  onSessionEnd?: () => void;
  onCameraModeChange?: (mode: CameraMode) => void;
  onFollowDriverChange?: (driverNumber: number) => void;
};

export class RaceScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 8000);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly root = new THREE.Group();
  private readonly tabletopScene = new THREE.Scene();
  private readonly tabletop = new TabletopModel();
  private readonly tabletopCamera = new THREE.PerspectiveCamera(45, 1, .01, 50);
  private readonly tabletopControls: OrbitControls;
  private readonly tabletopXr: TabletopXr;
  private presentationMode: PresentationMode = "realistic";
  private modeBeforeXr: PresentationMode = "realistic";
  private readonly carVisuals = new Map<number, CarVisual>();
  private readonly viewportSize = new THREE.Vector2();
  private readonly eventBeacon: THREE.Mesh;
  private readonly ground: THREE.Mesh;
  private readonly groundBase: THREE.Mesh;
  private readonly lighting: RaceLighting;
  private trackDecor: TrackDecor | null = null;
  private contactShadows: CarContactShadows | null = null;

  private transform: SceneTransform | null = null;
  private loadedDrivers: DriverInfo[] = [];
  private carSceneLength = 1;
  private startingGrid: StartingGridSlot[] = [];
  private readonly gridLateralBlender = new GridLateralOffsetBlender();
  private readonly cameraController = new RaceCameraController();
  private startFinish: StartFinishDecor | null = null;
  private lastUpdateMs = performance.now();
  private environmentMap: THREE.Texture | null = null;
  private graphicsSettings: GraphicsSettings = { ...DEFAULT_GRAPHICS_SETTINGS };
  private graphicsInitialized = false;

  private readonly xrRig = new XrRig();
  private readonly xrViewCamera = new THREE.PerspectiveCamera(60, 1, 0.05, 8000);
  private readonly xrHead = new THREE.PerspectiveCamera();
  private xrHeadValid = false;
  private readonly xrFlight = new XrFlight();
  private readonly xrYaw = new THREE.Quaternion();
  private readonly xrEuler = new THREE.Euler(0, 0, 0, "YXZ");
  private xrShotKey: string | null = null;
  private readonly xrSession: XrSessionController;
  private readonly xrControllers: XrControllers;
  private xrHooks: RaceSceneXrHooks = {};
  private xrDrivers: number[] = [];
  private xrDriverInfo: DriverInfo[] = [];
  private xrInterface: XrInterface | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
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
    this.tabletopScene.background = new THREE.Color("#0b1520");
    this.tabletopScene.add(this.tabletop.group);
    this.tabletopCamera.position.set(1.05, 1.2, 1.05);
    this.tabletopControls = new OrbitControls(this.tabletopCamera, this.canvas);
    this.tabletopControls.enableDamping = true;
    this.tabletopControls.minDistance = .2;
    this.tabletopControls.maxDistance = 10;
    this.tabletopControls.maxPolarAngle = Math.PI * .48;
    this.tabletopControls.enabled = false;

    this.scene.add(this.xrRig.worldRoot);
    this.scene.add(this.xrRig.viewerRoot);
    this.xrRig.viewerRoot.add(this.xrViewCamera);

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
      onToggleMenu: () => { if (this.xrHeadValid) this.ensureXrInterface().toggle(this.xrHead); },
      onSelect: () => this.xrInterface?.select() ?? false,
      onTogglePlay: () => this.xrHooks.onTogglePlay?.(),
      onCameraMode: () => {
        const modes: CameraMode[] = ["broadcast", "onboard", "orbit"];
        const next = modes[(modes.indexOf(this.getCameraMode()) + 1) % modes.length];
        this.setCameraMode(next);
      },
      onNextDriver: () => {
        if (this.xrDrivers.length === 0) return;
        const current = this.xrDrivers.indexOf(this.getFollowDriver() ?? -1);
        this.setFollowDriver(this.xrDrivers[(current + 1) % this.xrDrivers.length]);
        if (this.getCameraMode() !== "onboard") this.setCameraMode("onboard");
      },
    });
    this.xrControllers.setActive(false);
    this.xrRig.viewerRoot.add(this.xrControllers.group);
    this.tabletopXr = new TabletopXr(this.renderer, this.tabletopScene, this.tabletop, {
      getState: () => this.xrHooks.getPlaybackState?.() ?? { playing: false, normalizedTime: 0, timeLabel: "", speed: 1 },
      togglePlay: () => this.xrHooks.onTogglePlay?.(),
      seek: ratio => this.xrHooks.onSeek?.(ratio),
      jump: seconds => this.xrHooks.onJump?.(seconds),
      speed: value => this.xrHooks.onSetSpeed?.(value),
      exit: () => { void this.exitVr(); },
    });

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
    if (this.isXrPresenting()) return;
    this.modeBeforeXr = this.presentationMode;
    this.setPresentationMode("realistic");
    this.renderer.xr.setFramebufferScaleFactor(this.graphicsSettings.xrScale);
    this.renderer.xr.setFoveation(this.graphicsSettings.xrFoveation);
    try {
      await this.xrSession.enterVr();
    } catch (error) {
      this.setPresentationMode(this.modeBeforeXr);
      throw error;
    }
  }

  async enterAr(): Promise<void> {
    if (this.isXrPresenting()) return;
    this.modeBeforeXr = this.presentationMode;
    this.setPresentationMode("tabletop");
    this.renderer.xr.setFramebufferScaleFactor(.85);
    this.renderer.xr.setFoveation(1);
    try {
      await this.xrSession.enterAr();
    } catch (error) {
      this.setPresentationMode(this.modeBeforeXr);
      this.renderer.xr.setFramebufferScaleFactor(this.graphicsSettings.xrScale);
      this.renderer.xr.setFoveation(this.graphicsSettings.xrFoveation);
      this.applyGraphicsSettings(this.graphicsSettings);
      throw error;
    }
  }

  isArPresenting() { return this.isXrPresenting() && this.xrSession.getMode() === "immersive-ar"; }

  getPresentationMode() { return this.presentationMode; }

  setPresentationMode(mode: PresentationMode) {
    if (this.isXrPresenting()) return;
    this.presentationMode = mode;
    this.tabletopControls.enabled = mode === "tabletop";
    if (mode === "tabletop") this.controls.enabled = false;
    else this.cameraController.setMode(this.getCameraMode(), this.controls);
    this.tabletop.resetTrails();
  }

  getTabletopWidth() { return this.tabletop.getWidth(); }
  setTabletopWidth(width: number) { this.tabletop.setWidth(width); }
  setTabletopRotation(degrees: number) { this.tabletop.group.rotation.y = THREE.MathUtils.degToRad(degrees); }

  async exitVr(): Promise<void> {
    await this.xrSession.exitVr();
  }

  setAnimationLoop(callback: XRFrameRequestCallback | null) {
    this.renderer.setAnimationLoop(callback);
  }

  pollXrInput(frame?: XRFrame) {
    if (!this.renderer.xr.isPresenting) return;
    const space = this.renderer.xr.getReferenceSpace();
    const pose = frame && space ? frame.getViewerPose(space) : null;
    this.xrHeadValid = Boolean(pose);
    if (!pose) return;
    this.xrHead.position.copy(pose.transform.position);
    this.xrHead.quaternion.copy(pose.transform.orientation);
    this.xrHead.updateMatrix();
    if (this.isArPresenting()) {
      this.tabletopXr.update(this.xrHead, performance.now());
      return;
    }
    this.xrRig.calibrate(this.xrHead);
    this.xrInterface?.prepare(this.xrHead, this.xrControllers);
    this.xrControllers.update();
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
    const previous = this.graphicsSettings;
    const changed = (...keys: (keyof GraphicsSettings)[]) => !this.graphicsInitialized || keys.some(key => previous[key] !== settings[key]);
    this.graphicsSettings = { ...settings };
    if (!this.renderer.xr.isPresenting && changed("maxPixelRatio", "xrScale")) {
      this.renderer.setPixelRatio(settings.maxPixelRatio);
      this.renderer.xr.setFramebufferScaleFactor(settings.xrScale);
    }
    if (changed("xrFoveation")) this.renderer.xr.setFoveation(settings.xrFoveation);
    this.resize();
    this.camera.far = settings.drawDistance;
    this.camera.updateProjectionMatrix();
    this.xrViewCamera.far = settings.drawDistance;
    const fogColor = settings.lighting === "warm" ? "#d7cfbf" : settings.lighting === "overcast" ? "#bfcbd0" : "#c8d3d6";
    if (changed("lighting", "environment", "shadows", "shadowDistance", "exposure")) this.lighting.apply(settings, this.renderer);
    if (changed("environment")) this.scene.environment = settings.environment ? this.environmentMap : null;
    if (changed("fog", "drawDistance", "lighting")) this.scene.fog = settings.fog ? new THREE.Fog(fogColor, settings.drawDistance * 0.22, settings.drawDistance * 0.96) : null;
    if (changed("sky", "skyStyle", "lighting", "environmentIntensity")) applySkyQuality(this.scene, settings, fogColor);
    if (changed("surfaceDetail", "anisotropy")) applySurfaceQuality(settings, this.renderer);
    if (changed("runoffs", "trackside", "tyreMarks", "shadows")) this.trackDecor?.applySettings(settings);
    if (this.contactShadows) this.contactShadows.mesh.visible = settings.contactShadows;
    if (changed("carMaterials", "carShadows", "shadows")) this.applyCarVisualGraphics(settings);
    this.graphicsInitialized = true;
  }

  private spawnCarVisuals(drivers: DriverInfo[], sceneLength: number) {
    for (const driver of drivers) {
      const visual = createCarVisual(driver, sceneLength);
      this.carVisuals.set(driver.driverNumber, { ...visual, color: new THREE.Color(driver.teamColor) });
      this.root.add(visual.group);
    }
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
    this.loadedDrivers = [];
    for (const visual of this.carVisuals.values()) {
      this.root.remove(visual.group);
      disposeCarVisual(visual.group);
    }
    this.carVisuals.clear();
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
      this.tabletopCamera.aspect = width / height;
      this.tabletopCamera.updateProjectionMatrix();
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
    this.xrDriverInfo = segment.drivers;
    this.xrInterface?.setDrivers(segment.drivers);
    this.disposeRootContents();
    this.carVisuals.clear();
    const transform = buildTransform(segment);
    this.transform = transform;
    this.startingGrid = segment.startingGrid ?? [];
    this.gridLateralBlender.reset(buildDriverGridHolds(segment));

    this.xrDrivers = segment.drivers.map(driver => driver.driverNumber);

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
    this.tabletop.load(segment.drivers, pathPoints, closed, trackWidth, crossSections);

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

    this.loadedDrivers = [...segment.drivers];
    this.carSceneLength = carLengthInScene(transform);
    this.spawnCarVisuals(this.loadedDrivers, this.carSceneLength);
    this.contactShadows = new CarContactShadows(segment.drivers.length);
    this.root.add(this.contactShadows.mesh);
    this.graphicsInitialized = false;
    this.applyGraphicsSettings(this.graphicsSettings);

    this.cameraController.loadSegment(segment, transform);
    if (this.cameraController.getMode() === "orbit") {
      this.framePreviewCamera(samplePoints);
    }

  }

  setCameraMode(mode: CameraMode) {
    this.cameraController.setMode(mode, this.controls);
    if (this.presentationMode === "tabletop") this.controls.enabled = false;
    this.xrHooks.onCameraModeChange?.(mode);
  }

  setFollowDriver(driverNumber: number) {
    this.cameraController.setFollowDriver(driverNumber);
    this.xrHooks.onFollowDriverChange?.(driverNumber);
  }

  getFollowDriver(): number | null {
    return this.cameraController.getFollowDriver();
  }

  getCameraMode(): CameraMode {
    return this.cameraController.getMode();
  }

  getActiveCameraLabel(): string {
    if (this.presentationMode === "tabletop") return "AR de sobremesa · vista libre";
    return this.cameraController.getActiveLabel();
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
    if (this.presentationMode === "tabletop") {
      this.tabletop.update(visualPlacements, frame.now);
      if (!xrPresenting) this.tabletopControls.update();
      return;
    }

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
      frame.now,
      frame.activeEvent?.drivers ?? [],
    );
    if (xrPresenting) {
      const mode = this.getCameraMode();
      const shot = this.cameraController.getXrShot();
      const key = mode === "broadcast" ? `broadcast:${shot.revision}`
        : mode === "onboard" ? `onboard:${this.getActiveCameraLabel()}` : "orbit";
      const changed = key !== this.xrShotKey;
      if (mode !== "orbit" && (changed || mode === "onboard" || shot.onboard)) {
        this.xrEuler.setFromQuaternion(this.camera.quaternion, "YXZ");
        this.xrYaw.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.xrEuler.y);
      }
      if (changed && mode !== "orbit" && this.xrHeadValid) this.xrRig.alignHeading(this.xrHead);
      this.xrShotKey = this.xrHeadValid ? key : null;
      this.camera.quaternion.copy(this.xrYaw);
      if (mode === "orbit") {
        this.xrHead.matrixWorld.multiplyMatrices(this.xrRig.viewerRoot.matrixWorld, this.xrHead.matrix);
        const turn = this.xrFlight.update(this.camera, this.xrHead, this.xrControllers.getInputSources(), deltaSeconds, !this.xrHeadValid || (this.xrInterface?.isOpen() ?? false));
        if (turn) this.xrYaw.copy(this.camera.quaternion);
      } else {
        this.xrFlight.reset();
      }
    }
    this.lighting.update(this.controls.target);
    const zoomDetailScale = xrPresenting ? 1 : Math.max(1,
      Math.tan(THREE.MathUtils.degToRad(30)) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)),
    );
    const carDistance = this.graphicsSettings.detailedCarDistance;
    const forceLowPoly = carDistance === "lowpoly";
    const distance = (forceLowPoly ? 0 : carDistance) * zoomDetailScale;
    for (const visual of this.carVisuals.values()) {
      visual.group.visible = true;
      const useDetailed = !forceLowPoly && visual.group.position.distanceToSquared(this.camera.position)
        < distance * distance * (visual.detailed.visible ? 1.21 : 0.81);
      visual.detailed.visible = useDetailed;
      visual.lowpoly.visible = !useDetailed;
    }

    if (xrPresenting) {
      this.xrRig.applyDesiredCamera(this.camera);
      this.xrInterface?.setFrame(frame);
      if (this.xrHeadValid) this.xrInterface?.prepare(this.xrHead, this.xrControllers);
      this.xrInterface?.update(nowMs);
    }
  }

  render() {
    if (this.presentationMode === "tabletop") {
      const shadows = this.renderer.shadowMap.enabled;
      this.renderer.shadowMap.enabled = false;
      this.renderer.render(this.tabletopScene, this.isXrPresenting() ? this.xrViewCamera : this.tabletopCamera);
      this.renderer.shadowMap.enabled = shadows;
      return;
    }
    this.renderer.render(this.scene, this.isXrPresenting() ? this.xrViewCamera : this.camera);
  }

  private handleXrSessionStart() {
    this.xrHeadValid = false;
    if (this.isArPresenting()) {
      this.xrRig.setActive(false);
      this.xrRig.viewerRoot.visible = true;
      this.xrRig.viewerRoot.updateMatrixWorld(true);
      this.xrControllers.setActive(false);
      this.tabletopControls.enabled = false;
      this.controls.enabled = false;
      this.xrViewCamera.near = .01;
      this.xrViewCamera.far = 30;
      this.xrViewCamera.updateProjectionMatrix();
      this.tabletopScene.background = null;
      this.renderer.setClearColor(0x000000, 0);
      this.tabletopXr.setActive(true, this.tabletopScene, this.xrControllers.group);
      this.xrHooks.onSessionStart?.();
      return;
    }
    this.xrShotKey = null;
    this.xrEuler.setFromQuaternion(this.camera.quaternion, "YXZ");
    this.xrYaw.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.xrEuler.y);
    this.xrFlight.reset();
    this.xrRig.setActive(true);
    this.xrControllers.setActive(true);
    this.controls.enabled = false;
    this.ensureXrInterface();
    this.xrHooks.onSessionStart?.();
  }

  private handleXrSessionEnd() {
    if (this.xrSession.getMode() === "immersive-ar") {
      this.tabletopXr.setActive(false, this.tabletopScene, this.xrControllers.group);
      this.tabletopScene.background = new THREE.Color("#0b1520");
      this.renderer.setClearColor(0x000000, 1);
      this.xrViewCamera.near = .05;
      this.xrViewCamera.far = this.graphicsSettings.drawDistance;
      this.xrViewCamera.updateProjectionMatrix();
      this.renderer.xr.setFramebufferScaleFactor(this.graphicsSettings.xrScale);
      this.renderer.xr.setFoveation(this.graphicsSettings.xrFoveation);
    }
    this.xrInterface?.close();
    this.xrHeadValid = false;
    this.xrFlight.reset();
    this.xrRig.setActive(false);
    this.xrControllers.setActive(false);
    this.cameraController.setMode(this.getCameraMode(), this.controls);
    this.applyGraphicsSettings(this.graphicsSettings);
    this.setPresentationMode(this.modeBeforeXr);
    this.xrHooks.onSessionEnd?.();
  }

  private ensureXrInterface(): XrInterface {
    if (this.xrInterface) return this.xrInterface;
    this.xrInterface = new XrInterface(this.xrRig.viewerRoot, this.xrHooks.getWristVisible?.() ?? true, () => ({
      ...(this.xrHooks.getPlaybackState?.() ?? { playing: false, normalizedTime: 0, timeLabel: "", speed: 1 }),
      cameraMode: this.getCameraMode(), followDriver: this.getFollowDriver(),
    }), action => {
      if (action.type === "play") this.xrHooks.onTogglePlay?.();
      else if (action.type === "jump") this.xrHooks.onJump?.(action.seconds);
      else if (action.type === "seek") this.xrHooks.onSeek?.(action.ratio);
      else if (action.type === "speed") this.xrHooks.onSetSpeed?.(action.value);
      else if (action.type === "camera") this.setCameraMode(action.mode);
      else if (action.type === "exit") void this.exitVr();
      else if (action.type === "driver" || action.type === "follow") {
        const index = this.xrDrivers.indexOf(this.getFollowDriver() ?? -1);
        const driver = action.type === "follow" ? action.driver
          : this.xrDrivers[index < 0 ? action.step > 0 ? 0 : this.xrDrivers.length - 1
            : (index + action.step + this.xrDrivers.length) % this.xrDrivers.length];
        if (driver !== undefined) { this.setFollowDriver(driver); if (this.getCameraMode() !== "onboard") this.setCameraMode("onboard"); }
      }
    }, visible => this.xrHooks.onWristVisible?.(visible));
    this.xrInterface.setDrivers(this.xrDriverInfo);
    return this.xrInterface;
  }
}
