import {
  CAMPUS_BENCHES,
  CAMPUS_BUILDINGS,
  CAMPUS_ELEVATORS,
  CAMPUS_STREETLIGHTS,
  CAMPUS_TREES,
  CONSTRUCTION_ZONES,
} from '../data/campusConfig';
import {
  CampusElevatorConfig,
  EnvironmentDefinition,
  PedestrianBehaviorClass,
  PedestrianDistributionConfig,
  PredictedConflictPoint,
  PredictionHorizonSec,
  RobotUnitConfig,
  Vector2D,
} from '../types/simulation';

let activeRuntimeEnvironment: EnvironmentDefinition | null = null;

export function setActiveRuntimeEnvironment(
  env: EnvironmentDefinition | null
): void {
  activeRuntimeEnvironment = env;
}

export function getActiveRuntimeEnvironment(): EnvironmentDefinition | null {
  return activeRuntimeEnvironment;
}

export function isCampusEnvironmentActive(): boolean {
  return (
    !activeRuntimeEnvironment ||
    activeRuntimeEnvironment.id === 'env-campus-main'
  );
}

export type CellBlockReason =
  | 'none'
  | 'off-road'
  | 'building'
  | 'static-prop'
  | 'construction-full'
  | 'construction-partial'
  | 'restricted-lane'
  | 'dynamic-pedestrian'
  | 'predicted-conflict';

export interface GridNode {
  gx: number;
  gz: number;
  worldX: number;
  worldZ: number;
  walkable: boolean;
  isRoadOrPath: boolean;
  isPrimaryRoad: boolean;
  costMultiplier: number;
  blockReason: CellBlockReason;
  obstacleName?: string;
}

export interface CollisionAABB {
  id: string;
  name: string;
  type: 'Construction Barrier' | 'Campus Building' | 'Campus Prop';
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface CollisionCircle {
  id: string;
  name: string;
  type: 'Dynamic Pedestrian' | 'Campus Prop';
  x: number;
  z: number;
  radius: number;
}

export interface CollisionHitResult {
  collided: boolean;
  obstacleName: string;
  obstacleType:
    | 'Construction Barrier'
    | 'Dynamic Pedestrian'
    | 'Campus Building'
    | 'Campus Prop';
  contactPoint: Vector2D;
  safePosition: Vector2D;
}

export interface PathfindingDiagnosticsResult {
  path: Vector2D[];
  reachable: boolean;
  detourActive: boolean;
  blockedZonesOnDirectPath: string[];
  failureReason: string | null;
}

export interface PerceptionProfile {
  visibilityRangeM: number;
  sensorNoiseStdM: number;
  uncertaintySafetyBufferM: number;
  fogDensity: number;
}

export const GRID_MIN = -38;
export const GRID_MAX = 38;
export const CELL_SIZE = 1.0;
export const GRID_DIM = Math.floor((GRID_MAX - GRID_MIN) / CELL_SIZE) + 1; // 77 x 77
export const ROBOT_COLLISION_RADIUS = 0.68;

/**
 * Computes fog visibility distance, LiDAR range noise, and safety buffer from scenario sensorNoiseLevel
 * and the active robot's hardware sensor suite (lidarRangeM, baseSensorNoiseStdM, radar/thermal fusion).
 */
export function computePerceptionProfile(
  sensorNoiseLevel: number,
  robot?: RobotUnitConfig
): PerceptionProfile {
  const baseLidarRange = robot?.lidarRangeM ?? 28.0;
  const baseHardwareNoise = robot?.baseSensorNoiseStdM ?? 0.03;
  // Radar + Thermal fusion mitigates low-visibility/fog attenuation
  const weatherResilienceFactor =
    (robot?.hasRadar ? 0.14 : 0) + (robot?.hasThermalCamera ? 0.12 : 0);
  const effectiveNoiseDegradation = Math.max(
    0.05,
    sensorNoiseLevel * (1.95 - weatherResilienceFactor)
  );

  const visibilityRangeM = Number(
    Math.max(
      6.5,
      baseLidarRange * (1.0 - effectiveNoiseDegradation)
    ).toFixed(1)
  );
  const sensorNoiseStdM = Number(
    (
      baseHardwareNoise +
      sensorNoiseLevel * 1.35 * (1.0 - weatherResilienceFactor * 0.6)
    ).toFixed(2)
  );
  const uncertaintySafetyBufferM = Number(
    (sensorNoiseLevel * 2.2 * (1.0 - weatherResilienceFactor * 0.5)).toFixed(2)
  );
  const fogDensity = 0.0058 + sensorNoiseLevel * 0.032;

  return {
    visibilityRangeM,
    sensorNoiseStdM,
    uncertaintySafetyBufferM,
    fogDensity,
  };
}

export function worldToGridCoords(x: number, z: number): { gx: number; gz: number } {
  const gx = Math.max(
    0,
    Math.min(GRID_DIM - 1, Math.round((x - GRID_MIN) / CELL_SIZE))
  );
  const gz = Math.max(
    0,
    Math.min(GRID_DIM - 1, Math.round((z - GRID_MIN) / CELL_SIZE))
  );
  return { gx, gz };
}

export function gridToWorldCoords(gx: number, gz: number): Vector2D {
  return {
    x: GRID_MIN + gx * CELL_SIZE,
    z: GRID_MIN + gz * CELL_SIZE,
  };
}

export function classifyCampusSurface(
  x: number,
  z: number
): { isRoadOrPath: boolean; isPrimaryRoad: boolean } {
  if (!isCampusEnvironmentActive() && activeRuntimeEnvironment) {
    const halfW = Math.min(37, activeRuntimeEnvironment.widthM / 2 - 2);
    const halfD = Math.min(37, activeRuntimeEnvironment.depthM / 2 - 2);
    if (Math.abs(x) > halfW || Math.abs(z) > halfD) {
      return { isRoadOrPath: false, isPrimaryRoad: false };
    }
    const inCorridorOrDoor = activeRuntimeEnvironment.elements.some(
      (el) =>
        (el.floor ?? 0) === 0 &&
        (el.type === 'corridor' || el.type === 'door') &&
        Math.abs(x - el.x) <= el.width / 2 + 1.0 &&
        Math.abs(z - el.z) <= el.depth / 2 + 1.0
    );
    const onSpine = Math.abs(x) <= 4.0 || Math.abs(z) <= 4.0;
    return {
      isRoadOrPath: true,
      isPrimaryRoad: inCorridorOrDoor || onSpine,
    };
  }

  // Primary East-West Main Avenue (z in [-3, 3], x in [-36, 36])
  const onMainEW = Math.abs(z) <= 3.0 && Math.abs(x) <= 36;
  // Primary North-South Main Avenue (x in [-3, 3], z in [-36, 36])
  const onMainNS = Math.abs(x) <= 3.0 && Math.abs(z) <= 36;
  // West & East Primary Robot Corridors (x = -15 and x = 15, 4m wide: cells -17..-13 and 13..17)
  const onWestCorridor = Math.abs(x - -15) <= 2.2 && Math.abs(z) <= 23;
  const onEastCorridor = Math.abs(x - 15) <= 2.2 && Math.abs(z) <= 23;

  if (onMainEW || onMainNS || onWestCorridor || onEastCorridor) {
    return { isRoadOrPath: true, isPrimaryRoad: true };
  }

  // Secondary Pedestrian Walkways & Spurs (North & South Loops z = -15, z = 15, 4m wide: cells -17..-13 and 13..17)
  const onNorthLoop = Math.abs(z - -15) <= 2.2 && Math.abs(x) <= 28;
  const onSouthLoop = Math.abs(z - 15) <= 2.2 && Math.abs(x) <= 28;
  const onChargingSpur = x >= -16 && x <= -12 && z >= -16 && z <= -8;
  const onHostelBSpur = x >= 3 && x <= 9 && z >= 14 && z <= 23;

  if (onNorthLoop || onSouthLoop || onChargingSpur || onHostelBSpur) {
    return { isRoadOrPath: true, isPrimaryRoad: false };
  }

  return { isRoadOrPath: false, isPrimaryRoad: false };
}

export function getActiveConstructionObstacleBounds(
  activeConstructionIds: string[]
): {
  blockedBoxes: CollisionAABB[];
  restrictedBoxes: CollisionAABB[];
} {
  const blockedBoxes: CollisionAABB[] = [];
  const restrictedBoxes: CollisionAABB[] = [];

  const zonesSource =
    !isCampusEnvironmentActive() && activeRuntimeEnvironment
      ? activeRuntimeEnvironment.constructionZones
      : CONSTRUCTION_ZONES;

  for (const cz of zonesSource) {
    const isActive =
      activeConstructionIds.includes(cz.id) ||
      cz.activeInScenarios.includes('all');
    if (!isActive) continue;
    const [cx, , czPos] = cz.position;
    const [w, d] = cz.size;

    if (cz.severity === 'Partial Lane Closure') {
      // Barricaded western half is physically blocked
      blockedBoxes.push({
        id: `${cz.id}-barricade`,
        name: `${cz.name} (Barricaded Lane)`,
        type: 'Construction Barrier',
        minX: cx - w / 2,
        maxX: cx + 0.3,
        minZ: czPos - d / 2,
        maxZ: czPos + d / 2,
      });
      // Eastern narrow passable lane is restricted
      restrictedBoxes.push({
        id: `${cz.id}-restricted`,
        name: `${cz.name} (Narrow Work Lane)`,
        type: 'Construction Barrier',
        minX: cx + 0.3,
        maxX: cx + w / 2,
        minZ: czPos - d / 2,
        maxZ: czPos + d / 2,
      });
    } else {
      // Full Pathway Blockade or Sensor Hazard Zone blocks the zone footprint
      blockedBoxes.push({
        id: cz.id,
        name: cz.name,
        type: 'Construction Barrier',
        minX: cx - w / 2,
        maxX: cx + w / 2,
        minZ: czPos - d / 2,
        maxZ: czPos + d / 2,
      });
    }
  }

  return { blockedBoxes, restrictedBoxes };
}

export function getAllStaticObstacleBounds(): {
  boxes: CollisionAABB[];
  circles: CollisionCircle[];
} {
  const boxes: CollisionAABB[] = [];
  const circles: CollisionCircle[] = [];

  const buildingsSource =
    !isCampusEnvironmentActive() && activeRuntimeEnvironment
      ? activeRuntimeEnvironment.buildings
      : CAMPUS_BUILDINGS;

  for (const bldg of buildingsSource) {
    const [bx, , bz] = bldg.position;
    const [w, , d] = bldg.size;
    boxes.push({
      id: bldg.id,
      name: bldg.name,
      type: 'Campus Building',
      minX: bx - (w / 2 + 0.6),
      maxX: bx + (w / 2 + 0.6),
      minZ: bz - (d / 2 + 0.6),
      maxZ: bz + (d / 2 + 0.6),
    });
  }

  if (isCampusEnvironmentActive()) {
    CAMPUS_BENCHES.forEach(([bx, bz, rotY], idx) => {
      const isRotated = Math.abs(Math.sin(rotY)) > 0.5;
      const halfW = isRotated ? 0.35 : 0.95;
      const halfD = isRotated ? 0.95 : 0.35;
      boxes.push({
        id: `bench-${idx}`,
        name: `Park Bench #${idx + 1}`,
        type: 'Campus Prop',
        minX: bx - halfW,
        maxX: bx + halfW,
        minZ: bz - halfD,
        maxZ: bz + halfD,
      });
    });

    CAMPUS_TREES.forEach(([tx, tz], idx) => {
      circles.push({
        id: `tree-${idx}`,
        name: `Campus Tree #${idx + 1}`,
        type: 'Campus Prop',
        x: tx,
        z: tz,
        radius: 0.65,
      });
    });

    CAMPUS_STREETLIGHTS.forEach(([lx, lz], idx) => {
      circles.push({
        id: `light-${idx}`,
        name: `Streetlight Pole #${idx + 1}`,
        type: 'Campus Prop',
        x: lx,
        z: lz,
        radius: 0.25,
      });
    });
  } else if (activeRuntimeEnvironment) {
    const locs = activeRuntimeEnvironment.locations ?? [];
    for (const el of activeRuntimeEnvironment.elements ?? []) {
      if ((el.floor ?? 0) !== 0) continue;
      if (el.type === 'wall' || el.type === 'obstacle') {
        const minX = el.x - el.width / 2;
        const maxX = el.x + el.width / 2;
        const minZ = el.z - el.depth / 2;
        const maxZ = el.z + el.depth / 2;
        // Skip if a location dock is placed right inside/next to this element
        const blocksDock = locs.some(
          (l) =>
            (l.floor ?? 0) === 0 &&
            l.position[0] >= minX - 1.5 &&
            l.position[0] <= maxX + 1.5 &&
            l.position[2] >= minZ - 1.5 &&
            l.position[2] <= maxZ + 1.5
        );
        if (!blocksDock) {
          boxes.push({
            id: el.id,
            name: el.name,
            type: el.type === 'wall' ? 'Campus Building' : 'Campus Prop',
            minX,
            maxX,
            minZ,
            maxZ,
          });
        }
      }
    }
  }

  return { boxes, circles };
}

export interface PredictedGridPenaltyZone {
  pos: Vector2D;
  radiusM: number;
  costPenalty: number;
  pedestrianName: string;
}

export function buildNavigationGrid(
  activeConstructionIds: string[],
  constructionAvoidanceWeight = 2.5,
  dynamicPedestrianPositions: Vector2D[] = [],
  robotStartCell?: { gx: number; gz: number },
  predictedConflictZones: PredictedGridPenaltyZone[] = []
): GridNode[][] {
  const grid: GridNode[][] = [];
  const { blockedBoxes, restrictedBoxes } =
    getActiveConstructionObstacleBounds(activeConstructionIds);
  const staticBounds = getAllStaticObstacleBounds();
  const pad = ROBOT_COLLISION_RADIUS;

  for (let gx = 0; gx < GRID_DIM; gx++) {
    const row: GridNode[] = [];
    const worldX = GRID_MIN + gx * CELL_SIZE;

    for (let gz = 0; gz < GRID_DIM; gz++) {
      const worldZ = GRID_MIN + gz * CELL_SIZE;
      const { isRoadOrPath, isPrimaryRoad } = classifyCampusSurface(worldX, worldZ);

      let walkable = isRoadOrPath;
      let blockReason: CellBlockReason = isRoadOrPath ? 'none' : 'off-road';
      let obstacleName: string | undefined = undefined;
      // Primary avenues have cost 1.0; secondary pedestrian loops have cost 1.65 so Nominal routes use Main Avenues
      let costMultiplier = isPrimaryRoad ? 1.0 : 1.65;

      // 1. Check static buildings & benches
      for (const box of staticBounds.boxes) {
        if (
          worldX >= box.minX - pad &&
          worldX <= box.maxX + pad &&
          worldZ >= box.minZ - pad &&
          worldZ <= box.maxZ + pad
        ) {
          walkable = false;
          blockReason = box.type === 'Campus Building' ? 'building' : 'static-prop';
          obstacleName = box.name;
          break;
        }
      }

      // 2. Check static trees & streetlight poles
      if (walkable) {
        for (const c of staticBounds.circles) {
          if (Math.hypot(worldX - c.x, worldZ - c.z) <= c.radius + pad) {
            walkable = false;
            blockReason = 'static-prop';
            obstacleName = c.name;
            break;
          }
        }
      }

      // 3. Check restricted construction lanes (Partial Lane Closure open side)
      if (walkable) {
        for (const rBox of restrictedBoxes) {
          if (
            worldX >= rBox.minX - pad * 0.4 &&
            worldX <= rBox.maxX + pad * 0.4 &&
            worldZ >= rBox.minZ - pad * 0.4 &&
            worldZ <= rBox.maxZ + pad * 0.4
          ) {
            blockReason = 'restricted-lane';
            obstacleName = rBox.name;
            costMultiplier = 2.8 * constructionAvoidanceWeight;
            break;
          }
        }
      }

      // 4. Check blocked construction zones (Full Pathway Blockade, Sensor Hazard, & Barricaded Partial Lane)
      for (const bBox of blockedBoxes) {
        if (
          worldX >= bBox.minX - pad &&
          worldX <= bBox.maxX + pad &&
          worldZ >= bBox.minZ - pad &&
          worldZ <= bBox.maxZ + pad
        ) {
          walkable = false;
          blockReason = bBox.id.includes('barricade')
            ? 'construction-partial'
            : 'construction-full';
          obstacleName = bBox.name;
          break;
        }
      }

      // 5. Temporary dynamic pedestrian occupancy (core blocked + surrounding high-cost avoidance halo)
      // Never permanently mutates static grid; never traps the robot inside its own current start cell
      if (walkable && dynamicPedestrianPositions.length > 0) {
        const isRobotStartCell =
          robotStartCell !== undefined &&
          robotStartCell.gx === gx &&
          robotStartCell.gz === gz;

        for (let pIdx = 0; pIdx < dynamicPedestrianPositions.length; pIdx++) {
          const ped = dynamicPedestrianPositions[pIdx];
          const dist = Math.hypot(worldX - ped.x, worldZ - ped.z);
          if (dist <= 1.25 && !isRobotStartCell) {
            walkable = false;
            blockReason = 'dynamic-pedestrian';
            obstacleName = `Pedestrian #${pIdx + 1}`;
            break;
          } else if (dist <= 2.25) {
            blockReason = 'dynamic-pedestrian';
            obstacleName = `Pedestrian #${pIdx + 1}`;
            const haloFactor = Math.max(0, (2.25 - dist) / 1.0);
            costMultiplier +=
              4.2 * Math.max(1.0, constructionAvoidanceWeight) * haloFactor;
          }
        }
      }

      // 6. Temporary time-dependent predictive trajectory conflict cost penalties
      if (walkable && predictedConflictZones.length > 0) {
        for (const zone of predictedConflictZones) {
          const dist = Math.hypot(worldX - zone.pos.x, worldZ - zone.pos.z);
          if (dist <= zone.radiusM) {
            const factor = Math.max(0.15, 1 - dist / Math.max(0.5, zone.radiusM));
            costMultiplier += zone.costPenalty * factor;
            if (blockReason === 'none') {
              blockReason = 'predicted-conflict';
              obstacleName = `Predicted ${zone.pedestrianName}`;
            }
          }
        }
      }

      row.push({
        gx,
        gz,
        worldX,
        worldZ,
        walkable,
        isRoadOrPath,
        isPrimaryRoad,
        costMultiplier,
        blockReason,
        obstacleName,
      });
    }
    grid.push(row);
  }

  return grid;
}

function runCoreAStar(
  grid: GridNode[][],
  start: Vector2D,
  goal: Vector2D
): Vector2D[] | null {
  const { gx: startGx, gz: startGz } = worldToGridCoords(start.x, start.z);
  const { gx: goalGx, gz: goalGz } = worldToGridCoords(goal.x, goal.z);

  const startNode = grid[startGx]?.[startGz];
  const goalNode = grid[goalGx]?.[goalGz];
  if (!startNode || !goalNode) return null;

  // Verify start and goal cells are walkable
  if (!startNode.walkable || !goalNode.walkable) {
    return null;
  }

  const openSet = new Set<string>();
  const closedSet = new Set<string>();
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>();
  const fScore = new Map<string, number>();

  const key = (gx: number, gz: number) => `${gx},${gz}`;
  const startKey = key(startGx, startGz);
  const goalKey = key(goalGx, goalGz);

  openSet.add(startKey);
  gScore.set(startKey, 0);
  fScore.set(startKey, Math.hypot(goalGx - startGx, goalGz - startGz));

  const dirs: [number, number, number][] = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ];

