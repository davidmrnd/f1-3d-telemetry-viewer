import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  buildDriverGridHolds,
  buildVisualPlacements,
  GridLateralOffsetBlender,
  type BaseCarPlacement,
  type DriverGridHolds,
} from "./car-placement";
import { CarFleet } from "./car-fleet";
import {
  buildTrackCenterline,
  buildTransform,
  buildVisualCircuitPath,
  buildTrackCrossSections,
  carLengthInScene,
  metersToScene,
  TRACK_KERB_WIDTH_METERS,
  trackWidthInScene,
  type SceneTransform,
  vectorFromPoint,
} from "./track-geometry";
import {
  applyTrackEnvironment,
  applySkyQuality,
  applySurfaceQuality,
  getTrackSurfaceMaterials,
} from "./track-environment";
import { RaceCameraController } from "./cameras/race-camera-controller";
import type { CameraMode } from "./cameras/types";
import {
  DEFAULT_GRAPHICS_SETTINGS,
  type GraphicsSettings,
} from "./graphics-settings";
import {
  createStartFinishDecor,
  type StartFinishDecor,
} from "./start-finish";
import type { DriverInfo, EngineAudioView, RaceMilestoneControls, RadioBroadcastState, ReplayFrame, ReplaySegment, StartingGridSlot, TeamRadioClip, TeamRadioControls } from "../types";
import { paintRadioBroadcast, RADIO_CARD_HEIGHT, RADIO_CARD_WIDTH } from "./radio-broadcast-graphic";
import { createXrPanel } from "./xr/xr-panel";
import { XrRig } from "./xr/xr-rig";
import { XrSessionController } from "./xr/xr-session";
import { XrControllers } from "./xr/xr-controllers";
import { XrFlight } from "./xr/xr-flight";
import { XrInterface } from "./xr/xr-interface";
import type { XrPlaybackState } from "./xr/xr-controls-panel";
import { RaceLighting } from "./lighting";
import { RaceTerrain, addTrackRoad, addTrackKerbs } from "./track/track-surfaces";
import { createCircuitHeightSampler, createPitLane, findPitOpenings, type PitLane } from "./track/pit-lane";
import { createPitMarkings } from "./track/pit-markings";
import { PitLanePlacement } from "./pit-placement";
import { TrackPath } from "./cameras/automatic/track-path";
import { createTrackDecor, type TrackDecor } from "./track/track-decor";
import { TabletopModel } from "./tabletop/tabletop-model";
import { TabletopXr } from "./tabletop/tabletop-xr";
import { buildTrafficTimelineSteps, type TrafficRoad, type TrafficTimeline } from "./traffic/traffic-timeline";

const ENGINE_HEIGHT_METERS = .65;
const ENGINE_REAR_OFFSET_METERS = 1.6;

