import { syncEnvironmentDerivedStructures } from '../data/environmentTemplates';
import {
  EnvironmentDefinition,
  EnvironmentValidationIssue,
  EnvironmentValidationReport,
  MapElement2D,
} from '../types/simulation';

/**
 * Validates an EnvironmentDefinition before simulation, checking:
 * 1. Scale & dimensions
 * 2. Walls & obstacles placement
 * 3. Walkable regions coverage
 * 4. Start & destination positions (not embedded inside solid walls)
 * 5. Navigation connectivity (2D grid BFS reachability between start and ground destinations)
 * 6. Floor & elevator connections (upper-floor destinations served by an elevator)
 */
export function validateEnvironment(
  rawEnv: EnvironmentDefinition
): EnvironmentValidationReport {
  const env = syncEnvironmentDerivedStructures(rawEnv);
  const issues: EnvironmentValidationIssue[] = [];

  // 1. Scale & Dimensions
  if (env.widthM < 30 || env.widthM > 300 || env.depthM < 30 || env.depthM > 300) {
    issues.push({
      id: 'scale-bounds',
      severity: 'error',
      category: 'Scale & Dimensions',
      message: `Environment dimensions (${env.widthM}m × ${env.depthM}m) are outside supported simulation bounds (30m–300m).`,
      suggestion: 'Set width and depth between 60m and 200m (100m × 100m recommended).',
    });
  }
  if (env.gridResolutionM < 0.5 || env.gridResolutionM > 5.0) {
    issues.push({
      id: 'scale-grid',
      severity: 'warning',
      category: 'Scale & Dimensions',
      message: `Grid resolution (${env.gridResolutionM}m) is unusual.`,
      suggestion: 'Use a 1.0m to 2.0m grid resolution for optimal A* pathfinding accuracy.',
    });
  }

  // 2. Build 2D occupancy grid for Ground Floor (floor 0) to verify walkable area & connectivity
  const halfW = env.widthM / 2;
  const halfD = env.depthM / 2;
  const cellRes = env.gridResolutionM || 2.0;
  const cols = Math.max(10, Math.floor(env.widthM / cellRes));
  const rows = Math.max(10, Math.floor(env.depthM / cellRes));

  const blocked: boolean[][] = Array.from({ length: cols }, () =>
    Array(rows).fill(false)
  );

  const groundWallsAndRooms = env.elements.filter(
    (el) =>
      (el.floor ?? 0) === 0 &&
      (el.type === 'wall' || el.type === 'room' || el.type === 'restricted_area')
  );

  // Doors and corridors explicitly carve walkable passages
  const groundDoorsAndCorridors = env.elements.filter(
    (el) =>
      (el.floor ?? 0) === 0 && (el.type === 'door' || el.type === 'corridor')
  );

  let blockedCount = 0;
  for (let gx = 0; gx < cols; gx++) {
    for (let gz = 0; gz < rows; gz++) {
      const wx = -halfW + (gx + 0.5) * cellRes;
      const wz = -halfD + (gz + 0.5) * cellRes;

      const inDoorOrCorridor = groundDoorsAndCorridors.some(
        (dc) =>
          Math.abs(wx - dc.x) <= dc.width / 2 + 0.8 &&
          Math.abs(wz - dc.z) <= dc.depth / 2 + 0.8
      );
      if (inDoorOrCorridor) continue;

      const inSolid = groundWallsAndRooms.some(
        (wr) =>
          Math.abs(wx - wr.x) <= wr.width / 2 + 0.4 &&
          Math.abs(wz - wr.z) <= wr.depth / 2 + 0.4
      );
      if (inSolid) {
        blocked[gx][gz] = true;
        blockedCount++;
      }
    }
  }

  const totalCells = cols * rows;
  const walkableCoveragePct = Number(
    (((totalCells - blockedCount) / totalCells) * 100).toFixed(1)
  );

  if (walkableCoveragePct < 20) {
    issues.push({
      id: 'walkable-low',
      severity: 'error',
      category: 'Walkable Regions',
      message: `Only ${walkableCoveragePct}% of the ground floor is walkable.`,
      suggestion: 'Reduce wall/room footprints or add corridors so robots have sufficient navigation clearance.',
    });
  } else if (walkableCoveragePct < 40) {
    issues.push({
      id: 'walkable-tight',
      severity: 'warning',
      category: 'Walkable Regions',
      message: `Walkable ground-floor coverage is relatively tight (${walkableCoveragePct}%).`,
      suggestion: 'Verify wide robots like OmniStride S4 have at least 2.4m corridor width.',
    });
  }

  // 3. Start & Destination checks
  const origins = env.locations.filter((l) => l.type === 'charging');
  const destinations = env.locations.filter((l) => l.type === 'delivery');
  const allLocations = env.locations;

  if (allLocations.length < 2) {
    issues.push({
      id: 'locations-missing',
      severity: 'error',
      category: 'Start & Destination',
      message: 'Environment must contain at least one starting point/charging station and one delivery destination.',
      suggestion: 'Use the 2D Map Editor to place a Starting Point and a Delivery Destination.',
    });
  }

  if (origins.length === 0 && env.elements.filter((e) => e.type === 'start_point').length === 0) {
    issues.push({
      id: 'charging-missing',
      severity: 'warning',
      category: 'Start & Destination',
      message: 'No dedicated Charging Station or Start Point marker found; using first location as default origin.',
      suggestion: 'Add a Charging Station or Start Point on Floor 0.',
    });
  }

  // Check if any ground-floor location is inside a solid wall/room without a door
  const worldToCell = (wx: number, wz: number): [number, number] => {
    const gx = Math.max(0, Math.min(cols - 1, Math.floor((wx + halfW) / cellRes)));
    const gz = Math.max(0, Math.min(rows - 1, Math.floor((wz + halfD) / cellRes)));
    return [gx, gz];
  };

  const findNearestWalkableCell = (startGx: number, startGz: number): [number, number] | null => {
    if (!blocked[startGx]?.[startGz]) return [startGx, startGz];
    for (let r = 1; r <= 4; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          const nx = startGx + dx;
          const nz = startGz + dz;
          if (nx >= 0 && nx < cols && nz >= 0 && nz < rows && !blocked[nx][nz]) {
            return [nx, nz];
          }
        }
      }
    }
    return null;
  };

  for (const loc of allLocations) {
    if ((loc.floor ?? 0) === 0) {
      const [gx, gz] = worldToCell(loc.position[0], loc.position[2]);
      if (blocked[gx]?.[gz]) {
        const nearby = findNearestWalkableCell(gx, gz);
        if (!nearby) {
          issues.push({
            id: `loc-blocked-${loc.id}`,
            severity: 'error',
            category: 'Start & Destination',
            message: `Location "${loc.name}" (${loc.code}) at (${loc.position[0]}m, ${loc.position[2]}m) is enclosed inside a solid room or wall.`,
            suggestion: 'Move the marker into a walkable corridor or place a Door element on the room boundary.',
          });
        }
      }
    }
  }

  // 4. Navigation Connectivity (BFS from primary start location on Floor 0)
  const primaryStart =
    origins[0] ?? allLocations.find((l) => (l.floor ?? 0) === 0) ?? allLocations[0];
  let reachableDestinationsCount = 0;
  const totalDestinationsCount = destinations.length || Math.max(1, allLocations.length - 1);

  if (primaryStart) {
    const [rawSx, rawSz] = worldToCell(primaryStart.position[0], primaryStart.position[2]);
    const startCell = findNearestWalkableCell(rawSx, rawSz) ?? [rawSx, rawSz];

    const visited: boolean[][] = Array.from({ length: cols }, () =>
      Array(rows).fill(false)
    );
    const queue: [number, number][] = [startCell];
    visited[startCell[0]][startCell[1]] = true;

    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];

    while (queue.length > 0) {
      const [cx, cz] = queue.shift()!;
      for (const [dx, dz] of dirs) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (
          nx >= 0 &&
          nx < cols &&
          nz >= 0 &&
          nz < rows &&
          !visited[nx][nz] &&
          !blocked[nx][nz]
        ) {
          visited[nx][nz] = true;
          queue.push([nx, nz]);
        }
      }
    }

    const targetList = destinations.length > 0 ? destinations : allLocations.slice(1);
    for (const dest of targetList) {
      if ((dest.floor ?? 0) > 0) {
        // Upper floor destination: check if an elevator is reachable on Floor 0 and serves dest.floor
        const servingElev = env.elevators.find((e) =>
          e.floorsServed.includes(dest.floor ?? 1)
        );
        if (servingElev) {
          const [ex, ez] = worldToCell(
            servingElev.outdoorApproachPos.x,
            servingElev.outdoorApproachPos.z
          );
          const nearElev = findNearestWalkableCell(ex, ez);
          if (nearElev && visited[nearElev[0]][nearElev[1]]) {
            reachableDestinationsCount++;
          } else {
            issues.push({
              id: `conn-elev-${dest.id}`,
              severity: 'error',
              category: 'Navigation Connectivity',
              message: `Elevator "${servingElev.name}" required for upper-floor destination "${dest.name}" is unreachable from "${primaryStart.name}".`,
              suggestion: 'Clear obstacles blocking the ground-floor approach to the elevator shaft.',
            });
          }
        }
      } else {
        const [dx, dz] = worldToCell(dest.position[0], dest.position[2]);
        const nearDest = findNearestWalkableCell(dx, dz);
        if (nearDest && visited[nearDest[0]][nearDest[1]]) {
          reachableDestinationsCount++;
        } else {
          issues.push({
            id: `conn-dest-${dest.id}`,
            severity: 'error',
            category: 'Navigation Connectivity',
            message: `Destination "${dest.name}" (${dest.code}) has no connected walkable path from "${primaryStart.name}".`,
            suggestion: 'Remove wall blockages or add a Door/Corridor connecting the zones.',
          });
        }
      }
    }
  }

  // 5. Multi-Floor & Elevator checks
  const upperFloorLocations = allLocations.filter((l) => (l.floor ?? 0) > 0);
  if (upperFloorLocations.length > 0 && env.elevators.length === 0) {
    issues.push({
      id: 'multifloor-no-elevator',
      severity: 'error',
      category: 'Multi-Floor & Elevator',
      message: `${upperFloorLocations.length} destination(s) are placed on upper floors, but no Elevator Shaft exists in the environment.`,
      suggestion: 'Place an Elevator Shaft on Floor 0 in the 2D Map Editor to connect Floor 0 with upper floors.',
    });
  } else if (upperFloorLocations.length > 0) {
    for (const uLoc of upperFloorLocations) {
      const targetFl = uLoc.floor ?? 1;
      const served = env.elevators.some((e) => e.floorsServed.includes(targetFl));
      if (!served) {
        issues.push({
          id: `multifloor-unserved-${uLoc.id}`,
          severity: 'error',
          category: 'Multi-Floor & Elevator',
          message: `Location "${uLoc.name}" is on Floor ${targetFl}, which is not served by any configured elevator.`,
          suggestion: `Update the Elevator Shaft to serve Floor ${targetFl}.`,
        });
      }
    }
  }

  const hasErrors = issues.some((i) => i.severity === 'error');
  return {
    isValid: issues.length === 0,
    canSimulate: !hasErrors,
    timestamp: new Date().toISOString(),
    checkedFloorCount: env.floors.length,
    walkableCoveragePct,
    reachableDestinationsCount,
    totalDestinationsCount,
    issues,
  };
}