  while (openSet.size > 0) {
    let currentKey = '';
    let lowestF = Infinity;
    for (const k of openSet) {
      const f = fScore.get(k) ?? Infinity;
      if (f < lowestF) {
        lowestF = f;
        currentKey = k;
      }
    }

    if (!currentKey) break;
    if (currentKey === goalKey) {
      const path: Vector2D[] = [];
      let curr: string | undefined = currentKey;
      while (curr) {
        const [cx, cz] = curr.split(',').map(Number);
        path.unshift({
          x: grid[cx][cz].worldX,
          z: grid[cx][cz].worldZ,
        });
        curr = cameFrom.get(curr);
      }
      if (path.length > 0) {
        path[0] = { x: start.x, z: start.z };
        path[path.length - 1] = { x: goal.x, z: goal.z };
      }
      return path;
    }

    openSet.delete(currentKey);
    closedSet.add(currentKey);

    const [cx, cz] = currentKey.split(',').map(Number);

    for (const [dx, dz, stepDist] of dirs) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nx >= GRID_DIM || nz < 0 || nz >= GRID_DIM) continue;

      const neighbor = grid[nx][nz];
      if (!neighbor.walkable) continue;

      // Prevent diagonal corner-cutting across blocked cells
      if (dx !== 0 && dz !== 0) {
        const adj1 = grid[cx + dx]?.[cz];
        const adj2 = grid[cx]?.[cz + dz];
        if (!adj1?.walkable || !adj2?.walkable) {
          continue;
        }
      }

      const nKey = key(nx, nz);
      if (closedSet.has(nKey)) continue;

      const tentativeG =
        (gScore.get(currentKey) ?? Infinity) + stepDist * neighbor.costMultiplier;

      if (!openSet.has(nKey)) {
        openSet.add(nKey);
      } else if (tentativeG >= (gScore.get(nKey) ?? Infinity)) {
        continue;
      }

      cameFrom.set(nKey, currentKey);
      gScore.set(nKey, tentativeG);
      const heuristic = Math.hypot(goalGx - nx, goalGz - nz);
      fScore.set(nKey, tentativeG + heuristic);
    }
  }

  return null;
}

export function computeAStarPathWithDiagnostics(
  start: Vector2D,
  goal: Vector2D,
  activeConstructionIds: string[],
  constructionAvoidanceWeight = 2.5,
  dynamicPedestrianPositions: Vector2D[] = [],
  predictedConflictZones: PredictedGridPenaltyZone[] = []
): PathfindingDiagnosticsResult {
  // 1. Compute baseline path without construction or pedestrian obstacles to detect detours
  const baselineGrid = buildNavigationGrid([], 1.0, []);
  const baselinePath = runCoreAStar(baselineGrid, start, goal);

  const startCellCoords = worldToGridCoords(start.x, start.z);

  // 2. Build actual obstacle-aware navigation grid (transient pedestrian occupancy does not mutate static grid)
  const activeGrid = buildNavigationGrid(
    activeConstructionIds,
    constructionAvoidanceWeight,
    dynamicPedestrianPositions,
    startCellCoords,
    predictedConflictZones
  );

  // Check if start or goal cell itself is blocked
  const { gx: sGx, gz: sGz } = startCellCoords;
  const { gx: gGx, gz: gGz } = worldToGridCoords(goal.x, goal.z);
  const startCell = activeGrid[sGx]?.[sGz];
  const goalCell = activeGrid[gGx]?.[gGz];

  if (startCell && !startCell.walkable) {
    return {
      path: [],
      reachable: false,
      detourActive: false,
      blockedZonesOnDirectPath: startCell.obstacleName
        ? [startCell.obstacleName]
        : [],
      failureReason: `Origin coordinates (${start.x}, ${start.z}) are blocked by ${
        startCell.obstacleName || startCell.blockReason
      }.`,
    };
  }

  if (goalCell && !goalCell.walkable) {
    return {
      path: [],
      reachable: false,
      detourActive: false,
      blockedZonesOnDirectPath: goalCell.obstacleName ? [goalCell.obstacleName] : [],
      failureReason: `Destination coordinates (${goal.x}, ${goal.z}) are blocked by ${
        goalCell.obstacleName || goalCell.blockReason
      }.`,
    };
  }

  // Check which obstacles intersect the baseline route
  const blockedZonesSet = new Set<string>();
  if (baselinePath) {
    for (const pt of baselinePath) {
      const { gx, gz } = worldToGridCoords(pt.x, pt.z);
      const cell = activeGrid[gx]?.[gz];
      if (
        cell &&
        (!cell.walkable ||
          cell.blockReason === 'restricted-lane' ||
          cell.blockReason === 'dynamic-pedestrian' ||
          cell.blockReason === 'predicted-conflict') &&
        cell.obstacleName
      ) {
        blockedZonesSet.add(cell.obstacleName);
      }
    }
  }

  const activePath = runCoreAStar(activeGrid, start, goal);

  if (!activePath || activePath.length === 0) {
    const activeNames = CONSTRUCTION_ZONES.filter((cz) =>
      activeConstructionIds.includes(cz.id)
    ).map((cz) => cz.name);
    const blockerList =
      blockedZonesSet.size > 0
        ? Array.from(blockedZonesSet).join(', ')
        : activeNames.length > 0
        ? activeNames.join(', ')
        : dynamicPedestrianPositions.length > 0
        ? 'dynamic pedestrian congestion'
        : 'active pathway barriers';

    return {
      path: [],
      reachable: false,
      detourActive: false,
      blockedZonesOnDirectPath: Array.from(blockedZonesSet),
      failureReason: `No valid path available: All routes to destination are blocked by ${blockerList}.`,
    };
  }

  return {
    path: activePath,
    reachable: true,
    detourActive: blockedZonesSet.size > 0,
    blockedZonesOnDirectPath: Array.from(blockedZonesSet),
    failureReason: null,
  };
}