export type PresentationMode = "realistic" | "tabletop";

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
  private readonly cars = new CarFleet(this.root);
  private readonly viewportSize = new THREE.Vector2();
  private readonly eventBeacon: THREE.Mesh;
  private readonly terrain: RaceTerrain;
  private readonly lighting: RaceLighting;
  private trackDecor: TrackDecor | null = null;

  private transform: SceneTransform | null = null;
  private startingGrid: StartingGridSlot[] = [];
  private gridHolds: DriverGridHolds = new Map();
  private trafficRoads: TrafficRoad[] = [];
  private traffic: TrafficTimeline | null = null;
  private readonly cameraController = new RaceCameraController();
  private visualPlacements: BaseCarPlacement[] = [];
  private readonly listenerSpace = new THREE.Matrix4();
  private startFinish: StartFinishDecor | null = null;
  private pitPlacement: PitLanePlacement | null = null;
  private lastUpdateMs = performance.now();
  private environmentMap: THREE.Texture | null = null;
  private graphicsSettings: GraphicsSettings = { ...DEFAULT_GRAPHICS_SETTINGS };
  private graphicsInitialized = false;

  private readonly xrRig = new XrRig();
  private readonly xrViewCamera = new THREE.PerspectiveCamera(60, 1, 0.05, 8000);
  private readonly xrHead = new THREE.PerspectiveCamera();
  private readonly xrRadio = createXrPanel(RADIO_CARD_WIDTH, RADIO_CARD_HEIGHT, .54, "xr-radio-broadcast");
  private xrRadioClip: TeamRadioClip | null = null;
  private xrRadioPaintedAt = -Infinity;
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

  constructor(private readonly canvas: HTMLCanvasElement, private readonly radio: TeamRadioControls, private readonly milestones: RaceMilestoneControls) {
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
    const tabletopKey = new THREE.DirectionalLight("#ffffff", 1.35);
    tabletopKey.position.set(1.4, 2, .8);
    this.tabletopScene.add(
      new THREE.HemisphereLight("#f2f6fb", "#243041", 1.15),
      tabletopKey,
      this.tabletop.group,
    );
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

    this.terrain = new RaceTerrain(this.xrRig.worldRoot);

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
      onSelectRadio: () => this.xrInterface?.selectRadio(),
      onSqueeze: () => this.xrInterface?.squeeze(),
      onTogglePlay: () => this.xrHooks.onTogglePlay?.(),
      onCameraMode: () => {
        const modes: CameraMode[] = ["onboard", "orbit"];
        const current = this.getCameraMode();
        const index = modes.indexOf(current);
        this.setCameraMode(modes[index < 0 ? 0 : (index + 1) % modes.length]);
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
    }, radio, milestones);

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
    this.terrain.applyMaterials();
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
    if (changed("runoffs", "trackside", "tyreMarks", "shadows", "sky", "fog")) this.trackDecor?.applySettings(settings);
    this.cars.setContactShadowsVisible(settings.contactShadows);
    if (changed("carMaterials", "carShadows", "shadows")) this.cars.applyGraphicsSettings(settings);
    this.graphicsInitialized = true;
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
    this.pitPlacement = null;
    this.traffic = null;
    this.trafficRoads = [];
    this.cars.dispose();
    if (this.trackDecor) {
      this.root.remove(this.trackDecor.group);
      this.trackDecor.dispose();
      this.trackDecor = null;
    }
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
      }
    });
    this.root.clear();
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
    const transform = buildTransform(segment);
    this.transform = transform;
    this.startingGrid = segment.startingGrid ?? [];
    this.gridHolds = buildDriverGridHolds(segment);

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
    this.trafficRoads.push({ points: pathPoints, closed, width: trackWidth });
    const kerbWidth = metersToScene(TRACK_KERB_WIDTH_METERS, transform);
    const crossSections = buildTrackCrossSections(pathPoints, closed, trackWidth / 2 + kerbWidth);
    this.tabletop.load(segment.drivers, pathPoints, closed, trackWidth, crossSections);
    this.tabletopXr.resetInteraction();

    if (pathPoints.length > 1) {
      this.terrain.rebuild(pathPoints, closed, trackWidth, kerbWidth, crossSections);
    }

    if (pathPoints.length > 4) {
      const road = addTrackRoad(this.root, pathPoints, closed, trackWidth, crossSections);
      let pitLane: PitLane | null = null;
      let pitOpening: ReturnType<typeof findPitOpenings> | undefined;
      if (segment.circuit.pitLane || segment.retirements?.length) {
        const main = new TrackPath(pathPoints, closed);
        const circuitHeight = createCircuitHeightSampler(road.geometry, this.terrain.geometry);
        pitLane = createPitLane(segment, transform, main, trackWidth, circuitHeight, road.material);
        if (pitLane) {
          this.trafficRoads.push({ points: [...pitLane.path.points], closed: false, width: pitLane.width });
          this.root.add(pitLane.mesh);
          this.root.add(createPitMarkings(pitLane, main, getTrackSurfaceMaterials().white));
          pitOpening = findPitOpenings(pitLane, crossSections, closed, trackWidth);
        }
        this.pitPlacement = new PitLanePlacement(segment, pitLane, main, trackWidth, transform, circuitHeight);
      }
      addTrackKerbs(this.root, pathPoints, closed, trackWidth, kerbWidth, crossSections, pitOpening);
      this.trackDecor = createTrackDecor(pathPoints, crossSections, closed, trackWidth, kerbWidth,
        this.terrain.geometry, /monte|monaco|baku/i.test(segment.sessionRef.circuitShortName), pitOpening, pitLane);
      this.root.add(this.trackDecor.group);
    }

    this.startFinish = createStartFinishDecor(segment, pathPoints, closed, crossSections, transform, trackWidth, this.gridHolds);
    if (this.startFinish) {
      this.root.add(this.startFinish.group);
    }

    this.cars.load(segment.drivers, carLengthInScene(transform));
    this.graphicsInitialized = false;
    this.applyGraphicsSettings(this.graphicsSettings);

    this.cameraController.loadSegment(segment, transform);
    if (this.cameraController.getMode() === "orbit") {
      this.framePreviewCamera(samplePoints);
    }
  }

  async prepareTraffic(
    duration: number,
    frameAt: (time: number) => ReplayFrame,
    onProgress: (progress: number) => Promise<void>,
  ) {
    const transform = this.transform;
    if (!transform) return;
    const grid = new GridLateralOffsetBlender();
    grid.reset(this.gridHolds);
    const steps = buildTrafficTimelineSteps(duration, (now) => {
      const frame = frameAt(now);
      const base = buildVisualPlacements(frame, transform, grid.resolve(frame, this.startingGrid));
      const placements = this.startFinish?.placeCars(base, now) ?? base;
      return this.pitPlacement?.apply(placements, now) ?? placements;
    }, this.trafficRoads, () => grid.reset(this.gridHolds));
    let step = steps.next();
    while (!step.done) {
      await onProgress(step.value);
      step = steps.next();
    }
    this.traffic = step.value;
  }

  setCameraMode(mode: CameraMode) {
    const resolved =
      this.renderer.xr.isPresenting && !this.isArPresenting() && mode === "broadcast"
        ? "orbit"
        : mode;
    this.cameraController.setMode(resolved, this.controls);
    if (this.presentationMode === "tabletop") this.controls.enabled = false;
    this.xrHooks.onCameraModeChange?.(resolved);
  }

  setFollowDriver(driverNumber: number) {
    this.cameraController.setFollowDriver(driverNumber);
    if (this.isArPresenting()) this.tabletop.setSelectedDriver(driverNumber);
    this.xrHooks.onFollowDriverChange?.(driverNumber);
  }

  getFollowDriver(): number | null {
    return this.cameraController.getFollowDriver();
  }

  getCameraMode(): CameraMode {
    return this.cameraController.getMode();
  }

  getEngineAudioView(): EngineAudioView | null {
    const tabletop = this.presentationMode === "tabletop";
    if (this.isXrPresenting()) {
      if (!this.xrHeadValid) return null;
      this.listenerSpace.copy(this.xrHead.matrix);
      if (!tabletop) this.listenerSpace.premultiply(this.xrRig.viewerRoot.matrixWorld);
    } else {
      const camera = tabletop ? this.tabletopCamera : this.camera;
      camera.updateWorldMatrix(true, false);
      this.listenerSpace.copy(camera.matrixWorld);
    }
    this.listenerSpace.invert();
    if (!tabletop) this.listenerSpace.multiply(this.root.matrixWorld);

    const sources: EngineAudioView["sources"][number][] = [];
    for (const { car, position, heading } of this.visualPlacements) {
      const source = new THREE.Vector3();
      if (tabletop) {
        if (!this.tabletop.getDriverWorldPosition(car.driver.driverNumber, source)) continue;
      } else {
        source.set(
          position.x - ENGINE_REAR_OFFSET_METERS * Math.cos(heading),
          position.y + ENGINE_HEIGHT_METERS,
          position.z - ENGINE_REAR_OFFSET_METERS * Math.sin(heading),
        );
      }
      sources.push({ sample: car.sample, position: source.applyMatrix4(this.listenerSpace) });
    }
    const perspective = tabletop ? "tabletop" : this.cameraController.isOnboardShot() ? "cockpit"
      : this.getCameraMode() === "broadcast" ? "trackside" : "free";
    return { perspective, sources, subject: tabletop ? null : this.cameraController.getSubjectNumber() };
  }

  getActiveCameraLabel(): string {
    if (this.presentationMode === "tabletop") return "AR de sobremesa · vista libre";
    return this.cameraController.getActiveLabel();
  }

  update(frame: ReplayFrame) {
    const nowMs = performance.now();
    const deltaSeconds = Math.min((nowMs - this.lastUpdateMs) / 1000, 0.1);
    this.lastUpdateMs = nowMs;

    this.resize();
    const xrPresenting = this.renderer.xr.isPresenting;
    if (!this.traffic) return;
    const visualPlacements = this.traffic.sample(frame);
    this.visualPlacements = visualPlacements;
    if (this.presentationMode === "tabletop") {
      this.tabletop.update(visualPlacements, frame.now);
      if (!xrPresenting) this.tabletopControls.update();
      return;
    }

    this.cars.update(visualPlacements);

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
        const turn = this.xrFlight.update(this.camera, this.xrHead, this.xrControllers.getInputSources(), deltaSeconds, !this.xrHeadValid || (this.xrInterface?.isDragging() ?? false));
        if (turn) this.xrYaw.copy(this.camera.quaternion);
      } else {
        this.xrFlight.reset();
      }
    }
    this.lighting.update(this.controls.target);
    this.cars.updateDetail(this.camera, xrPresenting, this.graphicsSettings.detailedCarDistance);

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

  updateRadioBroadcast(state: RadioBroadcastState | null) {
    const { mesh, context, texture } = this.xrRadio;
    mesh.visible = Boolean(state && this.xrHeadValid);
    if (!state || !mesh.visible) {
      this.xrRadioClip = null;
      return;
    }
    mesh.position.set(0, -.32, -1.35).applyQuaternion(this.xrHead.quaternion).add(this.xrHead.position);
    mesh.quaternion.copy(this.xrHead.quaternion);
    const now = performance.now();
    if (state.clip === this.xrRadioClip && now - this.xrRadioPaintedAt < 33) return;
    paintRadioBroadcast(context, state);
    texture.needsUpdate = true;
    this.xrRadioClip = state.clip;
    this.xrRadioPaintedAt = now;
  }

  private handleXrSessionStart() {
    this.xrHeadValid = false;
    this.renderer.xr.getSession()?.addEventListener("select", this.radio.unlock);
    const radioParent = this.isArPresenting() ? this.tabletopScene : this.xrRig.viewerRoot;
    this.xrRadio.mesh.renderOrder = 1200;
    radioParent.add(this.xrRadio.mesh);
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
    if (this.getCameraMode() === "broadcast") this.setCameraMode("orbit");
    this.ensureXrInterface();
    this.xrHooks.onSessionStart?.();
  }

  private handleXrSessionEnd() {
    this.updateRadioBroadcast(null);
    this.xrRadio.mesh.removeFromParent();
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
    }, visible => this.xrHooks.onWristVisible?.(visible), this.radio, this.milestones);
    this.xrInterface.setDrivers(this.xrDriverInfo);
    return this.xrInterface;
  }
}