/**
 * Parses a ROS occupancy map YAML configuration string.
 * Supports standard ROS map_server fields: image, resolution, origin, occupied_thresh, free_thresh.
 */
export function parseRosMapYaml(yamlText: string): {
  resolution: number;
  origin: [number, number, number];
  occupiedThresh: number;
  freeThresh: number;
  imageName?: string;
} {
  const lines = yamlText.split(/\r?\n/);
  let resolution = 0.05;
  let origin: [number, number, number] = [-50, -50, 0];
  let occupiedThresh = 0.65;
  let freeThresh = 0.196;
  let imageName: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const [keyPart, ...rest] = line.split(':');
    if (!keyPart || rest.length === 0) continue;
    const key = keyPart.trim().toLowerCase();
    const val = rest.join(':').trim();

    if (key === 'resolution') {
      const num = parseFloat(val);
      if (!Number.isNaN(num) && num > 0) resolution = num;
    } else if (key === 'occupied_thresh') {
      const num = parseFloat(val);
      if (!Number.isNaN(num)) occupiedThresh = num;
    } else if (key === 'free_thresh') {
      const num = parseFloat(val);
      if (!Number.isNaN(num)) freeThresh = num;
    } else if (key === 'image') {
      imageName = val.replace(/^['"]|['"]$/g, '');
    } else if (key === 'origin') {
      const match = val.match(/\[([^\]]+)\]/);
      if (match) {
        const parts = match[1].split(',').map((s) => parseFloat(s.trim()));
        if (parts.length >= 2 && !parts.some((n) => Number.isNaN(n))) {
          origin = [parts[0], parts[1], parts[2] || 0];
        }
      }
    }
  }

  return { resolution, origin, occupiedThresh, freeThresh, imageName };
}