export function computeAStarPath(
  start: Vector2D,
  goal: Vector2D,
  activeConstructionIds: string[],
  constructionAvoidanceWeight = 2.5,
  dynamicPedestrianPositions: Vector2D[] = [],
  predictedConflictZones: PredictedGridPenaltyZone[] = []
): Vector2D[] {
  return computeAStarPathWithDiagnostics(
    start,
    goal,
    activeConstructionIds,
    constructionAvoidanceWeight,
    dynamicPedestrianPositions,
    predictedConflictZones
  ).path;
}

/**
 * Checks if a coordinate (x, z) lies inside the valid indoor corridor, lobby, open doorway,
 * or upper-floor delivery corridor of an active elevator building.
 * Also returns the 3 solid walls of the enclosed elevator shaft (plus the doorway if closed)
 * so the robot can NEVER enter the elevator through shaft walls or from the sides.
 */
export function getIndoorBuildingCollisionContext(
  px: number,
  pz: number,
  activeElevatorConfig?: CampusElevatorConfig | null,
  doorOpen = true
): {
  authorizedBuildingIds: Set<string>;
  shaftWallBoxes: CollisionAABB[];
} {
  const authorizedBuildingIds = new Set<string>();
  const shaftWallBoxes: CollisionAABB[] = [];

  const envElevators =
    !isCampusEnvironmentActive() && activeRuntimeEnvironment
      ? activeRuntimeEnvironment.elevators
      : CAMPUS_ELEVATORS;

  const elevatorsToCheck =
    envElevators.length > 0
      ? envElevators
      : activeElevatorConfig
      ? [activeElevatorConfig]
      : [];

  for (const elev of elevatorsToCheck) {
    const cx = elev.cabinPos.x;
    const cz = elev.cabinPos.z;
    // Enclosed shaft is around cabinPos, with 3 solid walls (West, East, North)
    // and 1 single doorway on the South side facing the lobby
    const shaftHalf = 1.65;
    const wallThick = 0.2;

    // Enforce the 3 solid walls of the enclosed shaft when near this elevator
    if (Math.hypot(px - cx, pz - cz) <= 4.5) {
      shaftWallBoxes.push(
        {
          id: `${elev.id}-shaft-north`,
          name: `${elev.name} Shaft Rear Wall`,
          type: 'Campus Building',
          minX: cx - shaftHalf,
          maxX: cx + shaftHalf,
          minZ: cz - shaftHalf - wallThick,
          maxZ: cz - shaftHalf + wallThick,
        },
        {
          id: `${elev.id}-shaft-west`,
          name: `${elev.name} Shaft West Wall`,
          type: 'Campus Building',
          minX: cx - shaftHalf - wallThick,
          maxX: cx - shaftHalf + wallThick,
          minZ: cz - shaftHalf,
          maxZ: cz + shaftHalf,
        },
        {
          id: `${elev.id}-shaft-east`,
          name: `${elev.name} Shaft East Wall`,
          type: 'Campus Building',
          minX: cx + shaftHalf - wallThick,
          maxX: cx + shaftHalf + wallThick,
          minZ: cz - shaftHalf,
          maxZ: cz + shaftHalf,
        }
      );

      const isThisDoorOpen =
        activeElevatorConfig && activeElevatorConfig.id === elev.id
          ? doorOpen
          : false;

      if (!isThisDoorOpen) {
        shaftWallBoxes.push({
          id: `${elev.id}-doorway-closed`,
          name: `${elev.name} Closed Elevator Doors`,
          type: 'Campus Building',
          minX: cx - shaftHalf,
          maxX: cx + shaftHalf,
          minZ: cz + shaftHalf - wallThick,
          maxZ: cz + shaftHalf + wallThick,
        });
      }
    }

    const inGroundCorridorOrCabin =
      Math.abs(px - cx) <= 9.5 &&
      pz >= cz - 2.4 &&
      pz <= elev.outdoorApproachPos.z + 1.8;

    const dest = elev.destinationRoomPos;
    const minUpperX = Math.min(cx - 8.5, dest.x) - 2.2;
    const maxUpperX = Math.max(cx + 8.5, dest.x) + 2.2;
    const minUpperZ = Math.min(cz, elev.lobbyPos.z, dest.z) - 2.4;
    const maxUpperZ = Math.max(cz, elev.lobbyPos.z, dest.z) + 2.4;
    const inUpperCorridorOrRoom =
      px >= minUpperX && px <= maxUpperX && pz >= minUpperZ && pz <= maxUpperZ;

    if (inGroundCorridorOrCabin || inUpperCorridorOrRoom) {
      authorizedBuildingIds.add(elev.buildingId);
    }
  }

  return {
    authorizedBuildingIds,
    shaftWallBoxes,
  };
}

export function checkSweptRobotCollision(
  from: Vector2D,
  to: Vector2D,
  robotRadius: number,
  activeConstructionIds: string[] = [],
  dynamicPedestrians: CollisionCircle[] = [],
  activeElevatorConfig?: CampusElevatorConfig | null,
  elevatorDoorOpen = true
): CollisionHitResult | null {
  const safeConstructionIds = Array.isArray(activeConstructionIds)
    ? activeConstructionIds
    : [];
  const { blockedBoxes } = getActiveConstructionObstacleBounds(safeConstructionIds);
  const staticBounds = getAllStaticObstacleBounds();
  const allCircles = [
    ...(Array.isArray(dynamicPedestrians) ? dynamicPedestrians : []),
    ...staticBounds.circles,
  ];

  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(1, Math.ceil(dist / 0.08));

  let prevSafe: Vector2D = { x: from.x, z: from.z, y: from.y, floor: from.floor };

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const px = from.x + (to.x - from.x) * t;
    const pz = from.z + (to.z - from.z) * t;

    const indoorCtx = getIndoorBuildingCollisionContext(
      px,
      pz,
      activeElevatorConfig,
      elevatorDoorOpen
    );

    const activeBoxes: CollisionAABB[] = [
      ...blockedBoxes,
      ...staticBounds.boxes.filter(
        (b) => !indoorCtx.authorizedBuildingIds.has(b.id)
      ),
      ...indoorCtx.shaftWallBoxes,
    ];

    for (const box of activeBoxes) {
      const closestX = Math.max(box.minX, Math.min(px, box.maxX));
      const closestZ = Math.max(box.minZ, Math.min(pz, box.maxZ));
      const d = Math.hypot(px - closestX, pz - closestZ);

      if (d < robotRadius) {
        return {
          collided: true,
          obstacleName: box.name,
          obstacleType: box.type,
          contactPoint: { x: closestX, z: closestZ },
          safePosition: prevSafe,
        };
      }
    }

    // Only check ground-floor outdoor dynamic pedestrians when robot is on ground floor (floor 0 or undefined)
    const isUpperFloor = (from.floor ?? 0) > 0 || (to.floor ?? 0) > 0 || (from.y ?? 0) > 1.0;
    if (!isUpperFloor) {
      for (const c of allCircles) {
        const d = Math.hypot(px - c.x, pz - c.z);
        if (d < robotRadius + c.radius) {
          const angle = Math.atan2(pz - c.z, px - c.x);
          return {
            collided: true,
            obstacleName: c.name,
            obstacleType: c.type,
            contactPoint: {
              x: c.x + Math.cos(angle) * c.radius,
              z: c.z + Math.sin(angle) * c.radius,
            },
            safePosition: prevSafe,
          };
        }
      }
    }

    prevSafe = { x: px, z: pz, y: to.y ?? from.y, floor: to.floor ?? from.floor };
  }

  return null;
}

export function calculatePathDistance(waypoints: Vector2D[]): number {
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const dx = waypoints[i].x - waypoints[i - 1].x;
    const dz = waypoints[i].z - waypoints[i - 1].z;
    const dy = (waypoints[i].y ?? 0) - (waypoints[i - 1].y ?? 0);
    total += Math.hypot(dx, dz, dy);
  }
  return total;
}

/**
 * Builds the indoor multi-floor waypoint sequence for an elevator-equipped building
 * supporting Ground (0), First (1), and Second (2) floors in both directions (up/down)
 * as well as same-floor indoor corridor routing without entering the elevator shaft.
 */
