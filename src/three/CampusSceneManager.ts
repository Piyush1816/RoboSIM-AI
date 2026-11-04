import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  CAMPUS_BENCHES,
  CAMPUS_BUILDINGS,
  CAMPUS_ELEVATORS,
  CAMPUS_STREETLIGHTS,
  CAMPUS_TREES,
  CONSTRUCTION_ZONES,
  DELIVERY_LOCATIONS,
  ROBOT_UNITS,
} from '../data/campusConfig';
import {
  AutonomousNavigationController,
  PathUpdateEvent,
  SimulationCompletionData,
} from '../simulation/navigationController';
import {
  loadCandidatePolicyState,
  loadRobots,
} from '../storage/experimentStorage';
import {
  CELL_SIZE,
  getActiveConstructionObstacleBounds,
  getAllStaticObstacleBounds,
  ROBOT_COLLISION_RADIUS,
  worldToGridCoords,
} from '../simulation/pathfinding';
import {
  CameraPresetId,
  ElevatorFaultMode,
  LiveTelemetry,
  NavigationPolicyConfig,
  PedestrianDistributionConfig,
  PredictionHorizonSec,
  RobotUnitConfig,
  ScenarioConfig,
  SimulationLogEntry,
  Vector2D,
} from '../types/simulation';

// Pre-allocated math helpers at module scope to prevent GC in the animation loop
const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _dummyObj = new THREE.Object3D();
const _colorTmp = new THREE.Color();

export type SimulationCompletionPayload = SimulationCompletionData;

interface DynamicPedestrianMeshHandle {
  id: string;
  mesh: THREE.Group;
  debugRing: THREE.LineLoop;
  predLine: THREE.Line;
}

export class CampusSceneManager {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private isSoftwareGl: boolean;
  private frameId = 0;
  private isDisposed = false;
  private clock = new THREE.Clock();

  // Scene Groups
  private robotGroup = new THREE.Group();
  private robotChassisMesh!: THREE.Mesh;
  private robotAccentMesh!: THREE.Mesh;
  private robotStatusLight!: THREE.Mesh;
  private robotLidarTurret!: THREE.Group;
  private robotSensorCone!: THREE.Mesh;
  private robotDebugCollider!: THREE.LineSegments;
  private robotWheels: THREE.Group[] = [];

  private pathLineGroup = new THREE.Group();
  private nextWaypointMarkerGroup = new THREE.Group();
  private gridOverlayGroup = new THREE.Group();
  private collisionDebugGroup = new THREE.Group();
  private robotCurrentCellMarker!: THREE.Group;

  private constructionGroups = new Map<string, THREE.Group>();
  private deliveryRingMeshes: THREE.Mesh[] = [];
  private dynamicObstacleGroup = new THREE.Group();
  private predictiveConflictGroup = new THREE.Group();
  private dynamicObstacleMeshes: DynamicPedestrianMeshHandle[] = [];
  private elevatorHandles = new Map<
    string,
    {
      group: THREE.Group;
      cabGroup: THREE.Group;
      groundDoorL: THREE.Mesh;
      groundDoorR: THREE.Mesh;
      firstDoorL: THREE.Mesh;
      firstDoorR: THREE.Mesh;
      upperDoorL: THREE.Mesh;
      upperDoorR: THREE.Mesh;
      beaconMat: THREE.MeshBasicMaterial;
    }
  >();
  private buildingShellMeshes = new Map<
    string,
    {
      mainBody: THREE.Mesh;
      upperTier: THREE.Mesh;
      bodyMat: THREE.MeshStandardMaterial;
      tierMat: THREE.MeshStandardMaterial;
    }
  >();
  private interactiveMeshes: THREE.Object3D[] = [];

  // Camera transition state
  private cameraMode: CameraPresetId = 'isometric';
  private activeCameraTransition: {
    targetPos: THREE.Vector3;
    targetLookAt: THREE.Vector3;
  } | null = null;

  // Shared Autonomous Navigation & Pedestrian Controller
  private navController: AutonomousNavigationController;
  private simSpeedMultiplier = 1.0;
  private selectedBuildingName: string | null = null;

  // Visibility toggles
  private showNavGrid = false;
  private showPathLine = true;
  private showSensorCone = true;
  private showCollisionDebug = false;
  private showBuildingCutaway = false;

  // Callbacks
  private onTelemetryUpdate: (telemetry: LiveTelemetry) => void;
  private onLogEvent: (entry: SimulationLogEntry) => void;
  private onSimulationComplete: (payload: SimulationCompletionPayload) => void;

  constructor(
    container: HTMLElement,
    initialScenario: ScenarioConfig,
    initialPolicy: NavigationPolicyConfig,
    initialRobotId: string,
    callbacks: {
      onTelemetryUpdate: (telemetry: LiveTelemetry) => void;
      onLogEvent: (entry: SimulationLogEntry) => void;
      onSimulationComplete: (payload: SimulationCompletionPayload) => void;
    }
  ) {
    this.container = container;
    this.onTelemetryUpdate = callbacks.onTelemetryUpdate;
    this.onLogEvent = callbacks.onLogEvent;
    this.onSimulationComplete = callbacks.onSimulationComplete;

    // 1. Detect Software WebGL from GPU renderer string
    this.isSoftwareGl = (() => {
      const probeCanvas = document.createElement('canvas');
      const gl =
        probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    // 2. Initialize WebGLRenderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2)
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = container.clientWidth || 960;
    const height = container.clientHeight || 600;
    this.renderer.setSize(width, height);
    container.appendChild(this.renderer.domElement);

    // 3. Scene, Environment & Horizon Fog
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070b14);
    this.scene.fog = new THREE.FogExp2(0x070b14, 0.0062);

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04
    ).texture;
    pmremGenerator.dispose();

    // 4. Camera & OrbitControls (Isometric angle)
    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.5, 300);
    this.camera.position.set(44, 38, 46);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.06;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 125;
    this.controls.target.set(0, 0, 0);

    this.controls.addEventListener('start', () => {
      this.activeCameraTransition = null;
      if (this.cameraMode === 'follow') {
        this.cameraMode = 'isometric';
      }
    });

    // 5. Build 3D Campus Environment & Autonomous Robot BEFORE initializing navigation controller
    this.setupLighting();
    this.buildCampusGroundAndRoads();
    this.buildCampusBuildings();
    this.buildTreesAndBenches();
    this.buildStreetlights();
    this.buildDeliveryAndChargingStations();
    this.buildElevatorTowers();
    this.buildConstructionZones();
    this.buildAutonomousRobot();
    this.buildRobotCurrentCellMarker();
    this.buildNextWaypointMarker();

    this.scene.add(this.pathLineGroup);
    this.scene.add(this.nextWaypointMarkerGroup);
    this.scene.add(this.gridOverlayGroup);
    this.scene.add(this.collisionDebugGroup);
    this.scene.add(this.predictiveConflictGroup);
    this.scene.add(this.dynamicObstacleGroup);

    // 6. Initialize AutonomousNavigationController after all 3D visual resources are ready
    this.navController = new AutonomousNavigationController(
      initialScenario,
      initialPolicy,
      initialRobotId,
      {
        onPathUpdated: (pathEvent) => {
          this.rebuildPathVisual(pathEvent);
        },
        onStatusChanged: () => {
          this.updateStatusLightColor();
        },
        onLogEvent: (level, message) => {
          this.emitLog(level, message);
        },
        onComplete: (payload) => {
          this.emitTelemetry();
          this.onSimulationComplete(payload);
        },
      }
    );
    if (initialPolicy.isCandidatePolicy) {
      this.navController.setCandidatePolicyState(loadCandidatePolicyState(), false);
    }