/**
 * Extracts coarse 2D wall/obstacle blocks from a floorplan or ROS occupancy image
 * using an HTML5 offscreen canvas so imported images create real physical collision boundaries.
 */
export async function extractWallsFromFloorplanImage(
  imageDataUrl: string,
  worldWidthM: number = 100,
  worldDepthM: number = 100,
  darknessThreshold: number = 95
): Promise<MapElement2D[]> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined' || typeof document === 'undefined') {
      resolve([]);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const gridCols = 20;
        const gridRows = 20;
        const canvas = document.createElement('canvas');
        canvas.width = gridCols;
        canvas.height = gridRows;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve([]);
          return;
        }
        ctx.drawImage(img, 0, 0, gridCols, gridRows);
        const imgData = ctx.getImageData(0, 0, gridCols, gridRows).data;
        const extracted: MapElement2D[] = [];
        const cellW = worldWidthM / gridCols;
        const cellD = worldDepthM / gridRows;

        for (let r = 0; r < gridRows; r++) {
          for (let c = 0; c < gridCols; c++) {
            // Leave a clear center spawn corridor so imported maps don't trap the robot at (0,0)
            if (Math.abs(c - gridCols / 2) <= 1 && Math.abs(r - gridRows / 2) <= 1) {
              continue;
            }
            const idx = (r * gridCols + c) * 4;
            const red = imgData[idx];
            const green = imgData[idx + 1];
            const blue = imgData[idx + 2];
            const alpha = imgData[idx + 3];
            const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;

            if (alpha > 128 && luminance < darknessThreshold) {
              const wx = Number((-worldWidthM / 2 + (c + 0.5) * cellW).toFixed(1));
              const wz = Number((-worldDepthM / 2 + (r + 0.5) * cellD).toFixed(1));
              extracted.push({
                id: `imp-wall-${r}-${c}`,
                type: 'wall',
                name: `Imported Wall Segment (${c},${r})`,
                floor: 0,
                x: wx,
                z: wz,
                width: Number((cellW * 0.9).toFixed(1)),
                depth: Number((cellD * 0.9).toFixed(1)),
                height: 3.8,
                color: '#334155',
              });
            }
          }
        }
        resolve(extracted.slice(0, 48));
      } catch {
        resolve([]);
      }
    };
    img.onerror = () => resolve([]);
    img.src = imageDataUrl;
  });
}