export function buildIndoorElevatorRouteWaypoints(
  elevCfg: CampusElevatorConfig,
  phase:
    | 'enter-to-lobby'
    | 'board-cabin'
    | 'exit-to-destination'
    | 'same-floor-indoor',
  floorNum?: number,
  customTargetPos?: Vector2D,
  customStartPos?: Vector2D
): Vector2D[] {
  const fh = elevCfg.floorHeightM;

  if (phase === 'same-floor-indoor') {
    const fl = floorNum ?? 0;
    const fy = Number((fl * fh).toFixed(2));
    const startPt = customStartPos ?? { ...elevCfg.lobbyPos, y: fy, floor: fl };
    const endPt = customTargetPos ?? { ...elevCfg.destinationRoomPos, y: fy, floor: fl };
    return [
      { x: startPt.x, z: startPt.z, y: fy, floor: fl },
      { x: startPt.x, z: elevCfg.lobbyPos.z, y: fy, floor: fl },
      { x: elevCfg.lobbyPos.x, z: elevCfg.lobbyPos.z, y: fy, floor: fl },
      { x: endPt.x, z: elevCfg.lobbyPos.z, y: fy, floor: fl },
      { x: endPt.x, z: endPt.z, y: fy, floor: fl },
    ];
  }

  if (phase === 'enter-to-lobby') {
    const fl = floorNum ?? 0;
    const fy = Number((fl * fh).toFixed(2));
    if (fl > 0) {
      // Starting on an upper floor (1F or 2F) inside the building -> navigate along corridor to lobby
      const startPt = customStartPos ?? {
        ...(fl === 1 && elevCfg.firstFloorRoomPos
          ? elevCfg.firstFloorRoomPos
          : elevCfg.destinationRoomPos),
        y: fy,
        floor: fl,
      };
      return [
        { x: startPt.x, z: startPt.z, y: fy, floor: fl },
        { x: startPt.x, z: elevCfg.lobbyPos.z, y: fy, floor: fl },
        { x: elevCfg.lobbyPos.x, z: elevCfg.lobbyPos.z, y: fy, floor: fl },
      ];
    }
    return [
      { ...elevCfg.outdoorApproachPos, y: 0, floor: 0 },
      { ...elevCfg.entrancePos, y: 0, floor: 0 },
      ...elevCfg.groundCorridorWaypoints.map((p) => ({ ...p, y: 0, floor: 0 })),
      { ...elevCfg.lobbyPos, y: 0, floor: 0 },
    ];
  }

  if (phase === 'board-cabin') {
    const fl = floorNum ?? 0;
    const fy = Number((fl * fh).toFixed(2));
    return [
      { ...elevCfg.lobbyPos, y: fy, floor: fl },
      { ...elevCfg.doorwayPos, y: fy, floor: fl },
      { ...elevCfg.cabinPos, y: fy, floor: fl },
    ];
  }

  // phase === 'exit-to-destination'
  const destFloor = floorNum ?? elevCfg.destinationFloor;
  const destY = Number((destFloor * fh).toFixed(2));

  if (destFloor === 0) {
    // Exiting cabin at Ground Floor (0) -> doorway -> lobby -> corridor -> building entrance -> outdoor approach (or indoor ground room)
    if (
      customTargetPos &&
      Math.hypot(
        customTargetPos.x - elevCfg.lobbyPos.x,
        customTargetPos.z - elevCfg.lobbyPos.z
      ) <= 6.5 &&
      customTargetPos.z < elevCfg.entrancePos.z
    ) {
      return [
        { ...elevCfg.cabinPos, y: 0, floor: 0 },
        { ...elevCfg.doorwayPos, y: 0, floor: 0 },
        { ...elevCfg.lobbyPos, y: 0, floor: 0 },
        { x: customTargetPos.x, z: elevCfg.lobbyPos.z, y: 0, floor: 0 },
        { x: customTargetPos.x, z: customTargetPos.z, y: 0, floor: 0 },
      ];
    }
    const revGround = [...elevCfg.groundCorridorWaypoints]
      .reverse()
      .map((p) => ({ ...p, y: 0, floor: 0 }));
    return [
      { ...elevCfg.cabinPos, y: 0, floor: 0 },
      { ...elevCfg.doorwayPos, y: 0, floor: 0 },
      { ...elevCfg.lobbyPos, y: 0, floor: 0 },
      ...revGround,
      { ...elevCfg.entrancePos, y: 0, floor: 0 },
      { ...elevCfg.outdoorApproachPos, y: 0, floor: 0 },
    ];
  }

  const corridorWps =
    destFloor === 1 && elevCfg.firstFloorCorridorWaypoints
      ? elevCfg.firstFloorCorridorWaypoints
      : elevCfg.upperCorridorWaypoints;

  const defaultRoomPos =
    destFloor === 1 && elevCfg.firstFloorRoomPos
      ? elevCfg.firstFloorRoomPos
      : elevCfg.destinationRoomPos;

  const targetRoom = customTargetPos ?? defaultRoomPos;

  // If targetRoom is on the West side of the lobby (e.g. x < lobbyPos.x), route directly along the corridor
  if (targetRoom.x < elevCfg.lobbyPos.x - 0.5) {
    return [
      { ...elevCfg.cabinPos, y: destY, floor: destFloor },
      { ...elevCfg.doorwayPos, y: destY, floor: destFloor },
      { ...elevCfg.lobbyPos, y: destY, floor: destFloor },
      { x: targetRoom.x, z: elevCfg.lobbyPos.z, y: destY, floor: destFloor },
      { x: targetRoom.x, z: targetRoom.z, y: destY, floor: destFloor },
    ];
  }

  return [
    { ...elevCfg.cabinPos, y: destY, floor: destFloor },
    ...corridorWps.map((p) => ({
      ...p,
      y: destY,
      floor: destFloor,
    })),
    { x: targetRoom.x, z: targetRoom.z, y: destY, floor: destFloor },
  ];
}

/**
 * Deterministic PRNG (Mulberry32) for reproducible random walker & crossing experiments.
 */