    this.syncVisualsFromController();
    this.emitTelemetry();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.setupInteractionEvents();
    this.startLoop();
  }

  private setupLighting(): void {
    const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x0f172a, 0.85);
    hemiLight.position.set(0, 50, 0);
    this.scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfffbeb, 1.9);
    keyLight.position.set(38, 56, 32);
    keyLight.castShadow = !this.isSoftwareGl;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 10;
    keyLight.shadow.camera.far = 150;
    const d = 48;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.65);
    rimLight.position.set(-45, 28, -40);
    this.scene.add(rimLight);
  }

  private createWindowFacadeTexture(accentHex: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 256, 256);

    const cols = 8;
    const rows = 8;
    const padX = 6;
    const padY = 8;
    const cellW = 256 / cols;
    const cellH = 256 / rows;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const isLit = (r * 7 + c * 13) % 5 !== 0;
        if (isLit) {
          ctx.fillStyle = (r + c) % 4 === 0 ? accentHex : '#38bdf8';
          ctx.globalAlpha = (r * c) % 3 === 0 ? 0.55 : 0.25;
        } else {
          ctx.fillStyle = '#1e293b';
          ctx.globalAlpha = 0.8;
        }
        ctx.fillRect(
          c * cellW + padX,
          r * cellH + padY,
          cellW - padX * 2,
          cellH - padY * 2
        );
      }
    }
    ctx.globalAlpha = 1.0;

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  private buildCampusGroundAndRoads(): void {
    const terrainGeo = new THREE.PlaneGeometry(240, 240);
    const terrainMat = new THREE.MeshStandardMaterial({
      color: 0x09131c,
      roughness: 0.95,
      metalness: 0.05,
    });
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.rotation.x = -Math.PI / 2;
    terrainMesh.position.y = -0.05;
    terrainMesh.receiveShadow = true;
    this.scene.add(terrainMesh);

    const grassMat = new THREE.MeshStandardMaterial({
      color: 0x112a24,
      roughness: 0.88,
      metalness: 0.05,
    });
    const mainGrass = new THREE.Mesh(new THREE.PlaneGeometry(92, 92), grassMat);
    mainGrass.rotation.x = -Math.PI / 2;
    mainGrass.position.y = 0.0;
    mainGrass.receiveShadow = true;
    this.scene.add(mainGrass);

    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.72,
      metalness: 0.12,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    const ewRoad = new THREE.Mesh(new THREE.BoxGeometry(84, 0.06, 7.2), roadMat);
    ewRoad.position.set(0, 0.03, 0);
    ewRoad.receiveShadow = true;
    this.scene.add(ewRoad);

    const nsRoad = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.06, 84), roadMat);
    nsRoad.position.set(0, 0.03, 0);
    nsRoad.receiveShadow = true;
    this.scene.add(nsRoad);

    const dashMat = new THREE.MeshBasicMaterial({ color: 0x475569 });
    for (let i = -38; i <= 38; i += 4) {
      if (Math.abs(i) < 5) continue;
      const ewDash = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.18), dashMat);
      ewDash.rotation.x = -Math.PI / 2;
      ewDash.position.set(i, 0.068, 0);
      this.scene.add(ewDash);

      const nsDash = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 2.0), dashMat);
      nsDash.rotation.x = -Math.PI / 2;
      nsDash.position.set(0, 0.068, i);
      this.scene.add(nsDash);
    }

    const pathwayMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.65,
      metalness: 0.1,
    });

    const pathways: [number, number, number, number][] = [
      [0, -15, 58, 3.6],
      [0, 15, 58, 3.6],
      [-15, 0, 3.6, 48],
      [15, 0, 3.6, 48],
      [-14, -12, 4.5, 8],
      [6, 19, 4.0, 9],
    ];

    for (const [px, pz, pw, pd] of pathways) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.07, pd), pathwayMat);
      mesh.position.set(px, 0.035, pz);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
  }

  private buildCampusBuildings(): void {
    for (const bldg of CAMPUS_BUILDINGS) {
      const group = new THREE.Group();
      group.position.set(bldg.position[0], 0, bldg.position[2]);
      group.userData = { buildingName: bldg.name, buildingId: bldg.id };

      const [w, h, d] = bldg.size;
      const facadeTex = this.createWindowFacadeTexture(bldg.accentColor);

      const plinthMat = new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.8,
        metalness: 0.15,
      });
      const plinth = new THREE.Mesh(
        new THREE.BoxGeometry(w + 1.2, 0.6, d + 1.2),
        plinthMat
      );
      plinth.position.y = 0.3;
      plinth.castShadow = true;
      plinth.receiveShadow = true;
      group.add(plinth);

      const bodyMat = new THREE.MeshStandardMaterial({
        color: bldg.color,
        map: facadeTex,
        roughness: 0.35,
        metalness: 0.45,
      });
      const mainBody = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat);
      mainBody.position.y = 0.6 + h / 2;
      mainBody.castShadow = true;
      mainBody.receiveShadow = true;
      mainBody.userData = { buildingName: bldg.name };
      group.add(mainBody);
      this.interactiveMeshes.push(mainBody);

      const roofTierMat = new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        roughness: 0.6,
        metalness: 0.3,
      });
      const upperTier = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.62, 2.2, d * 0.58),
        roofTierMat
      );
      upperTier.position.y = 0.6 + h + 1.1;
      upperTier.castShadow = true;
      group.add(upperTier);

      this.buildingShellMeshes.set(bldg.id, {
        mainBody,
        upperTier,
        bodyMat,
        tierMat: roofTierMat,
      });

      const accentMat = new THREE.MeshStandardMaterial({
        color: bldg.accentColor,
        emissive: bldg.accentColor,
        emissiveIntensity: 0.65,
        roughness: 0.2,
      });
      const accentBand = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.3, 0.28, d + 0.3),
        accentMat
      );
      accentBand.position.y = 0.6 + h - 0.3;
      group.add(accentBand);

      const signDir = bldg.position[2] < 0 ? 1 : -1;
      const canopy = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.38, 0.35, 2.2),
        plinthMat
      );
      canopy.position.set(0, 3.2, signDir * (d / 2 + 0.9));
      canopy.castShadow = true;
      group.add(canopy);

      this.scene.add(group);
    }
  }

  private buildTreesAndBenches(): void {
    const count = CAMPUS_TREES.length;
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 1.8, 7);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x452719, roughness: 0.9 });
    const trunkInstanced = new THREE.InstancedMesh(trunkGeo, trunkMat, count);

    const canopyLowerGeo = new THREE.ConeGeometry(1.65, 3.2, 7);
    const canopyUpperGeo = new THREE.ConeGeometry(1.2, 2.5, 7);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.75 });
    const canopyLowerInst = new THREE.InstancedMesh(canopyLowerGeo, canopyMat, count);
    const canopyUpperInst = new THREE.InstancedMesh(canopyUpperGeo, canopyMat, count);

    trunkInstanced.castShadow = !this.isSoftwareGl;
    canopyLowerInst.castShadow = !this.isSoftwareGl;
    canopyUpperInst.castShadow = !this.isSoftwareGl;

    for (let i = 0; i < count; i++) {
      const [tx, tz] = CAMPUS_TREES[i];
      const scale = 0.85 + ((i * 17) % 30) / 100;

      _dummyObj.position.set(tx, 0.9 * scale, tz);
      _dummyObj.scale.setScalar(scale);
      _dummyObj.rotation.set(0, (i * 1.1) % Math.PI, 0);
      _dummyObj.updateMatrix();
      trunkInstanced.setMatrixAt(i, _dummyObj.matrix);

      _dummyObj.position.set(tx, 2.6 * scale, tz);
      _dummyObj.updateMatrix();
      canopyLowerInst.setMatrixAt(i, _dummyObj.matrix);

      _dummyObj.position.set(tx, 4.1 * scale, tz);
      _dummyObj.updateMatrix();
      canopyUpperInst.setMatrixAt(i, _dummyObj.matrix);

      const hueShift = ((i % 5) - 2) * 0.02;
      _colorTmp.setHSL(0.38 + hueShift, 0.65, 0.28 + (i % 3) * 0.03);
      canopyLowerInst.setColorAt(i, _colorTmp);
      canopyUpperInst.setColorAt(i, _colorTmp);
    }

    trunkInstanced.instanceMatrix.needsUpdate = true;
    canopyLowerInst.instanceMatrix.needsUpdate = true;
    canopyUpperInst.instanceMatrix.needsUpdate = true;
    if (canopyLowerInst.instanceColor) canopyLowerInst.instanceColor.needsUpdate = true;
    if (canopyUpperInst.instanceColor) canopyUpperInst.instanceColor.needsUpdate = true;

    trunkInstanced.computeBoundingSphere();
    canopyLowerInst.computeBoundingSphere();
    canopyUpperInst.computeBoundingSphere();

    this.scene.add(trunkInstanced);
    this.scene.add(canopyLowerInst);
    this.scene.add(canopyUpperInst);

    const woodMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.8 });
    const legMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.7,
      roughness: 0.3,
    });

    for (const [bx, bz, rotY] of CAMPUS_BENCHES) {
      const benchGroup = new THREE.Group();
      benchGroup.position.set(bx, 0, bz);
      benchGroup.rotation.y = rotY;

      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.55), woodMat);
      seat.position.set(0, 0.45, 0);
      benchGroup.add(seat);

      const backrest = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.45, 0.08), woodMat);
      backrest.position.set(0, 0.7, -0.24);
      benchGroup.add(backrest);

      const legL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, 0.5), legMat);
      legL.position.set(-0.75, 0.225, 0);
      benchGroup.add(legL);

      const legR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, 0.5), legMat);
      legR.position.set(0.75, 0.225, 0);
      benchGroup.add(legR);

      this.scene.add(benchGroup);
    }
  }

  private buildStreetlights(): void {
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      metalness: 0.75,
      roughness: 0.3,
    });
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });

    for (const [lx, lz] of CAMPUS_STREETLIGHTS) {
      const group = new THREE.Group();
      group.position.set(lx, 0, lz);

      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.12, 4.2, 8),
        poleMat
      );
      pole.position.y = 2.1;
      group.add(pole);

      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.14), poleMat);
      arm.position.set(0.35, 4.15, 0);
      group.add(arm);

      const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 0.22), bulbMat);
      bulb.position.set(0.68, 4.1, 0);
      group.add(bulb);

      this.scene.add(group);
    }
  }

  private buildDeliveryAndChargingStations(): void {
    for (const loc of DELIVERY_LOCATIONS) {
      const group = new THREE.Group();
      group.position.set(loc.position[0], loc.position[1], loc.position[2]);

      const isCharging = loc.type === 'charging';
      const primaryColor = isCharging ? 0x10b981 : 0x06b6d4;

      const padMat = new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        roughness: 0.4,
        metalness: 0.6,
      });
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(1.5, 1.65, 0.08, 24),
        padMat
      );
      pad.position.y = 0.05;
      group.add(pad);

      const ringGeo = new THREE.RingGeometry(1.1, 1.38, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: primaryColor,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.11;
      group.add(ring);
      this.deliveryRingMeshes.push(ring);

      if (isCharging) {
        const frameMat = new THREE.MeshStandardMaterial({
          color: 0x334155,
          metalness: 0.8,
          roughness: 0.25,
        });
        const pillarL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.8, 0.22), frameMat);
        pillarL.position.set(-1.6, 1.4, -1.5);
        group.add(pillarL);

        const pillarR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.8, 0.22), frameMat);
        pillarR.position.set(1.6, 1.4, -1.5);
        group.add(pillarR);

        const solarRoofMat = new THREE.MeshStandardMaterial({
          color: 0x0284c7,
          metalness: 0.9,
          roughness: 0.15,
        });
        const roof = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.14, 3.2), solarRoofMat);
        roof.position.set(0, 2.8, -0.2);
        roof.rotation.x = 0.15;
        group.add(roof);
      }

      this.scene.add(group);
    }
  }

  /**
   * Builds the indoor multi-floor building interior for each elevator-equipped building:
   * - Ground floor (y=0), First floor slab (y=3.6m), Second floor slab (y=7.2m)
   * - Building front entrance portal facing the campus pathway
   * - Internal ground corridor leading to the elevator lobby
   * - 3-walled enclosed elevator shaft with a SINGLE South doorway facing the lobby
   * - Animated bi-parting elevator doors on Ground and Second floors
   * - Elevator cabin moving vertically inside the shaft
   * - Second-floor internal corridor and destination room delivery pad
   */
  private buildElevatorTowers(): void {
    const floorSlabMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.65,
      metalness: 0.25,
      transparent: true,
      opacity: 0.72,
    });
    const corridorMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.4,
      metalness: 0.35,
    });
    const guideStripMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
    });
    const shaftWallMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.65,
      roughness: 0.3,
      transparent: true,
      opacity: 0.85,
    });
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.8,
      roughness: 0.2,
    });
    const cabMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.55,
      roughness: 0.25,
    });
    const portalMat = new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      emissive: 0x06b6d4,
      emissiveIntensity: 0.55,
      roughness: 0.2,
    });

    for (const elev of CAMPUS_ELEVATORS) {
      const group = new THREE.Group();
      const bldg = CAMPUS_BUILDINGS.find((b) => b.id === elev.buildingId);
      const bldgX = bldg ? bldg.position[0] : elev.cabinPos.x;
      const bldgZ = bldg ? bldg.position[2] : elev.cabinPos.z;
      const bldgW = bldg ? bldg.size[0] : 14;
      const bldgD = bldg ? bldg.size[2] : 10;
      const fh = elev.floorHeightM; // 3.6m per floor

      // 1. Multi-Floor Interior Slabs (First Floor at y=3.6m, Second Floor at y=7.2m)
      for (const fl of [1, 2]) {
        const slabY = fl * fh;
        // Cut out a 2.8m x 2.8m opening at the elevator shaft so the cabin passes cleanly through floors
        const slab = new THREE.Mesh(
          new THREE.BoxGeometry(bldgW - 0.8, 0.16, bldgD - 0.8),
          floorSlabMat
        );
        slab.position.set(bldgX, slabY - 0.08, bldgZ);
        group.add(slab);
      }

      // 2. Outdoor Approach Walkway Spur to Building Front Entrance
      const spurLen = Math.abs(elev.outdoorApproachPos.z - elev.entrancePos.z) + 1.2;
      const spurZ = (elev.outdoorApproachPos.z + elev.entrancePos.z) / 2;
      const approachSpur = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 0.09, spurLen),
        corridorMat
      );
      approachSpur.position.set(elev.entrancePos.x, 0.045, spurZ);
      group.add(approachSpur);

      // 3. Building Front Entrance Archway Portal facing the Campus Pathway
      const archL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 3.0, 0.35), portalMat);
      archL.position.set(elev.entrancePos.x - 1.35, 1.5, elev.entrancePos.z + 0.15);
      group.add(archL);

      const archR = new THREE.Mesh(new THREE.BoxGeometry(0.24, 3.0, 0.35), portalMat);
      archR.position.set(elev.entrancePos.x + 1.35, 1.5, elev.entrancePos.z + 0.15);
      group.add(archR);

      const archTop = new THREE.Mesh(new THREE.BoxGeometry(2.94, 0.28, 0.4), portalMat);
      archTop.position.set(elev.entrancePos.x, 3.0, elev.entrancePos.z + 0.15);
      group.add(archTop);

      // 4. Ground Floor Internal Corridor & Elevator Lobby (Entrance -> Lobby -> Single Doorway)
      const groundCorridorLen = Math.abs(elev.entrancePos.z - elev.doorwayPos.z) + 0.8;
      const groundCorridorZ = (elev.entrancePos.z + elev.doorwayPos.z) / 2;
      const groundCorridorMesh = new THREE.Mesh(
        new THREE.BoxGeometry(2.8, 0.12, groundCorridorLen),
        corridorMat
      );
      groundCorridorMesh.position.set(elev.lobbyPos.x, 0.06, groundCorridorZ);
      group.add(groundCorridorMesh);

      const guideL = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.14, groundCorridorLen),
        guideStripMat
      );
      guideL.position.set(elev.lobbyPos.x - 1.2, 0.07, groundCorridorZ);
      group.add(guideL);

      const guideR = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.14, groundCorridorLen),
        guideStripMat
      );
      guideR.position.set(elev.lobbyPos.x + 1.2, 0.07, groundCorridorZ);
      group.add(guideR);

      // Lobby waiting pad in front of the single elevator doorway
      const lobbyPad = new THREE.Mesh(
        new THREE.PlaneGeometry(2.4, 1.8),
        new THREE.MeshBasicMaterial({
          color: 0x06b6d4,
          transparent: true,
          opacity: 0.28,
          side: THREE.DoubleSide,
        })
      );
      lobbyPad.rotation.x = -Math.PI / 2;
      lobbyPad.position.set(elev.lobbyPos.x, 0.14, elev.lobbyPos.z);
      group.add(lobbyPad);

      // 5. Enclosed 3-Walled Elevator Shaft (North, West, East solid walls; Single South Doorway)
      const shaftH = fh * 3 + 0.6; // Covers Ground (0), First (1), and Second (2) floors
      const cx = elev.cabinPos.x;
      const cz = elev.cabinPos.z;
      const shaftHalf = 1.35;

      // Solid North Rear Shaft Wall
      const northWall = new THREE.Mesh(
        new THREE.BoxGeometry(shaftHalf * 2 + 0.2, shaftH, 0.18),
        shaftWallMat
      );
      northWall.position.set(cx, shaftH / 2, cz - shaftHalf);
      group.add(northWall);

      // Solid West Side Shaft Wall
      const westWall = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, shaftH, shaftHalf * 2),
        shaftWallMat
      );
      westWall.position.set(cx - shaftHalf, shaftH / 2, cz);
      group.add(westWall);

      // Solid East Side Shaft Wall
      const eastWall = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, shaftH, shaftHalf * 2),
        shaftWallMat
      );
      eastWall.position.set(cx + shaftHalf, shaftH / 2, cz);
      group.add(eastWall);

      // South Doorway Frame & Bi-Parting Sliding Doors (Ground Floor y=0 and Second Floor y=7.2m)
      const doorFrameL = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, shaftH, 0.2),
        portalMat
      );
      doorFrameL.position.set(cx - 1.22, shaftH / 2, elev.doorwayPos.z);
      group.add(doorFrameL);

      const doorFrameR = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, shaftH, 0.2),
        portalMat
      );
      doorFrameR.position.set(cx + 1.22, shaftH / 2, elev.doorwayPos.z);
      group.add(doorFrameR);

      const doorGeo = new THREE.BoxGeometry(1.05, 2.35, 0.12);
      const groundDoorL = new THREE.Mesh(doorGeo, doorMat);
      groundDoorL.position.set(cx - 0.52, 1.25, elev.doorwayPos.z);
      group.add(groundDoorL);

      const groundDoorR = new THREE.Mesh(doorGeo, doorMat);
      groundDoorR.position.set(cx + 0.52, 1.25, elev.doorwayPos.z);
      group.add(groundDoorR);

      const firstY = 1 * fh;
      const firstDoorL = new THREE.Mesh(doorGeo, doorMat);
      firstDoorL.position.set(cx - 0.52, firstY + 1.25, elev.doorwayPos.z);
      group.add(firstDoorL);

      const firstDoorR = new THREE.Mesh(doorGeo, doorMat);
      firstDoorR.position.set(cx + 0.52, firstY + 1.25, elev.doorwayPos.z);
      group.add(firstDoorR);

      const upperY = elev.destinationFloor * fh;
      const upperDoorL = new THREE.Mesh(doorGeo, doorMat);
      upperDoorL.position.set(cx - 0.52, upperY + 1.25, elev.doorwayPos.z);
      group.add(upperDoorL);

      const upperDoorR = new THREE.Mesh(doorGeo, doorMat);
      upperDoorR.position.set(cx + 0.52, upperY + 1.25, elev.doorwayPos.z);
      group.add(upperDoorR);

      // 6. Moving Elevator Cabin inside the Shaft (3 walls + floor + roof + open South entrance)
      const cabGroup = new THREE.Group();
      cabGroup.position.set(cx, 0, cz);

      const cabFloor = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 0.14, 2.2),
        cabMat
      );
      cabFloor.position.y = 0.07;
      cabGroup.add(cabFloor);

      const cabRoof = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 0.12, 2.2),
        cabMat
      );
      cabRoof.position.y = 2.35;
      cabGroup.add(cabRoof);

      const cabBack = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 2.3, 0.12),
        cabMat
      );
      cabBack.position.set(0, 1.2, -1.04);
      cabGroup.add(cabBack);

      const cabLeft = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 2.3, 2.2),
        cabMat
      );
      cabLeft.position.set(-1.04, 1.2, 0);
      cabGroup.add(cabLeft);

      const cabRight = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 2.3, 2.2),
        cabMat
      );
      cabRight.position.set(1.04, 1.2, 0);
      cabGroup.add(cabRight);

      // Status beacon on top of elevator cabin & shaft roof
      const beaconMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });
      const cabBeacon = new THREE.Mesh(
        new THREE.SphereGeometry(0.24, 12, 12),
        beaconMat
      );
      cabBeacon.position.set(0, 2.6, 0.85);
      cabGroup.add(cabBeacon);

      const roofBeacon = new THREE.Mesh(
        new THREE.SphereGeometry(0.36, 14, 14),
        beaconMat
      );
      roofBeacon.position.set(cx, shaftH + 0.45, cz);
      group.add(roofBeacon);

      group.add(cabGroup);

      // 6b. First Floor Internal Corridor (y = 3.6m, spanning West & East wings)
      const firstFloorPos = elev.firstFloorRoomPos ?? elev.destinationRoomPos;
      const firstCorridorW =
        elev.buildingId === 'bldg-student-center'
          ? 12.2
          : Math.abs(firstFloorPos.x - elev.lobbyPos.x) + 2.6;
      const firstCorridorCenterX =
        elev.buildingId === 'bldg-student-center'
          ? elev.lobbyPos.x + 0.3
          : (firstFloorPos.x + elev.lobbyPos.x) / 2;
      const firstCorridorMesh = new THREE.Mesh(
        new THREE.BoxGeometry(firstCorridorW, 0.1, 2.8),
        corridorMat
      );
      firstCorridorMesh.position.set(
        firstCorridorCenterX,
        firstY + 0.06,
        elev.lobbyPos.z
      );
      group.add(firstCorridorMesh);

      // 7. Second Floor Internal Corridor & Destination Room Delivery Point (y = 7.2m)
      const destPos = elev.destinationRoomPos;
      const upperCorridorW = Math.abs(destPos.x - elev.lobbyPos.x) + 2.6;
      const upperCorridorCenterX = (destPos.x + elev.lobbyPos.x) / 2;
      const upperCorridorMesh = new THREE.Mesh(
        new THREE.BoxGeometry(upperCorridorW, 0.1, 2.8),
        corridorMat
      );
      upperCorridorMesh.position.set(
        upperCorridorCenterX,
        upperY + 0.06,
        elev.lobbyPos.z
      );
      group.add(upperCorridorMesh);

      this.elevatorHandles.set(elev.id, {
        group,
        cabGroup,
        groundDoorL,
        groundDoorR,
        firstDoorL,
        firstDoorR,
        upperDoorL,
        upperDoorR,
        beaconMat,
      });
      this.scene.add(group);
    }
  }

  private buildConstructionZones(): void {
    const barrierMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.35,
      metalness: 0.2,
    });
    const redBarrierMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0x991b1b,
      emissiveIntensity: 0.3,
      roughness: 0.4,
    });
    const coneMat = new THREE.MeshStandardMaterial({
      color: 0xea580c,
      emissive: 0x9a3412,
      emissiveIntensity: 0.35,
      roughness: 0.5,
    });
    const hazardFloorMat = new THREE.MeshStandardMaterial({
      color: 0x451a03,
      roughness: 0.9,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    for (const cz of CONSTRUCTION_ZONES) {
      const group = new THREE.Group();
      group.position.set(cz.position[0], 0, cz.position[2]);

      const [w, d] = cz.size;
      const isPartial = cz.severity === 'Partial Lane Closure';

      const blockW = isPartial ? w / 2 + 0.3 : w;
      const blockOffsetX = isPartial ? -(w - blockW) / 2 : 0;

      const floorPlate = new THREE.Mesh(
        new THREE.BoxGeometry(blockW, 0.1, d),
        hazardFloorMat
      );
      floorPlate.position.set(blockOffsetX, 0.06, 0);
      group.add(floorPlate);

      const railNorth = new THREE.Mesh(
        new THREE.BoxGeometry(blockW * 0.92, 0.42, 0.22),
        redBarrierMat
      );
      railNorth.position.set(blockOffsetX, 0.65, -d / 2 + 0.2);
      group.add(railNorth);

      const railSouth = new THREE.Mesh(
        new THREE.BoxGeometry(blockW * 0.92, 0.42, 0.22),
        redBarrierMat
      );
      railSouth.position.set(blockOffsetX, 0.65, d / 2 - 0.2);
      group.add(railSouth);

      const railWest = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.42, d * 0.85),
        barrierMat
      );
      railWest.position.set(blockOffsetX - blockW / 2 + 0.2, 0.65, 0);
      group.add(railWest);

      const railEast = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.42, d * 0.85),
        barrierMat
      );
      railEast.position.set(blockOffsetX + blockW / 2 - 0.2, 0.65, 0);
      group.add(railEast);

      const corners = [
        [blockOffsetX - blockW / 2 + 0.25, -d / 2 + 0.25],
        [blockOffsetX + blockW / 2 - 0.25, -d / 2 + 0.25],
        [blockOffsetX - blockW / 2 + 0.25, d / 2 - 0.25],
        [blockOffsetX + blockW / 2 - 0.25, d / 2 - 0.25],
      ];
      for (const [cx, czOffset] of corners) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 10), coneMat);
        cone.position.set(cx, 0.48, czOffset);
        group.add(cone);
      }

      this.constructionGroups.set(cz.id, group);
      this.scene.add(group);
    }
  }

  private buildAutonomousRobot(robotConfig?: RobotUnitConfig): void {
    const bot = robotConfig ?? ROBOT_UNITS[0];
    const prevPos = this.robotGroup.position.clone();
    const prevRotY = this.robotGroup.rotation.y;
    const prevColliderVis = this.robotDebugCollider?.visible ?? false;
    const prevConeVis = this.robotSensorCone?.visible ?? true;

    while (this.robotGroup.children.length > 0) {
      this.robotGroup.remove(this.robotGroup.children[0]);
    }
    this.robotWheels = [];

    if (prevPos.lengthSq() === 0) {
      this.robotGroup.position.set(-15, 0, -20);
    } else {
      this.robotGroup.position.copy(prevPos);
      this.robotGroup.rotation.y = prevRotY;
    }

    // Scale dimensions relative to CortexRover X1 (0.85m length, 0.62m width, 0.74m height)
    const lengthScale = (bot.lengthM ?? 0.85) / 0.85;
    const widthScale = (bot.widthM ?? 0.62) / 0.62;
    const heightScale = (bot.heightM ?? 0.74) / 0.74;

    const baseW = 1.3 * widthScale;
    const baseD = 1.75 * lengthScale;
    const chassisW = 1.22 * widthScale;
    const chassisH = 0.68 * heightScale;
    const chassisD = 1.58 * lengthScale;

    const shadowGeo = new THREE.PlaneGeometry(baseW + 1.0, baseD + 1.0);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = 0.075;
    this.robotGroup.add(shadowPlane);

    const lowerBaseMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.7,
      roughness: 0.35,
    });
    const lowerBase = new THREE.Mesh(
      new THREE.BoxGeometry(baseW, 0.34, baseD),
      lowerBaseMat
    );
    lowerBase.position.y = 0.4;
    lowerBase.castShadow = true;
    this.robotGroup.add(lowerBase);

    const chassisColorHex = bot.chassisColor
      ? parseInt(bot.chassisColor.replace('#', ''), 16)
      : 0xe2e8f0;
    const chassisMat = new THREE.MeshStandardMaterial({
      color: Number.isNaN(chassisColorHex) ? 0xe2e8f0 : chassisColorHex,
      metalness: 0.28,
      roughness: 0.22,
    });
    this.robotChassisMesh = new THREE.Mesh(
      new THREE.BoxGeometry(chassisW, chassisH, chassisD),
      chassisMat
    );
    const chassisCenterY = 0.56 + chassisH / 2;
    this.robotChassisMesh.position.y = chassisCenterY;
    this.robotChassisMesh.castShadow = true;
    this.robotGroup.add(this.robotChassisMesh);

    const hatchY = 0.56 + chassisH + 0.03;
    const hatchMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.55,
      roughness: 0.4,
    });
    const hatch = new THREE.Mesh(
      new THREE.BoxGeometry(chassisW * 0.86, 0.08, chassisD * 0.78),
      hatchMat
    );
    hatch.position.set(0, hatchY, -0.06);
    this.robotGroup.add(hatch);

    const accentColorHex = bot.accentColor
      ? parseInt(bot.accentColor.replace('#', ''), 16)
      : 0x06b6d4;
    const accentColorVal = Number.isNaN(accentColorHex) ? 0x06b6d4 : accentColorHex;
    const accentMat = new THREE.MeshStandardMaterial({
      color: accentColorVal,
      emissive: accentColorVal,
      emissiveIntensity: 0.55,
      roughness: 0.2,
    });
    this.robotAccentMesh = new THREE.Mesh(
      new THREE.BoxGeometry(chassisW + 0.04, 0.11, chassisD + 0.04),
      accentMat
    );
    this.robotAccentMesh.position.y = 0.75;
    this.robotGroup.add(this.robotAccentMesh);

    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.85,
      metalness: 0.1,
    });
    const hubMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.85,
      roughness: 0.2,
    });

    const isSixWheel = bot.wheelConfiguration === '6-Wheel Heavy Differential';
    const wheelRadius =
      bot.wheelConfiguration === 'Compact 4-Wheel Omni/Express' ? 0.28 : 0.32;
    const wxMag = baseW / 2 + 0.05;
    const wzMag = baseD * 0.34;
    const wheelOffsets: [number, number][] = isSixWheel
      ? [
          [-wxMag, wzMag],
          [wxMag, wzMag],
          [-wxMag, 0],
          [wxMag, 0],
          [-wxMag, -wzMag],
          [wxMag, -wzMag],
        ]
      : [
          [-wxMag, wzMag],
          [wxMag, wzMag],
          [-wxMag, -wzMag],
          [wxMag, -wzMag],
        ];

    for (const [wx, wz] of wheelOffsets) {
      const wheelGroup = new THREE.Group();
      wheelGroup.position.set(wx, wheelRadius, wz);

      const tire = new THREE.Mesh(
        new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.22, 18),
        tireMat
      );
      tire.rotation.z = Math.PI / 2;
      wheelGroup.add(tire);

      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(wheelRadius * 0.5, wheelRadius * 0.5, 0.24, 12),
        hubMat
      );
      hub.rotation.z = Math.PI / 2;
      wheelGroup.add(hub);

      this.robotWheels.push(wheelGroup);
      this.robotGroup.add(wheelGroup);
    }

    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x020617,
      metalness: 0.9,
      roughness: 0.1,
    });
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(chassisW * 0.7, 0.22, 0.1),
      visorMat
    );
    visor.position.set(0, chassisCenterY + 0.08, chassisD / 2 + 0.02);
    this.robotGroup.add(visor);

    const frontLed = new THREE.Mesh(
      new THREE.BoxGeometry(chassisW * 0.62, 0.07, 0.06),
      new THREE.MeshBasicMaterial({ color: accentColorVal })
    );
    frontLed.position.set(0, 0.58, baseD / 2 + 0.02);
    this.robotGroup.add(frontLed);

    const rearLed = new THREE.Mesh(
      new THREE.BoxGeometry(chassisW * 0.62, 0.07, 0.06),
      new THREE.MeshBasicMaterial({ color: 0xef4444 })
    );
    rearLed.position.set(0, 0.58, -baseD / 2 - 0.02);
    this.robotGroup.add(rearLed);

    this.robotLidarTurret = new THREE.Group();
    this.robotLidarTurret.position.set(0, hatchY + 0.04, chassisD * 0.22);

    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.18, 0.26, 14),
      lowerBaseMat
    );
    mast.position.y = 0.13;
    this.robotLidarTurret.add(mast);

    const lidarPuck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.15, 18),
      visorMat
    );
    lidarPuck.position.y = 0.32;
    this.robotLidarTurret.add(lidarPuck);

    const statusMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });
    this.robotStatusLight = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 14, 14),
      statusMat
    );
    this.robotStatusLight.position.y = 0.48;
    this.robotLidarTurret.add(this.robotStatusLight);

    this.robotGroup.add(this.robotLidarTurret);

    // Secondary Rear LiDAR Turret for Dual 3D Dome LiDAR configurations (e.g., OmniStride S4)
    if (bot.lidarType === 'Dual 3D Dome LiDAR') {
      const rearTurret = new THREE.Group();
      rearTurret.position.set(0, hatchY + 0.04, -chassisD * 0.28);
      const rearMast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.15, 0.2, 12),
        lowerBaseMat
      );
      rearMast.position.y = 0.1;
      rearTurret.add(rearMast);
      const rearPuck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 0.13, 16),
        visorMat
      );
      rearPuck.position.y = 0.24;
      rearTurret.add(rearPuck);
      this.robotGroup.add(rearTurret);
    }

    // Forward LiDAR / Depth Sensor Field-of-View Wedge scaled by robot's lidarRangeM & lidarFovDeg
    const visualConeRadius = Math.max(
      4.2,
      Math.min(9.5, (bot.lidarRangeM ?? 24) * 0.23)
    );
    const fovRad = Math.min(
      Math.PI * 0.72,
      Math.max(0.65, ((bot.lidarFovDeg ?? 270) / 270) * 0.96)
    );
    const coneGeo = new THREE.CircleGeometry(
      visualConeRadius,
      24,
      Math.PI / 2 - fovRad / 2,
      fovRad
    );
    const coneMat = new THREE.MeshBasicMaterial({
      color: accentColorVal,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.robotSensorCone = new THREE.Mesh(coneGeo, coneMat);
    this.robotSensorCone.rotation.x = -Math.PI / 2;
    this.robotSensorCone.position.set(0, 0.12, baseD / 2);
    this.robotSensorCone.visible = prevConeVis;
    this.robotGroup.add(this.robotSensorCone);

    const colliderRadius = bot.collisionRadiusM ?? ROBOT_COLLISION_RADIUS;
    const colliderBoxGeo = new THREE.CylinderGeometry(
      colliderRadius,
      colliderRadius,
      1.6 * heightScale,
      16
    );
    const colliderEdges = new THREE.EdgesGeometry(colliderBoxGeo);
    this.robotDebugCollider = new THREE.LineSegments(
      colliderEdges,
      new THREE.LineBasicMaterial({ color: 0x10b981 })
    );
    this.robotDebugCollider.position.y = 0.82 * heightScale;
    this.robotDebugCollider.visible = prevColliderVis;
    this.robotGroup.add(this.robotDebugCollider);

    if (!this.robotGroup.parent) {
      this.scene.add(this.robotGroup);
    }
  }

  private buildRobotCurrentCellMarker(): void {
    this.robotCurrentCellMarker = new THREE.Group();
    const cellGeo = new THREE.PlaneGeometry(CELL_SIZE * 0.96, CELL_SIZE * 0.96);
    cellGeo.rotateX(-Math.PI / 2);
    const cellMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    const cellMesh = new THREE.Mesh(cellGeo, cellMat);
    cellMesh.position.y = 0.11;
    this.robotCurrentCellMarker.add(cellMesh);

    const borderEdges = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(CELL_SIZE, 0.08, CELL_SIZE)
    );
    const borderLine = new THREE.LineSegments(
      borderEdges,
      new THREE.LineBasicMaterial({ color: 0x34d399 })
    );
    borderLine.position.y = 0.12;
    this.robotCurrentCellMarker.add(borderLine);

    this.robotCurrentCellMarker.visible = false;
    this.scene.add(this.robotCurrentCellMarker);
  }

  private buildNextWaypointMarker(): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.52, 24),
      new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.19;
    this.nextWaypointMarkerGroup.add(ring);

    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 12, 12),
      new THREE.MeshBasicMaterial({
        color: 0xfbbf24,
      })
    );
    beacon.position.y = 0.35;
    this.nextWaypointMarkerGroup.add(beacon);
    this.nextWaypointMarkerGroup.visible = false;
  }

  private updateNextWaypointMarker(): void {
    if (
      !this.showPathLine ||
      !this.navController ||
      !Array.isArray(this.navController.waypoints) ||
      this.navController.waypoints.length < 2
    ) {
      this.nextWaypointMarkerGroup.visible = false;
      return;
    }
    const idx = Math.min(
      Math.max(0, this.navController.currentWaypointIdx),
      this.navController.waypoints.length - 1
    );
    const nextWp = this.navController.waypoints[idx];
    if (!nextWp) {
      this.nextWaypointMarkerGroup.visible = false;
      return;
    }
    this.nextWaypointMarkerGroup.visible = true;
    this.nextWaypointMarkerGroup.position.set(
      nextWp.x,
      nextWp.y ?? this.navController.robotAltitudeY,
      nextWp.z
    );
  }

  private rebuildDynamicObstacles(): void {
    while (this.dynamicObstacleGroup.children.length > 0) {
      this.dynamicObstacleGroup.remove(this.dynamicObstacleGroup.children[0]);
    }
    this.dynamicObstacleMeshes = [];

    const classColors: Record<string, number> = {
      commuter: 0x38bdf8,
      random: 0xa855f7,
      crossing: 0xf59e0b,
      group: 0x10b981,
    };

    const headMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.3,
    });

    const ringPts: THREE.Vector3[] = [];
    const pedRadius = 0.48;
    for (let a = 0; a < 24; a++) {
      const theta = (a / 24) * Math.PI * 2;
      ringPts.push(
        new THREE.Vector3(
          Math.cos(theta) * pedRadius,
          0.14,
          Math.sin(theta) * pedRadius
        )
      );
    }
    const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);

    for (const agent of this.navController.dynamicObstacles) {
      const pedGroup = new THREE.Group();
      pedGroup.position.set(agent.currentPos.x, 0, agent.currentPos.z);

      const torsoColor = classColors[agent.behaviorClass] ?? 0x38bdf8;
      const bodyMat = new THREE.MeshStandardMaterial({
        color: torsoColor,
        roughness: 0.35,
        metalness: 0.3,
      });

      const torso = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.32, 1.1, 10),
        bodyMat
      );
      torso.position.y = 0.65;
      pedGroup.add(torso);

      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 10, 10),
        headMat
      );
      head.position.y = 1.42;
      pedGroup.add(head);

      const debugRing = new THREE.LineLoop(
        ringGeo,
        new THREE.LineBasicMaterial({ color: torsoColor })
      );
      debugRing.visible = this.showCollisionDebug || this.showNavGrid;
      pedGroup.add(debugRing);

      // Predicted trajectory line in world coordinates
      const predLineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(agent.currentPos.x, 0.18, agent.currentPos.z),
        new THREE.Vector3(agent.currentPos.x, 0.18, agent.currentPos.z),
      ]);
      const predLine = new THREE.Line(
        predLineGeo,
        new THREE.LineBasicMaterial({
          color: torsoColor,
          transparent: true,
          opacity: 0.65,
        })
      );
      this.dynamicObstacleGroup.add(predLine);

      this.dynamicObstacleGroup.add(pedGroup);
      this.dynamicObstacleMeshes.push({
        id: agent.id,
        mesh: pedGroup,
        debugRing,
        predLine,
      });
    }
  }

  public rebuildPathVisual(pathEvent?: PathUpdateEvent | null): void {
    while (this.pathLineGroup.children.length > 0) {
      this.pathLineGroup.remove(this.pathLineGroup.children[0]);
    }

    // Explicitly handle null pathEvent or uninitialized state by keeping pathLineGroup cleared
    if (pathEvent === null) {
      if (this.showNavGrid && this.navController) {
        this.rebuildGridAndDebugVisuals();
      }
      return;
    }

    const resolvedEvent: PathUpdateEvent | null =
      pathEvent !== undefined
        ? pathEvent
        : this.navController
        ? this.navController.getPathUpdateEvent()
        : null;

    if (!resolvedEvent) return;

    const { waypoints, diagnostics, replanCount } = resolvedEvent;

    // If path visualization is toggled off, pathfinding failed, or waypoints are empty/insufficient, keep cleared
    if (
      !this.showPathLine ||
      (diagnostics && !diagnostics.reachable) ||
      !Array.isArray(waypoints) ||
      waypoints.length < 2
    ) {
      if (this.showNavGrid && this.navController) {
        this.rebuildGridAndDebugVisuals();
      }
      return;
    }

    const points = waypoints.map(
      (wp) => new THREE.Vector3(wp.x, (wp.y ?? 0) + 0.16, wp.z)
    );
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    const isDetour =
      Boolean(diagnostics && diagnostics.detourActive) || replanCount > 0;
    const lineMat = new THREE.LineBasicMaterial({
      color: isDetour ? 0x10b981 : 0x06b6d4,
    });
    const line = new THREE.Line(lineGeo, lineMat);
    this.pathLineGroup.add(line);

    const nodeGeo = new THREE.SphereGeometry(0.18, 10, 10);
    const nodeMat = new THREE.MeshBasicMaterial({
      color: isDetour ? 0x34d399 : 0x22d3ee,
    });

    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i];
      const dot = new THREE.Mesh(nodeGeo, nodeMat);
      dot.position.set(wp.x, (wp.y ?? 0) + 0.16, wp.z);
      this.pathLineGroup.add(dot);
    }

    // If an elevator mission is in its approach phase, also render a preview line
    // through the single doorway, along the vertical shaft between originFloor and targetFloor,
    // and out to the target destination room
    if (
      this.navController &&
      this.navController.requiresElevator &&
      this.navController.elevatorMissionPhase !== 'exiting-to-destination'
    ) {
      const elevCfg = this.navController.getActiveElevatorConfig();
      if (elevCfg) {
        const originY = this.navController.originFloor * elevCfg.floorHeightM;
        const destY = this.navController.targetFloor * elevCfg.floorHeightM;
        const destCoords =
          this.navController.getTargetDestinationRoomCoords(elevCfg);
        const previewPts: THREE.Vector3[] = [
          new THREE.Vector3(elevCfg.lobbyPos.x, originY + 0.16, elevCfg.lobbyPos.z),
          new THREE.Vector3(
            elevCfg.doorwayPos.x,
            originY + 0.16,
            elevCfg.doorwayPos.z
          ),
          new THREE.Vector3(elevCfg.cabinPos.x, originY + 0.16, elevCfg.cabinPos.z),
          new THREE.Vector3(elevCfg.cabinPos.x, destY + 0.16, elevCfg.cabinPos.z),
          new THREE.Vector3(elevCfg.doorwayPos.x, destY + 0.16, elevCfg.doorwayPos.z),
          new THREE.Vector3(elevCfg.lobbyPos.x, destY + 0.16, elevCfg.lobbyPos.z),
          new THREE.Vector3(destCoords.x, destY + 0.16, destCoords.z),
        ];
        const prevGeo = new THREE.BufferGeometry().setFromPoints(previewPts);
        const prevMat = new THREE.LineBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.65,
        });
        this.pathLineGroup.add(new THREE.Line(prevGeo, prevMat));
      }
    }

    if (this.showNavGrid && this.navController) {
      this.rebuildGridAndDebugVisuals();
    }
  }

  private rebuildGridAndDebugVisuals(): void {
    while (this.gridOverlayGroup.children.length > 0) {
      this.gridOverlayGroup.remove(this.gridOverlayGroup.children[0]);
    }
    while (this.collisionDebugGroup.children.length > 0) {
      this.collisionDebugGroup.remove(this.collisionDebugGroup.children[0]);
    }

    const showAnyDebug = this.showNavGrid || this.showCollisionDebug;
    this.robotCurrentCellMarker.visible = showAnyDebug;
    this.robotDebugCollider.visible = this.showCollisionDebug;

    for (const obs of this.dynamicObstacleMeshes) {
      obs.debugRing.visible = showAnyDebug;
    }

    if (this.showNavGrid) {
      const walkableCells: Vector2D[] = [];
      const constructionBlockedCells: Vector2D[] = [];
      const restrictedCells: Vector2D[] = [];
      const staticBlockedCells: Vector2D[] = [];

      for (const row of this.navController.cachedGrid) {
        for (const cell of row) {
          if (
            cell.blockReason === 'construction-full' ||
            cell.blockReason === 'construction-partial'
          ) {
            constructionBlockedCells.push({ x: cell.worldX, z: cell.worldZ });
          } else if (
            cell.blockReason === 'restricted-lane' ||
            cell.blockReason === 'dynamic-pedestrian'
          ) {
            restrictedCells.push({ x: cell.worldX, z: cell.worldZ });
          } else if (
            cell.blockReason === 'building' ||
            cell.blockReason === 'static-prop'
          ) {
            if (cell.gx % 2 === 0 && cell.gz % 2 === 0) {
              staticBlockedCells.push({ x: cell.worldX, z: cell.worldZ });
            }
          } else if (cell.walkable && cell.isRoadOrPath) {
            walkableCells.push({ x: cell.worldX, z: cell.worldZ });
          }
        }
      }

      const tileGeo = new THREE.PlaneGeometry(CELL_SIZE * 0.84, CELL_SIZE * 0.84);
      tileGeo.rotateX(-Math.PI / 2);

      const addInstancedTiles = (
        positions: Vector2D[],
        colorHex: number,
        opacity: number,
        yOffset: number
      ) => {
        if (positions.length === 0) return;
        const mat = new THREE.MeshBasicMaterial({
          color: colorHex,
          transparent: true,
          opacity,
          depthWrite: false,
        });
        const inst = new THREE.InstancedMesh(tileGeo, mat, positions.length);
        positions.forEach((pos, idx) => {
          _dummyObj.position.set(pos.x, yOffset, pos.z);
          _dummyObj.rotation.set(0, 0, 0);
          _dummyObj.scale.setScalar(1);
          _dummyObj.updateMatrix();
          inst.setMatrixAt(idx, _dummyObj.matrix);
        });
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        this.gridOverlayGroup.add(inst);
      };

      addInstancedTiles(walkableCells, 0x06b6d4, 0.16, 0.085);
      addInstancedTiles(constructionBlockedCells, 0xef4444, 0.5, 0.095);
      addInstancedTiles(restrictedCells, 0xf59e0b, 0.4, 0.092);
      addInstancedTiles(staticBlockedCells, 0x6366f1, 0.22, 0.088);
    }

    if (this.showCollisionDebug) {
      const { blockedBoxes, restrictedBoxes } =
        getActiveConstructionObstacleBounds(
          this.navController.currentScenario.activeConstructionZones
        );
      const staticBounds = getAllStaticObstacleBounds();

      const addWireframeBox = (
        minX: number,
        maxX: number,
        minZ: number,
        maxZ: number,
        height: number,
        colorHex: number
      ) => {
        const w = maxX - minX;
        const d = maxZ - minZ;
        const boxGeo = new THREE.BoxGeometry(w, height, d);
        const edges = new THREE.EdgesGeometry(boxGeo);
        const line = new THREE.LineSegments(
          edges,
          new THREE.LineBasicMaterial({ color: colorHex })
        );
        line.position.set(
          (minX + maxX) / 2,
          height / 2 + 0.08,
          (minZ + maxZ) / 2
        );
        this.collisionDebugGroup.add(line);
      };

      for (const bBox of blockedBoxes) {
        addWireframeBox(bBox.minX, bBox.maxX, bBox.minZ, bBox.maxZ, 1.5, 0xef4444);
      }
      for (const rBox of restrictedBoxes) {
        addWireframeBox(rBox.minX, rBox.maxX, rBox.minZ, rBox.maxZ, 1.1, 0xf59e0b);
      }
      for (const sBox of staticBounds.boxes) {
        addWireframeBox(sBox.minX, sBox.maxX, sBox.minZ, sBox.maxZ, 1.8, 0x6366f1);
      }
    }
  }

  private setupInteractionEvents(): void {
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const onPointerDown = (e: MouseEvent) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, this.camera);
      const hits = raycaster.intersectObjects(this.interactiveMeshes, false);
      if (hits.length > 0) {
        const bldgName = hits[0].object.userData?.buildingName;
        if (bldgName) {
          this.selectedBuildingName = bldgName;
          this.emitTelemetry();
        }
      }
    };

    this.renderer.domElement.addEventListener('pointerdown', onPointerDown);
  }

  public resize(): void {
    if (this.isDisposed) return;
    const width = this.container.clientWidth || 960;
    const height = this.container.clientHeight || 600;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public setConfiguration(
    scenario: ScenarioConfig,
    policy: NavigationPolicyConfig,
    robotId: string,
    destinationOverrideId: string | null = null
  ): void {
    const allRobots = loadRobots();
    const bot =
      allRobots.find((r) => r.id === robotId) ??
      ROBOT_UNITS.find((r) => r.id === robotId) ??
      ROBOT_UNITS[0];

    this.navController.setRobotHardwareConfig(bot);
    this.navController.setConfiguration(
      scenario,
      policy,
      robotId,
      destinationOverrideId
    );
    this.buildAutonomousRobot(bot);

    if (policy.isCandidatePolicy) {
      this.navController.setCandidatePolicyState(loadCandidatePolicyState(), false);
    } else {
      this.navController.setCandidatePolicyState(null, false);
    }
    this.syncVisualsFromController();
    this.emitTelemetry();
  }

  public setVisualLayers(options: {
    showNavGrid?: boolean;
    showPathLine?: boolean;
    showSensorCone?: boolean;
    showCollisionDebug?: boolean;
    showBuildingCutaway?: boolean;
  }): void {
    if (options.showNavGrid !== undefined) {
      this.showNavGrid = options.showNavGrid;
    }
    if (options.showCollisionDebug !== undefined) {
      this.showCollisionDebug = options.showCollisionDebug;
    }
    if (options.showPathLine !== undefined) {
      this.showPathLine = options.showPathLine;
      this.rebuildPathVisual();
    }
    if (options.showSensorCone !== undefined) {
      this.showSensorCone = options.showSensorCone;
      this.robotSensorCone.visible = this.showSensorCone;
    }
    if (options.showBuildingCutaway !== undefined) {
      this.showBuildingCutaway = options.showBuildingCutaway;
      this.updateBuildingCutawayTransparency();
    }
    if (
      options.showNavGrid !== undefined ||
      options.showCollisionDebug !== undefined
    ) {
      this.rebuildGridAndDebugVisuals();
    }
  }

  private updateBuildingCutawayTransparency(): void {
    const isCutawayActive =
      this.showBuildingCutaway ||
      Boolean(
        this.navController &&
          (this.navController.requiresElevator ||
            this.navController.originFloor > 0 ||
            this.navController.targetFloor > 0)
      ) ||
      this.cameraMode === 'elevator-interior';

    for (const [bldgId, shell] of this.buildingShellMeshes.entries()) {
      const isElevatorBuilding =
        bldgId === 'bldg-student-center' || bldgId === 'bldg-library';
      if (isElevatorBuilding && isCutawayActive) {
        shell.bodyMat.transparent = true;
        shell.bodyMat.opacity = 0.16;
        shell.bodyMat.depthWrite = false;
        shell.tierMat.transparent = true;
        shell.tierMat.opacity = 0.18;
        shell.tierMat.depthWrite = false;
      } else {
        shell.bodyMat.transparent = false;
        shell.bodyMat.opacity = 1.0;
        shell.bodyMat.depthWrite = true;
        shell.tierMat.transparent = false;
        shell.tierMat.opacity = 1.0;
        shell.tierMat.depthWrite = true;
      }
      shell.bodyMat.needsUpdate = true;
      shell.tierMat.needsUpdate = true;
    }
  }

  public setSimulationSpeed(multiplier: number): void {
    this.simSpeedMultiplier = multiplier;
  }

  public setPredictionHorizon(horizonSec: PredictionHorizonSec): void {
    this.navController.setPredictionHorizon(horizonSec);
    this.emitTelemetry();
  }

  public setPedestrianDistribution(dist: PedestrianDistributionConfig): void {
    this.navController.setPedestrianDistribution(dist);
    this.syncVisualsFromController();
    this.emitTelemetry();
  }

  public setElevatorFaultMode(
    faultMode: ElevatorFaultMode,
    requiresElevator = true
  ): void {
    this.navController.setElevatorFaultMode(faultMode, requiresElevator);
    this.syncVisualsFromController();
    this.emitTelemetry();
  }

  public setCameraPreset(preset: CameraPresetId): void {
    this.cameraMode = preset;
    this.updateBuildingCutawayTransparency();
    if (preset === 'isometric') {
      this.activeCameraTransition = {
        targetPos: new THREE.Vector3(44, 38, 46),
        targetLookAt: new THREE.Vector3(0, 0, 0),
      };
    } else if (preset === 'top-down') {
      this.activeCameraTransition = {
        targetPos: new THREE.Vector3(0, 76, 4),
        targetLookAt: new THREE.Vector3(0, 0, 0),
      };
    } else if (preset === 'charging-station') {
      this.activeCameraTransition = {
        targetPos: new THREE.Vector3(-4, 12, -2),
        targetLookAt: new THREE.Vector3(-14, 1, -10),
      };
    } else if (preset === 'construction-zone') {
      this.activeCameraTransition = {
        targetPos: new THREE.Vector3(20, 15, 14),
        targetLookAt: new THREE.Vector3(8, 0, 0),
      };
    } else if (preset === 'elevator-interior') {
      const activeCfg =
        this.navController?.getActiveElevatorConfig() ?? CAMPUS_ELEVATORS[0];
      const cx = activeCfg.cabinPos.x;
      const cz = activeCfg.lobbyPos.z;
      this.activeCameraTransition = {
        targetPos: new THREE.Vector3(cx + 12, 11.5, cz + 14),
        targetLookAt: new THREE.Vector3(cx + 1.5, 3.6, cz - 1.0),
      };
    } else if (preset === 'follow') {
      this.activeCameraTransition = null;
    }
  }

  public startSimulation(): void {
    if (this.navController.currentPolicy.isCandidatePolicy) {
      this.navController.setCandidatePolicyState(loadCandidatePolicyState(), false);
    }
    if (
      this.navController.runState === 'completed' ||
      this.navController.runState === 'failed'
    ) {
      this.navController.reset(false);
      this.syncVisualsFromController();
    }
    this.navController.start();
    this.updateStatusLightColor();
    this.emitTelemetry();
  }

  public pauseSimulation(): void {
    this.navController.pause();
    this.updateStatusLightColor();
    this.emitTelemetry();
  }

  public resetSimulationState(logReset = true): void {
    this.navController.reset(logReset);
    this.syncVisualsFromController();
    this.emitTelemetry();
  }

  private syncVisualsFromController(): void {
    const profile = this.navController.perceptionProfile;
    this.scene.fog = new THREE.FogExp2(0x070b14, profile.fogDensity);
    const coneScale = Math.max(
      0.55,
      Math.min(1.15, profile.visibilityRangeM / 22.0)
    );
    this.robotSensorCone.scale.set(coneScale, coneScale, 1);

    for (const [czId, group] of this.constructionGroups.entries()) {
      group.visible =
        this.navController.currentScenario.activeConstructionZones.includes(czId);
    }

    this.robotGroup.position.set(
      this.navController.robotPos.x,
      this.navController.robotAltitudeY,
      this.navController.robotPos.z
    );
    this.robotGroup.rotation.y = this.navController.robotHeading;

    this.updateBuildingCutawayTransparency();
    this.updateStatusLightColor();
    this.rebuildDynamicObstacles();
    this.rebuildPathVisual(this.navController.getPathUpdateEvent());
    this.rebuildGridAndDebugVisuals();
    this.updateRobotCellMarkerPosition();
    this.updateNextWaypointMarker();
    this.updateElevatorVisuals();
  }

  private updateStatusLightColor(): void {
    if (!this.robotStatusLight || !this.navController) return;
    const mat = this.robotStatusLight.material as THREE.MeshBasicMaterial;
    switch (this.navController.robotOpState) {
      case 'Navigating':
      case 'Entering Building':
      case 'Boarding Elevator':
      case 'In Elevator Transit':
      case 'Exiting Elevator':
        mat.color.setHex(0x06b6d4);
        break;
      case 'Speed Regulation':
      case 'Local Bypass':
      case 'Pedestrian Detected':
      case 'Replanning Path':
      case 'Obstacle Yield':
      case 'WaitingForClearPath':
      case 'Waiting for Elevator':
        mat.color.setHex(0xf59e0b);
        break;
      case 'Emergency Stop':
      case 'Awaiting Assistance':
        mat.color.setHex(0xef4444);
        break;
      default:
        mat.color.setHex(0x10b981);
        break;
    }
  }

  private updateElevatorVisuals(): void {
    if (!this.navController) return;
    for (const unit of this.navController.elevatorUnits) {
      const handle = this.elevatorHandles.get(unit.id);
      if (!handle) continue;
      const fh = unit.floorHeightM ?? 3.6;
      const cabY = Math.max(0, unit.currentFloor) * fh;
      handle.cabGroup.position.y = cabY;

      // Animate bi-parting sliding doors on Ground Floor (0), First Floor (1), and Second Floor (2)
      const cx = unit.cabinPos?.x ?? 0;
      const openRatio = unit.doorOpenProgress ?? 0;
      const groundOpen = Math.abs(unit.currentFloor - 0) < 0.35 ? openRatio : 0;
      const firstOpen = Math.abs(unit.currentFloor - 1) < 0.35 ? openRatio : 0;
      const upperOpen = Math.abs(unit.currentFloor - 2) < 0.35 ? openRatio : 0;

      handle.groundDoorL.position.x = cx - 0.52 - groundOpen * 0.62;
      handle.groundDoorR.position.x = cx + 0.52 + groundOpen * 0.62;
      handle.firstDoorL.position.x = cx - 0.52 - firstOpen * 0.62;
      handle.firstDoorR.position.x = cx + 0.52 + firstOpen * 0.62;
      handle.upperDoorL.position.x = cx - 0.52 - upperOpen * 0.62;
      handle.upperDoorR.position.x = cx + 0.52 + upperOpen * 0.62;

      if (
        unit.state === 'Stuck' ||
        unit.state === 'Out of Service' ||
        unit.state === 'Emergency Assistance' ||
        unit.machineState === 'STUCK' ||
        unit.machineState === 'OUT_OF_SERVICE'
      ) {
        handle.beaconMat.color.setHex(0xef4444);
      } else if (unit.state === 'Delayed') {
        handle.beaconMat.color.setHex(0xf59e0b);
      } else if (unit.state === 'Available' && unit.machineState === 'IDLE') {
        handle.beaconMat.color.setHex(0x10b981);
      } else {
        handle.beaconMat.color.setHex(0x06b6d4);
      }
    }
  }

  private updateRobotCellMarkerPosition(): void {
    if (!this.robotCurrentCellMarker || !this.navController) return;
    const { gx, gz } = worldToGridCoords(
      this.navController.robotPos.x,
      this.navController.robotPos.z
    );
    const cell = this.navController.cachedGrid[gx]?.[gz];
    if (cell) {
      this.robotCurrentCellMarker.position.set(
        cell.worldX,
        this.navController.robotAltitudeY,
        cell.worldZ
      );
    }
  }

  private emitLog(level: SimulationLogEntry['level'], message: string): void {
    const now = new Date();
    const timeStr = now.toTimeString().slice(0, 8);
    this.onLogEvent({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      time: timeStr,
      level,
      message,
    });
  }

  private emitTelemetry(): void {
    this.onTelemetryUpdate(
      this.navController.getTelemetrySnapshot(this.selectedBuildingName)
    );
  }

  private advanceSimulation(dt: number): void {
    this.robotLidarTurret.rotation.y += dt * 4.5;

    const elapsed = this.clock.getElapsedTime();
    for (let i = 0; i < this.deliveryRingMeshes.length; i++) {
      const s = 1 + Math.sin(elapsed * 2.5 + i) * 0.05;
      this.deliveryRingMeshes[i].scale.set(s, s, 1);
    }

    const totalScaledDt = Math.min(dt, 0.1) * this.simSpeedMultiplier;
    const numSubSteps = Math.max(1, Math.ceil(totalScaledDt / 0.02));
    const subDt = totalScaledDt / numSubSteps;

    const prevDist = this.navController.distanceTraveledM;
    for (let step = 0; step < numSubSteps; step++) {
      this.navController.step(subDt);
    }
    const deltaDist = Math.max(0, this.navController.distanceTraveledM - prevDist);
    if (deltaDist > 0) {
      for (const wheel of this.robotWheels) {
        wheel.rotation.x += deltaDist * 2.8;
      }
    }

    // Sync 3D pedestrian meshes, debug rings, and predicted trajectory lines
    for (let i = 0; i < this.dynamicObstacleMeshes.length; i++) {
      const handle = this.dynamicObstacleMeshes[i];
      const agent = this.navController.dynamicObstacles[i];
      if (!agent) continue;
      handle.mesh.position.set(agent.currentPos.x, 0, agent.currentPos.z);
      handle.mesh.rotation.y = agent.headingRad;

      if (agent.predictedTrajectory && agent.predictedTrajectory.length > 0) {
        const pts = [
          new THREE.Vector3(agent.currentPos.x, 0.18, agent.currentPos.z),
          ...agent.predictedTrajectory.map(
            (p) => new THREE.Vector3(p.x, 0.18, p.z)
          ),
        ];
        handle.predLine.geometry.dispose();
        handle.predLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
        handle.predLine.visible = true;
      } else {
        handle.predLine.visible = false;
      }
    }

    // Render active predicted trajectory conflict markers on ground
    while (this.predictiveConflictGroup.children.length > 0) {
      this.predictiveConflictGroup.remove(
        this.predictiveConflictGroup.children[0]
      );
    }
    for (const conflict of this.navController.activePredictedConflicts) {
      const conflictRing = new THREE.Mesh(
        new THREE.RingGeometry(
          Math.max(0.4, conflict.uncertaintyRadiusM * 0.7),
          conflict.uncertaintyRadiusM + 0.25,
          20
        ),
        new THREE.MeshBasicMaterial({
          color: conflict.ttcSec <= 1.6 ? 0xef4444 : 0xf59e0b,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.75,
        })
      );
      conflictRing.rotation.x = -Math.PI / 2;
      conflictRing.position.set(conflict.conflictPos.x, 0.14, conflict.conflictPos.z);
      this.predictiveConflictGroup.add(conflictRing);
    }

    this.updateElevatorVisuals();

    // Synchronize robot vertical transform with active elevator cabin when aboard
    const activeElev = this.navController.elevatorUnits.find((e) => e.robotInside);
    const activeCabHandle = activeElev
      ? this.elevatorHandles.get(activeElev.id)
      : undefined;
    const syncedRobotY =
      activeElev && activeCabHandle
        ? activeCabHandle.cabGroup.position.y + 0.08
        : this.navController.robotAltitudeY;

    this.robotGroup.position.set(
      this.navController.robotPos.x,
      syncedRobotY,
      this.navController.robotPos.z
    );
    this.robotGroup.rotation.y = this.navController.robotHeading;
    this.updateRobotCellMarkerPosition();
    this.updateNextWaypointMarker();

    if (this.navController.runState === 'running') {
      this.emitTelemetry();
    }
  }

  private updateCameraChoreography(dt: number): void {
    const robotPos = this.navController.robotPos;
    const robotY = this.navController.robotAltitudeY;
    const robotHeading = this.navController.robotHeading;
    if (this.cameraMode === 'follow') {
      const offsetBack = 14;
      const offsetHeight = 9.5 + robotY;
      _vec3A.set(
        robotPos.x - Math.sin(robotHeading) * offsetBack,
        offsetHeight,
        robotPos.z - Math.cos(robotHeading) * offsetBack
      );
      _vec3B.set(robotPos.x, 1.0 + robotY, robotPos.z);

      this.camera.position.lerp(_vec3A, 1 - Math.exp(-4.5 * dt));
      this.controls.target.lerp(_vec3B, 1 - Math.exp(-6.0 * dt));
    } else if (this.activeCameraTransition) {
      const alpha = 1 - Math.exp(-5.0 * dt);
      this.camera.position.lerp(this.activeCameraTransition.targetPos, alpha);
      this.controls.target.lerp(this.activeCameraTransition.targetLookAt, alpha);

      if (
        this.camera.position.distanceTo(this.activeCameraTransition.targetPos) <
          0.25 &&
        this.controls.target.distanceTo(
          this.activeCameraTransition.targetLookAt
        ) < 0.25
      ) {
        this.activeCameraTransition = null;
      }
    }

    this.controls.update();
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.isDisposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private startLoop(): void {
    const tick = () => {
      if (this.isDisposed) return;
      const dt = this.clock.getDelta();
      this.advanceSimulation(dt);
      this.updateCameraChoreography(dt);
      this.renderer.render(this.scene, this.camera);

      if (this.isSoftwareGl) {
        this.afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };

    tick();
  }

  public dispose(): void {
    this.isDisposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.controls.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