/**
 * Parses a GeoJSON FeatureCollection into 2D map elements.
 */
export function parseGeoJsonToMapElements(geoJsonText: string): MapElement2D[] {
  try {
    const parsed = JSON.parse(geoJsonText);
    const features = Array.isArray(parsed?.features) ? parsed.features : [];
    const elements: MapElement2D[] = [];

    features.forEach((feat: any, idx: number) => {
      const props = feat?.properties || {};
      const geom = feat?.geometry || {};
      const elType =
        props.elementType ||
        props.type ||
        (geom.type === 'Point' ? 'delivery_destination' : 'room');
      const name = props.name || `GeoJSON Feature #${idx + 1}`;
      const floor = typeof props.floor === 'number' ? props.floor : 0;

      if (geom.type === 'Point' && Array.isArray(geom.coordinates)) {
        const [x, z] = geom.coordinates;
        elements.push({
          id: `geo-pt-${idx + 1}`,
          type:
            elType === 'charging_station' ||
            elType === 'start_point' ||
            elType === 'delivery_destination' ||
            elType === 'elevator_shaft'
              ? elType
              : 'delivery_destination',
          name,
          floor,
          x: Number(Math.max(-45, Math.min(45, Number(x) || 0)).toFixed(1)),
          z: Number(Math.max(-45, Math.min(45, Number(z) || 0)).toFixed(1)),
          width: 3.5,
          depth: 3.5,
          code: props.code || `GJ-${idx + 1}`,
        });
      } else if (geom.type === 'Polygon' && Array.isArray(geom.coordinates?.[0])) {
        const ring: [number, number][] = geom.coordinates[0];
        const xs = ring.map((p) => Number(p[0]) || 0);
        const zs = ring.map((p) => Number(p[1]) || 0);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minZ = Math.min(...zs);
        const maxZ = Math.max(...zs);
        const cx = (minX + maxX) / 2;
        const cz = (minZ + maxZ) / 2;
        elements.push({
          id: `geo-poly-${idx + 1}`,
          type:
            elType === 'wall' ||
            elType === 'room' ||
            elType === 'corridor' ||
            elType === 'obstacle' ||
            elType === 'restricted_area'
              ? elType
              : 'room',
          name,
          floor,
          x: Number(Math.max(-45, Math.min(45, cx)).toFixed(1)),
          z: Number(Math.max(-45, Math.min(45, cz)).toFixed(1)),
          width: Math.max(2, Number((maxX - minX).toFixed(1))),
          depth: Math.max(2, Number((maxZ - minZ).toFixed(1))),
          height: props.height || 5,
        });
      }
    });

    return elements;
  } catch {
    return [];
  }
}