export function createDeterministicPrng(seed: number): () => number {
  let state = (seed >>> 0) || 1337;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PedestrianSimAgent {
  id: string;
  name: string;
  behaviorClass: PedestrianBehaviorClass;
  basePos: Vector2D;
  currentPos: Vector2D;
  velocity: Vector2D;
  headingRad: number;
  phase: number;
  walkTime: number;
  axis: 'x' | 'z';
  amplitude: number;
  speedFactor: number;
  cruiseSpeedMps: number;
  lateralOffset: number;
  radius: number;
  isStationary: boolean;
  isPerceived: boolean;
  // Advanced behaviour & prediction fields
  routeWaypoints?: Vector2D[];
  routeIndex?: number;
  routeDirection?: 1 | -1;
  currentGraphNodeId?: string;
  targetGraphNodeId?: string;
  pauseTimerSec?: number;
  seedState?: number;
  crossingWaitTimerSec?: number;
  crossingHalfSpan?: number;
  groupId?: string;
  groupLeaderId?: string;
  groupOffset?: Vector2D;
  splitTimerSec?: number;
  history: Vector2D[];
  observationsCount: number;
  learnedRoutePattern: boolean;
  predictedTrajectory: Vector2D[];
  predictionUncertaintyM: number;
}

interface WalkwayGraphNode {
  id: string;
  pos: Vector2D;
  neighbors: string[];
}

export const WALKWAY_GRAPH_NODES: WalkwayGraphNode[] = [
  { id: 'nw-loop', pos: { x: -15, z: -15 }, neighbors: ['n-center', 'w-center', 'eng-dock'] },
  { id: 'eng-dock', pos: { x: -15, z: -20 }, neighbors: ['nw-loop'] },
  { id: 'n-center', pos: { x: 0, z: -15 }, neighbors: ['nw-loop', 'ne-loop', 'union-hub', 'center-plaza'] },
  { id: 'union-hub', pos: { x: 0, z: -20 }, neighbors: ['n-center'] },
  { id: 'ne-loop', pos: { x: 15, z: -15 }, neighbors: ['n-center', 'e-center', 'lib-dock'] },
  { id: 'lib-dock', pos: { x: 15, z: -20 }, neighbors: ['ne-loop'] },
  { id: 'w-center', pos: { x: -15, z: 0 }, neighbors: ['nw-loop', 'sw-loop', 'center-plaza'] },
  { id: 'center-plaza', pos: { x: 0, z: 0 }, neighbors: ['n-center', 's-center', 'w-center', 'e-center'] },
  { id: 'e-center', pos: { x: 15, z: 0 }, neighbors: ['ne-loop', 'se-loop', 'center-plaza'] },
  { id: 'sw-loop', pos: { x: -15, z: 15 }, neighbors: ['w-center', 's-center', 'sci-dock'] },
  { id: 'sci-dock', pos: { x: -15, z: 20 }, neighbors: ['sw-loop'] },
  { id: 's-center', pos: { x: 0, z: 15 }, neighbors: ['center-plaza', 'sw-loop', 'se-loop', 'hostel-b'] },
  { id: 'hostel-b', pos: { x: 6, z: 21 }, neighbors: ['s-center'] },
  { id: 'se-loop', pos: { x: 15, z: 15 }, neighbors: ['s-center', 'e-center', 'hostel-a'] },
  { id: 'hostel-a', pos: { x: 15, z: 18 }, neighbors: ['se-loop'] },
];

export const COMMUTER_RECURRING_ROUTES: { name: string; waypoints: Vector2D[]; speedMps: number }[] = [
  {
    name: 'Eng-Union-Library Commute',
    waypoints: [
      { x: -15, z: -15 },
      { x: 0, z: -15 },
      { x: 15, z: -15 },
      { x: 15, z: 0 },
    ],
    speedMps: 1.32,
  },
  {
    name: 'Central North-South Academic Spine',
    waypoints: [
      { x: -1.4, z: -15 },
      { x: -1.4, z: 0 },
      { x: -1.4, z: 15 },
    ],
    speedMps: 1.25,
  },
  {
    name: 'Science-Plaza-Hostel A Commute',
    waypoints: [
      { x: -15, z: 15 },
      { x: 0, z: 15 },
      { x: 15, z: 15 },
      { x: 15, z: 0 },
    ],
    speedMps: 1.28,
  },
  {
    name: 'West-East Main Avenue Express',
    waypoints: [
      { x: -15, z: -1.4 },
      { x: 0, z: -1.4 },
      { x: 15, z: -1.4 },
    ],
    speedMps: 1.35,
  },
];

export const DESIGNATED_CROSSING_AREAS: {
  name: string;
  center: Vector2D;
  axis: 'x' | 'z';
  halfSpan: number;
  speedMps: number;
}[] = [
  { name: 'North Plaza Crosswalk', center: { x: 0, z: -11 }, axis: 'x', halfSpan: 2.5, speedMps: 1.22 },
  { name: 'West Avenue Crosswalk', center: { x: -6, z: 0 }, axis: 'z', halfSpan: 2.4, speedMps: 1.18 },
  { name: 'East Avenue Crosswalk', center: { x: 11, z: 15 }, axis: 'z', halfSpan: 2.0, speedMps: 1.25 },
  { name: 'Central Intersection Crosswalk', center: { x: 2, z: 4 }, axis: 'x', halfSpan: 2.3, speedMps: 1.15 },
];

export const DEFAULT_PEDESTRIAN_SPOTS: [number, number, 'x' | 'z', number, number][] = [
  // [baseX, baseZ, patrolAxis, amplitudeM, speedFactor]
  [0, -11, 'x', 2.4, 1.15],
  [-1.2, -2, 'z', 2.4, 1.05],
  [-6, 0, 'z', 2.2, 1.1],
  [0, -15, 'x', 2.4, 1.0],
  [15, -4, 'x', 1.8, 1.1],
  [-15, 10, 'x', 1.8, 1.05],
  [11, 15, 'z', 1.8, 1.15],
  [-4, 15, 'z', 1.8, 1.05],
  [15, 8, 'x', 1.8, 1.1],
  [2, 4, 'x', 2.2, 1.0],
];

/**
 * Checks if a candidate pedestrian coordinate is on a valid campus walkway and free of buildings or active construction barriers.
 */
export function isPedestrianPositionValid(
  x: number,
  z: number,
  activeConstructionIds: string[] = [],
  radius = 0.42
): boolean {
  const { isRoadOrPath } = classifyCampusSurface(x, z);
  if (!isRoadOrPath) return false;

  const staticBounds = getAllStaticObstacleBounds();
  for (const box of staticBounds.boxes) {
    if (
      x >= box.minX - radius &&
      x <= box.maxX + radius &&
      z >= box.minZ - radius &&
      z <= box.maxZ + radius
    ) {
      return false;
    }
  }

  const { blockedBoxes } = getActiveConstructionObstacleBounds(activeConstructionIds);
  for (const bBox of blockedBoxes) {
    if (
      x >= bBox.minX - radius &&
      x <= bBox.maxX + radius &&
      z >= bBox.minZ - radius &&
      z <= bBox.maxZ + radius
    ) {
      return false;
    }
  }

  return true;
}

export function derivePedestrianDistribution(
  totalCount: number,
  customDist?: PedestrianDistributionConfig
): Required<PedestrianDistributionConfig> {
  if (customDist) {
    const sum =
      customDist.commuterCount +
      customDist.randomCount +
      customDist.crossingCount +
      customDist.groupCount;
    if (sum > 0) {
      return {
        commuterCount: customDist.commuterCount,
        randomCount: customDist.randomCount,
        crossingCount: customDist.crossingCount,
        groupCount: customDist.groupCount,
        randomSeed: customDist.randomSeed ?? 101,
      };
    }
  }

  const c = Math.max(0, Math.round(totalCount));
  const commuterCount = Math.ceil(c * 0.3);
  const crossingCount = Math.max(0, Math.floor(c * 0.25));
  const randomCount = Math.max(0, Math.floor(c * 0.25));
  const groupCount = Math.max(0, c - commuterCount - crossingCount - randomCount);

  return {
    commuterCount,
    randomCount,
    crossingCount,
    groupCount,
    randomSeed: 101 + c * 17,
  };
}

export function createScenarioPedestrianAgents(
  count: number,
  distribution?: PedestrianDistributionConfig,
  activeConstructionIds: string[] = []
): PedestrianSimAgent[] {
  const agents: PedestrianSimAgent[] = [];
  const pedRadius = 0.42;
  const dist = derivePedestrianDistribution(count, distribution);
  const prng = createDeterministicPrng(dist.randomSeed);

  let agentSeq = 1;

  // 1. PREDICTABLE COMMUTERS
  for (let i = 0; i < dist.commuterCount; i++) {
    const template = COMMUTER_RECURRING_ROUTES[i % COMMUTER_RECURRING_ROUTES.length];
    const wps = template.waypoints.map((p) => ({ x: p.x, z: p.z }));
    const startWpIdx = i % Math.max(1, wps.length - 1);
    const startPos = { ...wps[startWpIdx] };
    if (!isPedestrianPositionValid(startPos.x, startPos.z, activeConstructionIds)) {
      startPos.x = 0;
      startPos.z = -15;
    }
    const nextWp = wps[(startWpIdx + 1) % wps.length];

    agents.push({
      id: `ped-${agentSeq}`,
      name: `Commuter #${i + 1}`,
      behaviorClass: 'commuter',
      basePos: { ...startPos },
      currentPos: { ...startPos },
      velocity: { x: 0, z: 0 },
      headingRad: Math.atan2(nextWp.x - startPos.x, nextWp.z - startPos.z),
      phase: i * 0.9,
      walkTime: 0,
      axis: Math.abs(nextWp.x - startPos.x) >= Math.abs(nextWp.z - startPos.z) ? 'x' : 'z',
      amplitude: 2.4,
      speedFactor: 1.1,
      cruiseSpeedMps: template.speedMps,
      lateralOffset: 0,
      radius: pedRadius,
      isStationary: false,
      isPerceived: false,
      routeWaypoints: wps,
      routeIndex: (startWpIdx + 1) % wps.length,
      routeDirection: 1,
      history: [{ ...startPos }],
      observationsCount: 0,
      learnedRoutePattern: false,
      predictedTrajectory: [],
      predictionUncertaintyM: 0.25,
    });
    agentSeq += 1;
  }

  // 2. CROSSING PEDESTRIANS
  for (let i = 0; i < dist.crossingCount; i++) {
    const xw = DESIGNATED_CROSSING_AREAS[i % DESIGNATED_CROSSING_AREAS.length];
    const phase = i * 1.35 + prng() * 0.8;
    const initOffset = Math.sin(phase) * xw.halfSpan;
    const startX = xw.axis === 'x' ? xw.center.x + initOffset : xw.center.x;
    const startZ = xw.axis === 'z' ? xw.center.z + initOffset : xw.center.z;

    agents.push({
      id: `ped-${agentSeq}`,
      name: `Crossing Walker #${i + 1}`,
      behaviorClass: 'crossing',
      basePos: { ...xw.center },
      currentPos: { x: startX, z: startZ },
      velocity: { x: 0, z: 0 },
      headingRad: xw.axis === 'x' ? Math.PI / 2 : 0,
      phase,
      walkTime: 0,
      axis: xw.axis,
      amplitude: xw.halfSpan,
      speedFactor: 1.0 + (prng() - 0.5) * 0.3,
      cruiseSpeedMps: xw.speedMps,
      lateralOffset: 0,
      radius: pedRadius,
      isStationary: false,
      isPerceived: false,
      crossingWaitTimerSec: 0,
      crossingHalfSpan: xw.halfSpan,
      seedState: Math.floor(prng() * 100000) + 17,
      history: [{ x: startX, z: startZ }],
      observationsCount: 0,
      learnedRoutePattern: false,
      predictedTrajectory: [],
      predictionUncertaintyM: 0.35,
    });
    agentSeq += 1;
  }

  // 3. RANDOM WALKERS (Seeded PRNG on Valid Campus Walkways)
  for (let i = 0; i < dist.randomCount; i++) {
    const startNodeIdx = Math.floor(prng() * WALKWAY_GRAPH_NODES.length);
    const startNode = WALKWAY_GRAPH_NODES[startNodeIdx];
    const nextNodeId =
      startNode.neighbors[Math.floor(prng() * startNode.neighbors.length)];
    const nextNode =
      WALKWAY_GRAPH_NODES.find((n) => n.id === nextNodeId) ?? WALKWAY_GRAPH_NODES[0];

    const startPos = {
      x: startNode.pos.x + (prng() - 0.5) * 0.8,
      z: startNode.pos.z + (prng() - 0.5) * 0.8,
    };

    agents.push({
      id: `ped-${agentSeq}`,
      name: `Random Walker #${i + 1}`,
      behaviorClass: 'random',
      basePos: { ...startPos },
      currentPos: { ...startPos },
      velocity: { x: 0, z: 0 },
      headingRad: Math.atan2(
        nextNode.pos.x - startPos.x,
        nextNode.pos.z - startPos.z
      ),
      phase: i * 1.1,
      walkTime: 0,
      axis: 'x',
      amplitude: 2.0,
      speedFactor: 0.95 + prng() * 0.3,
      cruiseSpeedMps: 1.15 + prng() * 0.25,
      lateralOffset: 0,
      radius: pedRadius,
      isStationary: false,
      isPerceived: false,
      currentGraphNodeId: startNode.id,
      targetGraphNodeId: nextNode.id,
      pauseTimerSec: 0,
      seedState: Math.floor(prng() * 1000000) + 1009 * (i + 1),
      history: [{ ...startPos }],
      observationsCount: 0,
      learnedRoutePattern: false,
      predictedTrajectory: [],
      predictionUncertaintyM: 0.55,
    });
    agentSeq += 1;
  }

  // 4. GROUP PEDESTRIANS (Walking together with social spacing & occasional split/regroup)
  let remainingGroupCount = dist.groupCount;
  let groupNumber = 1;
  while (remainingGroupCount > 0) {
    const groupSize = Math.min(remainingGroupCount, remainingGroupCount >= 3 ? 3 : 2);
    const groupId = `grp-${groupNumber}`;
    const routeTemplate =
      COMMUTER_RECURRING_ROUTES[(groupNumber + 1) % COMMUTER_RECURRING_ROUTES.length];
    const wps = routeTemplate.waypoints.map((p) => ({ x: p.x, z: p.z }));
    const baseStart = wps[0];
    const leaderId = `ped-${agentSeq}`;

    for (let m = 0; m < groupSize; m++) {
      const isLeader = m === 0;
      const offset: Vector2D =
        m === 0
          ? { x: 0, z: 0 }
          : m === 1
          ? { x: 0.95, z: -0.65 }
          : { x: -0.95, z: -0.65 };
      const initPos = {
        x: baseStart.x + offset.x,
        z: baseStart.z + offset.z,
      };

      agents.push({
        id: `ped-${agentSeq}`,
        name: `Group ${groupNumber} Member #${m + 1}`,
        behaviorClass: 'group',
        basePos: { ...initPos },
        currentPos: { ...initPos },
        velocity: { x: 0, z: 0 },
        headingRad: 0,
        phase: (agentSeq - 1) * 0.7,
        walkTime: 0,
        axis: 'x',
        amplitude: 2.0,
        speedFactor: 1.0,
        cruiseSpeedMps: 1.12,
        lateralOffset: 0,
        radius: pedRadius,
        isStationary: false,
        isPerceived: false,
        routeWaypoints: wps,
        routeIndex: 1,
        routeDirection: 1,
        groupId,
        groupLeaderId: isLeader ? undefined : leaderId,
        groupOffset: offset,
        splitTimerSec: 0,
        history: [{ ...initPos }],
        observationsCount: 0,
        learnedRoutePattern: false,
        predictedTrajectory: [],
        predictionUncertaintyM: 0.35,
      });
      agentSeq += 1;
    }

    remainingGroupCount -= groupSize;
    groupNumber += 1;
  }

  return agents;
}

/**
 * Advances all 4 pedestrian behaviour classes along valid campus walkways while
 * enforcing building/construction boundaries and social spacing.
 */
export function stepDynamicPedestrians(
  agents: PedestrianSimAgent[],
  robotPos: Vector2D,
  subDt: number,
  activeConstructionIds: string[] = []
): void {
  for (const obs of agents) {
    if (obs.isStationary || obs.amplitude <= 0.001) {
      obs.velocity.x = 0;
      obs.velocity.z = 0;
      continue;
    }

    const prevX = obs.currentPos.x;
    const prevZ = obs.currentPos.z;
    obs.walkTime += subDt * obs.speedFactor;

    const dxToRobot = obs.currentPos.x - robotPos.x;
    const dzToRobot = obs.currentPos.z - robotPos.z;
    const distToRobot = Math.hypot(dxToRobot, dzToRobot);

    let candidateX = obs.currentPos.x;
    let candidateZ = obs.currentPos.z;

    if (obs.behaviorClass === 'commuter' && obs.routeWaypoints && obs.routeWaypoints.length > 1) {
      // 1. PREDICTABLE COMMUTER: Follows recurring multi-waypoint route at consistent speed
      const wps = obs.routeWaypoints;
      let rIdx = obs.routeIndex ?? 1;
      let dir = obs.routeDirection ?? 1;
      const targetWp = wps[rIdx];
      const vx = targetWp.x - obs.currentPos.x;
      const vz = targetWp.z - obs.currentPos.z;
      const dist = Math.hypot(vx, vz);
      const speed = (obs.cruiseSpeedMps || 1.25) * obs.speedFactor;

      if (dist <= Math.max(0.25, speed * subDt * 1.2)) {
        if (rIdx + dir >= wps.length || rIdx + dir < 0) {
          dir = (dir === 1 ? -1 : 1) as 1 | -1;
          obs.routeDirection = dir;
        }
        rIdx = Math.max(0, Math.min(wps.length - 1, rIdx + dir));
        obs.routeIndex = rIdx;
      } else {
        // Cooperative slight lateral offset when passing within 2.4m of robot
        let latX = 0;
        let latZ = 0;
        if (distToRobot < 2.4) {
          const perpX = -vz / dist;
          const perpZ = vx / dist;
          const sideSign = dxToRobot * perpX + dzToRobot * perpZ >= 0 ? 1 : -1;
          latX = perpX * sideSign * 0.45;
          latZ = perpZ * sideSign * 0.45;
        }
        candidateX += ((vx / dist) * speed + latX) * subDt;
        candidateZ += ((vz / dist) * speed + latZ) * subDt;
      }
    } else if (obs.behaviorClass === 'random' && obs.targetGraphNodeId) {
      // 2. RANDOM WALKER: Seeded graph walkway navigation with occasional pauses & turns
      if (obs.pauseTimerSec && obs.pauseTimerSec > 0) {
        obs.pauseTimerSec = Math.max(0, obs.pauseTimerSec - subDt);
      } else {
        const targetNode =
          WALKWAY_GRAPH_NODES.find((n) => n.id === obs.targetGraphNodeId) ??
          WALKWAY_GRAPH_NODES[0];
        const vx = targetNode.pos.x - obs.currentPos.x;
        const vz = targetNode.pos.z - obs.currentPos.z;
        const dist = Math.hypot(vx, vz);
        const speed = (obs.cruiseSpeedMps || 1.2) * obs.speedFactor;

        const nextRand = () => {
          const prng = createDeterministicPrng(obs.seedState ?? 1337);
          const val = prng();
          obs.seedState = ((obs.seedState ?? 1337) + 0x6d2b79f5) | 0;
          return val;
        };

        if (dist <= 0.45) {
          obs.currentGraphNodeId = targetNode.id;
          const validNeighbors = targetNode.neighbors.filter((nid) => {
            const nObj = WALKWAY_GRAPH_NODES.find((n) => n.id === nid);
            return (
              nObj &&
              isPedestrianPositionValid(nObj.pos.x, nObj.pos.z, activeConstructionIds)
            );
          });
          const pool = validNeighbors.length > 0 ? validNeighbors : targetNode.neighbors;
          const chosenId = pool[Math.floor(nextRand() * pool.length)];
          obs.targetGraphNodeId = chosenId;
          // Occasionally pause briefly at walkway intersections
          if (nextRand() < 0.25) {
            obs.pauseTimerSec = 0.35 + nextRand() * 0.45;
          }
        } else {
          // Cooperative lateral step near robot
          let latX = 0;
          let latZ = 0;
          if (distToRobot < 2.5) {
            const perpX = -vz / dist;
            const perpZ = vx / dist;
            const sideSign = dxToRobot * perpX + dzToRobot * perpZ >= 0 ? 1 : -1;
            latX = perpX * sideSign * 0.55;
            latZ = perpZ * sideSign * 0.55;
          }
          candidateX += ((vx / dist) * speed + latX) * subDt;
          candidateZ += ((vz / dist) * speed + latZ) * subDt;
        }
      }
    } else if (
      obs.behaviorClass === 'group' &&
      obs.routeWaypoints &&
      obs.routeWaypoints.length > 1
    ) {
      // 4. GROUP PEDESTRIANS: Leader follows route; members maintain social spacing, split around hazards, and regroup
      if (!obs.groupLeaderId) {
        // Group leader
        const wps = obs.routeWaypoints;
        let rIdx = obs.routeIndex ?? 1;
        let dir = obs.routeDirection ?? 1;
        const targetWp = wps[rIdx];
        const vx = targetWp.x - obs.currentPos.x;
        const vz = targetWp.z - obs.currentPos.z;
        const dist = Math.hypot(vx, vz);
        const speed = (obs.cruiseSpeedMps || 1.12) * obs.speedFactor;

        if (dist <= 0.3) {
          if (rIdx + dir >= wps.length || rIdx + dir < 0) {
            dir = (dir === 1 ? -1 : 1) as 1 | -1;
            obs.routeDirection = dir;
          }
          rIdx = Math.max(0, Math.min(wps.length - 1, rIdx + dir));
          obs.routeIndex = rIdx;
        } else {
          candidateX += (vx / dist) * speed * subDt;
          candidateZ += (vz / dist) * speed * subDt;
        }
      } else {
        // Group follower with cohesion, social spacing, and split/regroup behavior
        const leader = agents.find((a) => a.id === obs.groupLeaderId);
        if (leader) {
          const offset = obs.groupOffset ?? { x: 0.9, z: -0.6 };
          // Split apart wider if passing near robot or narrow corridor, then regroup
          const splitFactor = distToRobot < 3.4 ? 1.55 : 1.0;
          const desiredX =
            leader.currentPos.x +
            offset.x * Math.cos(leader.headingRad) * splitFactor -
            offset.z * Math.sin(leader.headingRad);
          const desiredZ =
            leader.currentPos.z +
            offset.x * Math.sin(leader.headingRad) * splitFactor +
            offset.z * Math.cos(leader.headingRad);

          const gx = desiredX - obs.currentPos.x;
          const gz = desiredZ - obs.currentPos.z;
          const gDist = Math.hypot(gx, gz);
          const maxFollowSpeed = (obs.cruiseSpeedMps || 1.15) * 1.25;
          if (gDist > 0.04) {
            const step = Math.min(gDist, maxFollowSpeed * subDt);
            candidateX += (gx / gDist) * step;
            candidateZ += (gz / gDist) * step;
          }
        }
      }
    } else {
      // 3. CROSSING PEDESTRIANS (and legacy oscillating test spots)
      const primaryOffset = Math.sin(obs.walkTime * 1.2 + obs.phase) * obs.amplitude;
      let targetLateral = 0;
      if (distToRobot < 2.6) {
        if (obs.axis === 'x') {
          const signZ = dzToRobot >= 0 ? 1 : -1;
          targetLateral = signZ * 1.15;
        } else {
          const signX = dxToRobot >= 0 ? 1 : -1;
          targetLateral = signX * 1.15;
        }
      }
      const dampAlpha = Math.min(1, subDt * 4.0);
      obs.lateralOffset += (targetLateral - obs.lateralOffset) * dampAlpha;

      if (obs.axis === 'x') {
        candidateX = obs.basePos.x + primaryOffset;
        candidateZ = obs.basePos.z + obs.lateralOffset;
      } else {
        candidateX = obs.basePos.x + obs.lateralOffset;
        candidateZ = obs.basePos.z + primaryOffset;
      }
    }

    // Inter-pedestrian social repulsion so group/crossing pedestrians never overlap each other
    for (const other of agents) {
      if (other.id === obs.id) continue;
      const sepX = candidateX - other.currentPos.x;
      const sepZ = candidateZ - other.currentPos.z;
      const sepDist = Math.hypot(sepX, sepZ);
      const minSocialDist = obs.radius + other.radius + 0.12;
      if (sepDist > 0.001 && sepDist < minSocialDist) {
        const push = (minSocialDist - sepDist) * 0.55;
        candidateX += (sepX / sepDist) * push;
        candidateZ += (sepZ / sepDist) * push;
      }
    }

    // Enforce building & construction barrier avoidance for pedestrians
    if (
      isPedestrianPositionValid(
        candidateX,
        candidateZ,
        activeConstructionIds,
        obs.radius * 0.85
      )
    ) {
      obs.currentPos.x = candidateX;
      obs.currentPos.z = candidateZ;
    } else if (obs.behaviorClass === 'commuter' || obs.behaviorClass === 'group') {
      // Reverse route direction if blocked by construction zone
      obs.routeDirection = ((obs.routeDirection ?? 1) === 1 ? -1 : 1) as 1 | -1;
    } else if (obs.behaviorClass === 'random' && obs.currentGraphNodeId) {
      obs.targetGraphNodeId = obs.currentGraphNodeId;
    }

    if (subDt > 0.0001) {
      obs.velocity.x = (obs.currentPos.x - prevX) / subDt;
      obs.velocity.z = (obs.currentPos.z - prevZ) / subDt;
      if (Math.hypot(obs.velocity.x, obs.velocity.z) > 0.02) {
        obs.headingRad = Math.atan2(obs.velocity.x, obs.velocity.z);
      }
    }

    // Record recent movement history (sampled up to 16 points)
    const lastHist = obs.history[obs.history.length - 1];
    if (
      !lastHist ||
      Math.hypot(obs.currentPos.x - lastHist.x, obs.currentPos.z - lastHist.z) >= 0.22
    ) {
      obs.history.push({ x: obs.currentPos.x, z: obs.currentPos.z });
      if (obs.history.length > 16) {
        obs.history.shift();
      }
    }
  }
}

/**
 * Predicts a pedestrian's future trajectory over `horizonSec` (1s, 2s, or 4s) at `stepSec` intervals.
 * - For Predictable Commuters with learned route patterns (observationsCount >= 3), traces their recurring route waypoints.
 * - For Random Walkers, uses short-horizon velocity + recent history heading with growing uncertainty radius.
 * - For Crossing & Group Pedestrians, uses velocity/oscillation phase and group cohesion heading.
 */
export function predictPedestrianTrajectory(
  agent: PedestrianSimAgent,
  horizonSec: PredictionHorizonSec = 2,
  stepSec = 0.4
): { points: Vector2D[]; uncertaintyRadiusM: number; confidence: number } {
  const points: Vector2D[] = [];
  const steps = Math.max(1, Math.round(horizonSec / stepSec));

  if (
    agent.isStationary ||
    (Math.hypot(agent.velocity.x, agent.velocity.z) < 0.02 &&
      agent.amplitude <= 0.001)
  ) {
    for (let s = 1; s <= steps; s++) {
      points.push({ x: agent.currentPos.x, z: agent.currentPos.z });
    }
    return { points, uncertaintyRadiusM: 0.2, confidence: 0.95 };
  }

  // Case 1: Predictable Commuter with learned recurring route
  if (
    agent.behaviorClass === 'commuter' &&
    agent.routeWaypoints &&
    agent.routeWaypoints.length > 1 &&
    agent.learnedRoutePattern
  ) {
    const wps = agent.routeWaypoints;
    let simX = agent.currentPos.x;
    let simZ = agent.currentPos.z;
    let rIdx = agent.routeIndex ?? 1;
    let dir = agent.routeDirection ?? 1;
    const speed = Math.max(
      0.8,
      Math.hypot(agent.velocity.x, agent.velocity.z) || agent.cruiseSpeedMps || 1.25
    );

    for (let s = 1; s <= steps; s++) {
      let remMove = speed * stepSec;
      while (remMove > 0.001) {
        const wp = wps[rIdx];
        const dx = wp.x - simX;
        const dz = wp.z - simZ;
        const d = Math.hypot(dx, dz);
        if (d <= remMove) {
          simX = wp.x;
          simZ = wp.z;
          remMove -= d;
          if (rIdx + dir >= wps.length || rIdx + dir < 0) {
            dir = (dir === 1 ? -1 : 1) as 1 | -1;
          }
          rIdx = Math.max(0, Math.min(wps.length - 1, rIdx + dir));
        } else {
          simX += (dx / d) * remMove;
          simZ += (dz / d) * remMove;
          remMove = 0;
        }
      }
      points.push({ x: simX, z: simZ });
    }

    return {
      points,
      uncertaintyRadiusM: Number((0.22 + horizonSec * 0.06).toFixed(2)),
      confidence: 0.92,
    };
  }

  // Case 2: Crossing Pedestrian (predict along crossing axis oscillation)
  if (agent.behaviorClass === 'crossing' && agent.amplitude > 0.05) {
    for (let s = 1; s <= steps; s++) {
      const dt = s * stepSec;
      const futureWalkTime = agent.walkTime + dt * agent.speedFactor;
      const offset = Math.sin(futureWalkTime * 1.2 + agent.phase) * agent.amplitude;
      const px =
        agent.axis === 'x'
          ? agent.basePos.x + offset
          : agent.basePos.x + agent.lateralOffset;
      const pz =
        agent.axis === 'z'
          ? agent.basePos.z + offset
          : agent.basePos.z + agent.lateralOffset;
      points.push({ x: px, z: pz });
    }
    return {
      points,
      uncertaintyRadiusM: Number((0.28 + horizonSec * 0.1).toFixed(2)),
      confidence: 0.85,
    };
  }

  // Case 3: Random Walker or Unlearned Commuter / Group Member (short-horizon velocity + history smoothing)
  let vx = agent.velocity.x;
  let vz = agent.velocity.z;
  if (agent.history.length >= 2) {
    const first = agent.history[Math.max(0, agent.history.length - 3)];
    const last = agent.history[agent.history.length - 1];
    const hdx = last.x - first.x;
    const hdz = last.z - first.z;
    const hLen = Math.hypot(hdx, hdz);
    const vSpeed = Math.hypot(vx, vz);
    if (hLen > 0.1 && vSpeed > 0.05) {
      vx = vx * 0.65 + (hdx / hLen) * vSpeed * 0.35;
      vz = vz * 0.65 + (hdz / hLen) * vSpeed * 0.35;
    }
  }

  // For random walkers, cap reliable velocity extrapolation at ~2.2s to avoid over-assuming straight line walks
  const effectiveExtrapolationCap = agent.behaviorClass === 'random' ? 2.2 : horizonSec;
  for (let s = 1; s <= steps; s++) {
    const dt = Math.min(s * stepSec, effectiveExtrapolationCap);
    points.push({
      x: agent.currentPos.x + vx * dt,
      z: agent.currentPos.z + vz * dt,
    });
  }

  const isRandom = agent.behaviorClass === 'random';
  return {
    points,
    uncertaintyRadiusM: Number(
      (isRandom ? 0.38 + horizonSec * 0.25 : 0.3 + horizonSec * 0.12).toFixed(2)
    ),
    confidence: Number(
      Math.max(0.42, isRandom ? 0.78 - horizonSec * 0.08 : 0.84 - horizonSec * 0.05).toFixed(2)
    ),
  };
}

export interface PredictiveAvoidanceAssessment {
  conflicts: PredictedConflictPoint[];
  penaltyZones: PredictedGridPenaltyZone[];
  recommendedSpeedScale: number;
  proactiveReplanRecommended: boolean;
  primaryConflictPed: PedestrianSimAgent | null;
  closestApproachDistanceM: number | null;
  earliestTtcSec: number | null;
  isTransientCrossingConflict: boolean;
  isSameDirectionConflict: boolean;
  followingSpeedMps: number | null;
}

/**
 * Computes analytical Relative Position & Velocity, Time to Closest Approach (tCPA),
 * and Predicted Closest Approach Distance (dPCA) between the robot and a pedestrian.
 */
export function computeRelativeKinematicsPca(
  robotPos: Vector2D,
  robotVel: Vector2D,
  pedPos: Vector2D,
  pedVel: Vector2D,
  combinedRadius: number
): {
  tCpaSec: number;
  pcaCenterDistM: number;
  pcaClearanceM: number;
  relSpeedMps: number;
  isApproaching: boolean;
  sameDirection: boolean;
  crossingAngleRad: number;
} {
  const rx = pedPos.x - robotPos.x;
  const rz = pedPos.z - robotPos.z;
  const vx = pedVel.x - robotVel.x;
  const vz = pedVel.z - robotVel.z;

  const relSpeedSq = vx * vx + vz * vz;
  const relSpeedMps = Math.sqrt(relSpeedSq);
  const dotPosVel = rx * vx + rz * vz;
  const isApproaching = dotPosVel < -0.01;

  const tCpaSec =
    relSpeedSq > 1e-4 ? Math.max(0, Math.min(6.0, -dotPosVel / relSpeedSq)) : 0;

  const futureRx = rx + vx * tCpaSec;
  const futureRz = rz + vz * tCpaSec;
  const pcaCenterDistM = Math.hypot(futureRx, futureRz);
  const pcaClearanceM = Math.max(0, pcaCenterDistM - combinedRadius);

  const robSpd = Math.hypot(robotVel.x, robotVel.z);
  const pedSpd = Math.hypot(pedVel.x, pedVel.z);
  let cosHeading = 0;
  if (robSpd > 0.05 && pedSpd > 0.05) {
    cosHeading =
      (robotVel.x * pedVel.x + robotVel.z * pedVel.z) / (robSpd * pedSpd);
  }
  const sameDirection = cosHeading > 0.55 && pedSpd > 0.15;
  const crossingAngleRad = Math.acos(Math.max(-1, Math.min(1, cosHeading)));

  return {
    tCpaSec: Number(tCpaSec.toFixed(2)),
    pcaCenterDistM: Number(pcaCenterDistM.toFixed(2)),
    pcaClearanceM: Number(pcaClearanceM.toFixed(2)),
    relSpeedMps: Number(relSpeedMps.toFixed(2)),
    isApproaching,
    sameDirection,
    crossingAngleRad,
  };
}

/**
 * Evaluates future trajectory intersections between the robot's planned A* path and
 * perceived pedestrians over `predictionHorizonSec` (1s, 2s, or 4s).
 * Supports Part 1 Intelligent Speed Regulation by computing PCA, TTC, and distinguishing
 * transient crossings or same-direction following from persistent corridor blockages.
 */
export function evaluatePredictiveConflicts(
  robotPos: Vector2D,
  robotSpeedMps: number,
  waypoints: Vector2D[],
  currentWaypointIdx: number,
  agents: PedestrianSimAgent[],
  visibilityRangeM: number,
  safetyClearanceM: number,
  predictionHorizonSec: PredictionHorizonSec = 2
): PredictiveAvoidanceAssessment {
  const conflicts: PredictedConflictPoint[] = [];
  const penaltyZones: PredictedGridPenaltyZone[] = [];
  let recommendedSpeedScale = 1.0;
  let proactiveReplanRecommended = false;
  let primaryConflictPed: PedestrianSimAgent | null = null;
  let earliestTtc = Infinity;
  let minPcaDistanceM = Infinity;
  let isTransientCrossingConflict = false;
  let isSameDirectionConflict = false;
  let followingSpeedMps: number | null = null;

  const stepSec = 0.4;
  const steps = Math.max(1, Math.round(predictionHorizonSec / stepSec));
  const nominalRobotSpeed = Math.max(1.2, robotSpeedMps);

  const targetWp = waypoints[currentWaypointIdx];
  const dirDx = targetWp ? targetWp.x - robotPos.x : 0;
  const dirDz = targetWp ? targetWp.z - robotPos.z : 1;
  const dirLen = Math.hypot(dirDx, dirDz) || 1;
  const robotVel: Vector2D = {
    x: (dirDx / dirLen) * nominalRobotSpeed,
    z: (dirDz / dirLen) * nominalRobotSpeed,
  };

  // Precompute robot future positions along waypoints at each time step s * stepSec
  const robotFuturePoints: Vector2D[] = [];
  for (let s = 1; s <= steps; s++) {
    let targetDist = nominalRobotSpeed * (s * stepSec);
    let curr = { x: robotPos.x, z: robotPos.z };
    for (let w = currentWaypointIdx; w < waypoints.length && targetDist > 0; w++) {
      const wp = waypoints[w];
      const segLen = Math.hypot(wp.x - curr.x, wp.z - curr.z);
      if (segLen <= targetDist) {
        curr = { x: wp.x, z: wp.z };
        targetDist -= segLen;
      } else {
        curr = {
          x: curr.x + ((wp.x - curr.x) / segLen) * targetDist,
          z: curr.z + ((wp.z - curr.z) / segLen) * targetDist,
        };
        targetDist = 0;
      }
    }
    robotFuturePoints.push(curr);
  }

  for (const agent of agents) {
    const distToRobot = Math.hypot(
      agent.currentPos.x - robotPos.x,
      agent.currentPos.z - robotPos.z
    );
    if (distToRobot > visibilityRangeM) {
      agent.predictedTrajectory = [];
      continue;
    }

    // Increment observation count when perceived so commuter routes become learned
    agent.observationsCount = (agent.observationsCount ?? 0) + 1;
    if (agent.behaviorClass === 'commuter' && agent.observationsCount >= 3) {
      agent.learnedRoutePattern = true;
    }

    const pred = predictPedestrianTrajectory(agent, predictionHorizonSec, stepSec);
    agent.predictedTrajectory = pred.points;
    agent.predictionUncertaintyM = pred.uncertaintyRadiusM;

    const combinedRadius = ROBOT_COLLISION_RADIUS + agent.radius;
    const kinematics = computeRelativeKinematicsPca(
      robotPos,
      robotVel,
      agent.currentPos,
      agent.velocity,
      combinedRadius
    );
    if (kinematics.isApproaching && kinematics.pcaClearanceM < minPcaDistanceM) {
      minPcaDistanceM = kinematics.pcaClearanceM;
    }

    // Check for trajectory conflict at each future time step
    for (let s = 0; s < pred.points.length; s++) {
      const pedFuture = pred.points[s];
      const robFuture = robotFuturePoints[s] ?? robotPos;
      const ttcSec = Number(((s + 1) * stepSec).toFixed(2));
      const futureSep = Math.hypot(
        pedFuture.x - robFuture.x,
        pedFuture.z - robFuture.z
      );

      const conflictThreshold =
        combinedRadius +
        Math.min(1.15, safetyClearanceM * 0.55) +
        pred.uncertaintyRadiusM * 0.35;

      if (futureSep <= conflictThreshold) {
        const pcaDist = Math.min(
          kinematics.pcaClearanceM,
          Math.max(0, futureSep - combinedRadius)
        );
        if (pcaDist < minPcaDistanceM) {
          minPcaDistanceM = pcaDist;
        }

        conflicts.push({
          pedestrianId: agent.id,
          pedestrianName: agent.name,
          behaviorClass: agent.behaviorClass,
          conflictPos: {
            x: Number(pedFuture.x.toFixed(2)),
            z: Number(pedFuture.z.toFixed(2)),
          },
          ttcSec,
          pcaDistanceM: Number(pcaDist.toFixed(2)),
          uncertaintyRadiusM: pred.uncertaintyRadiusM,
          confidence: pred.confidence,
        });

        penaltyZones.push({
          pos: { x: pedFuture.x, z: pedFuture.z },
          radiusM: Math.max(1.8, conflictThreshold + 0.4),
          costPenalty: 5.5 * pred.confidence * (1 + 1 / Math.max(0.5, ttcSec)),
          pedestrianName: agent.name,
        });

        const pedSpeed = Math.hypot(agent.velocity.x, agent.velocity.z);
        // Check if pedestrian will clear the robot's path shortly after the conflict step
        const lastPredPt = pred.points[pred.points.length - 1] ?? pedFuture;
        const distAtEndOfHorizon = Math.hypot(
          lastPredPt.x - robFuture.x,
          lastPredPt.z - robFuture.z
        );
        const clearsCorridorSoon =
          pedSpeed > 0.35 &&
          (distAtEndOfHorizon > conflictThreshold * 0.85 ||
            kinematics.crossingAngleRad > 0.55);

        if (ttcSec < earliestTtc) {
          earliestTtc = ttcSec;
          primaryConflictPed = agent;
          isSameDirectionConflict = kinematics.sameDirection;
          isTransientCrossingConflict = clearsCorridorSoon && !kinematics.sameDirection;
          if (kinematics.sameDirection) {
            followingSpeedMps = Math.max(0.45, pedSpeed * 0.92);
          }
        }

        // Compute smooth speed regulation factor based on TTC and PCA distance
        const ttcFactor = Math.max(
          0.26,
          Math.min(0.86, (ttcSec / Math.max(1.6, predictionHorizonSec)) * 0.82)
        );
        const pcaFactor = Math.max(
          0.25,
          Math.min(0.88, pcaDist / Math.max(0.9, safetyClearanceM))
        );
        recommendedSpeedScale = Math.min(
          recommendedSpeedScale,
          Math.max(0.25, (ttcFactor + pcaFactor) * 0.5)
        );

        // Only recommend global replanning when conflict is NOT resolvable by speed regulation
        // (e.g., multiple overlapping conflicts or very low speed blockage)
        if (!clearsCorridorSoon && !kinematics.sameDirection && ttcSec <= 1.6) {
          proactiveReplanRecommended = true;
        }
        break;
      }
    }
  }

  return {
    conflicts,
    penaltyZones,
    recommendedSpeedScale,
    proactiveReplanRecommended,
    primaryConflictPed,
    closestApproachDistanceM: minPcaDistanceM < Infinity ? minPcaDistanceM : null,
    earliestTtcSec: earliestTtc < Infinity ? earliestTtc : null,
    isTransientCrossingConflict,
    isSameDirectionConflict,
    followingSpeedMps,
  };
}

export interface PathHazardAssessment {
  nearestActualDist: number | null;
  nearestPerceivedDist: number | null;
  nearestPed: PedestrianSimAgent | null;
  blockingPed: PedestrianSimAgent | null;
  newlyDetectedPedIds: string[];
  imminentStopRequired: boolean;
  pathObstructedAhead: boolean;
  speedScaleFactor: number;
  sameDirectionAhead: boolean;
  sameDirectionPedSpeedMps: number | null;
  transientCrossingAhead: boolean;
}

function pointToSegmentDist(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number
): { dist: number; proj: number; segLen: number } {
  const vx = bx - ax;
  const vz = bz - az;
  const segLenSq = vx * vx + vz * vz;
  if (segLenSq < 1e-6) {
    return { dist: Math.hypot(px - ax, pz - az), proj: 0, segLen: 0 };
  }
  const segLen = Math.sqrt(segLenSq);
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / segLenSq));
  const closestX = ax + t * vx;
  const closestZ = az + t * vz;
  return {
    dist: Math.hypot(px - closestX, pz - closestZ),
    proj: t * segLen,
    segLen,
  };
}

/**
 * Evaluates perceived dynamic pedestrians against the robot's active forward trajectory.
 * Distinguishes between a pedestrian ahead along the active path vs a pedestrian behind/beside
 * the robot, and classifies same-direction vs transient crossing vs stationary blockage.
 */
export function evaluateActivePathPedestrianHazard(
  robotPos: Vector2D,
  waypoints: Vector2D[],
  currentWaypointIdx: number,
  agents: PedestrianSimAgent[],
  visibilityRangeM: number,
  effectiveSafetyClearanceM: number,
  sensorNoiseStdM: number,
  elapsedTimeSec: number
): PathHazardAssessment {
  let nearestActualDist = Infinity;
  let nearestPerceivedDist = Infinity;
  let nearestPed: PedestrianSimAgent | null = null;
  let blockingPed: PedestrianSimAgent | null = null;
  const newlyDetectedPedIds: string[] = [];

  let imminentStopRequired = false;
  let pathObstructedAhead = false;
  let speedScaleFactor = 1.0;
  let sameDirectionAhead = false;
  let sameDirectionPedSpeedMps: number | null = null;
  let transientCrossingAhead = false;

  const targetWp = waypoints[currentWaypointIdx];
  const stepDx = targetWp ? targetWp.x - robotPos.x : 0;
  const stepDz = targetWp ? targetWp.z - robotPos.z : 0;
  const stepLen = Math.hypot(stepDx, stepDz);
  const stepDirX = stepLen > 0.001 ? stepDx / stepLen : 0;
  const stepDirZ = stepLen > 0.001 ? stepDz / stepLen : 1;

  const lookaheadHorizonM = Math.max(3.6, effectiveSafetyClearanceM + 2.0);

  for (const obs of agents) {
    const rx = obs.currentPos.x - robotPos.x;
    const rz = obs.currentPos.z - robotPos.z;
    const centerDist = Math.hypot(rx, rz);

    if (centerDist > visibilityRangeM) {
      obs.isPerceived = false;
      continue;
    }

    const combinedRadius = ROBOT_COLLISION_RADIUS + obs.radius;
    const actualClearance = Math.max(0, centerDist - combinedRadius);
    const jitter =
      Math.sin(elapsedTimeSec * 8.5 + obs.phase) * sensorNoiseStdM;
    const perceivedClearance = Math.max(0, actualClearance + jitter);

    // Track distinct pedestrian detection events when within active sensor caution range
    if (centerDist <= Math.min(visibilityRangeM, effectiveSafetyClearanceM + 3.8)) {
      if (!obs.isPerceived) {
        obs.isPerceived = true;
        newlyDetectedPedIds.push(obs.id);
      }
    } else if (centerDist > effectiveSafetyClearanceM + 4.8) {
      obs.isPerceived = false;
    }

    if (actualClearance < nearestActualDist) {
      nearestActualDist = actualClearance;
      nearestPerceivedDist = perceivedClearance;
      nearestPed = obs;
    }

    const pedSpeed = Math.hypot(obs.velocity.x, obs.velocity.z);
    const dotForward = rx * stepDirX + rz * stepDirZ;
    const cosVel =
      pedSpeed > 0.08
        ? (obs.velocity.x * stepDirX + obs.velocity.z * stepDirZ) / pedSpeed
        : 0;
    const isSameDir = dotForward > 0.2 && cosVel > 0.6 && pedSpeed > 0.2;
    const isTransverse =
      dotForward > -0.2 && Math.abs(cosVel) <= 0.6 && pedSpeed > 0.3;

    // 1. Check whether taking a step toward targetWp would enter the pedestrian's safety boundary
    if (targetWp && stepLen > 0.01) {
      const probeStep = Math.min(stepLen, 0.35);
      const nextX = robotPos.x + stepDirX * probeStep;
      const nextZ = robotPos.z + stepDirZ * probeStep;
      const nextCenterDist = Math.hypot(
        obs.currentPos.x - nextX,
        obs.currentPos.z - nextZ
      );
      const nextClearance = Math.max(0, nextCenterDist - combinedRadius);
      const segCheck = pointToSegmentDist(
        obs.currentPos.x,
        obs.currentPos.z,
        robotPos.x,
        robotPos.z,
        targetWp.x,
        targetWp.z
      );

      const movingCloser = nextCenterDist < centerDist - 0.015;
      const segmentTooClose = segCheck.dist <= combinedRadius + 0.14;

      if (
        (movingCloser &&
          (nextClearance <= 0.45 ||
            actualClearance <= 0.48 ||
            perceivedClearance <= 0.42)) ||
        (segmentTooClose && movingCloser)
      ) {
        imminentStopRequired = true;
        pathObstructedAhead = true;
        blockingPed = obs;
        speedScaleFactor = 0;
      } else if (
        movingCloser &&
        Math.min(actualClearance, perceivedClearance) <= effectiveSafetyClearanceM
      ) {
        if (isSameDir) {
          sameDirectionAhead = true;
          sameDirectionPedSpeedMps = pedSpeed;
        } else if (isTransverse) {
          transientCrossingAhead = true;
        }
        speedScaleFactor = Math.min(
          speedScaleFactor,
          Math.max(
            0.25,
            actualClearance / Math.max(0.8, effectiveSafetyClearanceM)
          )
        );
      }
    }

    // 2. Check active forward path segments within lookaheadHorizonM (including predictive position)
    if (waypoints.length > 1 && currentWaypointIdx < waypoints.length) {
      const predX = obs.currentPos.x + obs.velocity.x * 0.45;
      const predZ = obs.currentPos.z + obs.velocity.z * 0.45;
      let accumLen = 0;
      let segStart = robotPos;

      for (
        let wIdx = currentWaypointIdx;
        wIdx < waypoints.length && accumLen < lookaheadHorizonM;
        wIdx++
      ) {
        const segEnd = waypoints[wIdx];
        const currSeg = pointToSegmentDist(
          obs.currentPos.x,
          obs.currentPos.z,
          segStart.x,
          segStart.z,
          segEnd.x,
          segEnd.z
        );
        const predSeg = pointToSegmentDist(
          predX,
          predZ,
          segStart.x,
          segStart.z,
          segEnd.x,
          segEnd.z
        );
        const minCorridorDist = Math.min(currSeg.dist, predSeg.dist);
        const distAlongPath = accumLen + currSeg.proj;

        const corridorThreshold = combinedRadius + 0.22;
        if (
          distAlongPath >= 0.08 &&
          distAlongPath <= lookaheadHorizonM &&
          minCorridorDist <= corridorThreshold
        ) {
          pathObstructedAhead = true;
          if (!blockingPed) blockingPed = obs;
          if (isSameDir) {
            sameDirectionAhead = true;
            sameDirectionPedSpeedMps = pedSpeed;
          } else if (isTransverse) {
            transientCrossingAhead = true;
          }
          if (distAlongPath <= 1.65) {
            speedScaleFactor = Math.min(speedScaleFactor, 0.28);
          }
          break;
        }

        accumLen += currSeg.segLen;
        segStart = segEnd;
      }
    }
  }

  return {
    nearestActualDist: nearestActualDist < Infinity ? nearestActualDist : null,
    nearestPerceivedDist:
      nearestPerceivedDist < Infinity ? nearestPerceivedDist : null,
    nearestPed,
    blockingPed: blockingPed ?? nearestPed,
    newlyDetectedPedIds,
    imminentStopRequired,
    pathObstructedAhead,
    speedScaleFactor: imminentStopRequired ? 0 : speedScaleFactor,
    sameDirectionAhead,
    sameDirectionPedSpeedMps,
    transientCrossingAhead,
  };
}

/**
 * LEVEL 4 LOCAL AVOIDANCE: Attempts to find a short local lateral bypass (1-2 waypoints)
 * around `blockingPed` on walkable road surface that rejoins the existing global A* route
 * a few waypoints ahead without recalculating the entire global A* route.
 */
export function computeLocalBypassWaypoints(
  robotPos: Vector2D,
  waypoints: Vector2D[],
  currentWaypointIdx: number,
  blockingPed: PedestrianSimAgent,
  activeConstructionIds: string[],
  allPedestrians: PedestrianSimAgent[]
): { splicedWaypoints: Vector2D[]; resumeIdx: number } | null {
  if (currentWaypointIdx >= waypoints.length) return null;

  // Find a rejoin waypoint 3.0m to 6.5m ahead along the existing global A* route
  let rejoinIdx = currentWaypointIdx;
  let accum = 0;
  let prev = robotPos;
  for (let i = currentWaypointIdx; i < waypoints.length; i++) {
    accum += Math.hypot(waypoints[i].x - prev.x, waypoints[i].z - prev.z);
    prev = waypoints[i];
    rejoinIdx = i;
    if (accum >= 3.8) break;
  }

  const rejoinWp = waypoints[rejoinIdx];
  const segDx = rejoinWp.x - robotPos.x;
  const segDz = rejoinWp.z - robotPos.z;
  const segLen = Math.hypot(segDx, segDz);
  if (segLen < 1.2) return null;

  const dirX = segDx / segLen;
  const dirZ = segDz / segLen;
  const perpX = -dirZ;
  const perpZ = dirX;

  const pedCircles: CollisionCircle[] = allPedestrians.map((o) => ({
    id: o.id,
    name: o.name,
    type: 'Dynamic Pedestrian',
    x: o.currentPos.x,
    z: o.currentPos.z,
    radius: o.radius + 0.18,
  }));

  // Candidate lateral offsets (prefer side further from blocking pedestrian)
  const pedRelX = blockingPed.currentPos.x - robotPos.x;
  const pedRelZ = blockingPed.currentPos.z - robotPos.z;
  const pedLatProj = pedRelX * perpX + pedRelZ * perpZ;
  const preferredSign = pedLatProj >= 0 ? -1 : 1;

  const candidateOffsets = [
    preferredSign * 1.65,
    -preferredSign * 1.65,
    preferredSign * 2.1,
    -preferredSign * 2.1,
    preferredSign * 2.55,
    -preferredSign * 2.55,
  ];

  for (const latOffset of candidateOffsets) {
    const wp1: Vector2D = {
      x: Number((robotPos.x + dirX * Math.min(0.55, segLen * 0.18) + perpX * latOffset).toFixed(2)),
      z: Number((robotPos.z + dirZ * Math.min(0.55, segLen * 0.18) + perpZ * latOffset).toFixed(2)),
      y: robotPos.y ?? 0,
      floor: robotPos.floor ?? 0,
    };
    const wp2: Vector2D = {
      x: Number((robotPos.x + dirX * Math.min(3.0, segLen * 0.72) + perpX * latOffset).toFixed(2)),
      z: Number((robotPos.z + dirZ * Math.min(3.0, segLen * 0.72) + perpZ * latOffset).toFixed(2)),
      y: robotPos.y ?? 0,
      floor: robotPos.floor ?? 0,
    };

    const { isRoadOrPath: r1 } = classifyCampusSurface(wp1.x, wp1.z);
    const { isRoadOrPath: r2 } = classifyCampusSurface(wp2.x, wp2.z);
    if (!r1 || !r2) continue;

    const hit1 = checkSweptRobotCollision(
      robotPos,
      wp1,
      ROBOT_COLLISION_RADIUS,
      activeConstructionIds,
      pedCircles
    );
    if (hit1 && hit1.collided) continue;

    const hit2 = checkSweptRobotCollision(
      wp1,
      wp2,
      ROBOT_COLLISION_RADIUS,
      activeConstructionIds,
      pedCircles
    );
    if (hit2 && hit2.collided) continue;

    const hit3 = checkSweptRobotCollision(
      wp2,
      rejoinWp,
      ROBOT_COLLISION_RADIUS,
      activeConstructionIds,
      pedCircles
    );
    if (hit3 && hit3.collided) continue;

    const prefix = waypoints.slice(0, currentWaypointIdx);
    const suffix = waypoints.slice(rejoinIdx);
    return {
      splicedWaypoints: [{ ...robotPos }, ...prefix.slice(1), wp1, wp2, ...suffix],
      resumeIdx: Math.max(1, prefix.length),
    };
  }

  return null;
}



