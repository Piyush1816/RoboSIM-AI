import {
  CAMPUS_BUILDINGS,
  CAMPUS_ELEVATORS,
  CONSTRUCTION_ZONES,
  DELIVERY_LOCATIONS,
} from './campusConfig';
import {
  CampusBuilding,
  CampusElevatorConfig,
  ConstructionZoneConfig,
  DeliveryLocation,
  EnvironmentDefinition,
  EnvironmentTemplateType,
  MapElement2D,
} from '../types/simulation';

/**
 * Synchronizes 2D map elements (`elements`) with `buildings`, `locations`, `elevators`, and `constructionZones`
 * so any custom environment or edited template works seamlessly in the 3D WebGL scene, A* pathfinder,
 * scenario generator, and batch runner.
 */
export function syncEnvironmentDerivedStructures(
  env: EnvironmentDefinition
): EnvironmentDefinition {
  // For the built-in Campus template if unmodified, preserve its exact rich buildings/locations/elevators
  // while also merging any newly added custom elements from the 2D Map Editor.
  const isCampusBase = env.id === 'env-campus-main';

  const derivedBuildings: CampusBuilding[] = isCampusBase
    ? [...CAMPUS_BUILDINGS]
    : [];
  const derivedLocations: DeliveryLocation[] = isCampusBase
    ? [...DELIVERY_LOCATIONS]
    : [];
  const derivedElevators: CampusElevatorConfig[] = isCampusBase
    ? [...CAMPUS_ELEVATORS]
    : [];
  const derivedZones: ConstructionZoneConfig[] = isCampusBase
    ? [...CONSTRUCTION_ZONES]
    : [];

  const existingBldgIds = new Set(derivedBuildings.map((b) => b.id));
  const existingLocIds = new Set(derivedLocations.map((l) => l.id));
  const existingElevIds = new Set(derivedElevators.map((e) => e.id));
  const existingZoneIds = new Set(derivedZones.map((z) => z.id));

  for (const el of env.elements) {
    if (el.type === 'room' || el.type === 'wall') {
      const bldgId = `bldg-${el.id}`;
      if (!existingBldgIds.has(bldgId) && !existingBldgIds.has(el.id)) {
        const height =
          el.height ?? (el.type === 'wall' ? 3.8 : el.floor > 0 ? 3.6 : 7.2);
        derivedBuildings.push({
          id: el.id,
          name: el.name,
          category: el.type === 'wall' ? 'facility' : 'academic',
          position: [el.x, el.floor * 3.6, el.z],
          size: [Math.max(1, el.width), height, Math.max(1, el.depth)],
          color: el.color || (el.type === 'wall' ? '#334155' : '#1e293b'),
          accentColor: el.type === 'wall' ? '#64748b' : '#06b6d4',
          description: `${el.type === 'wall' ? 'Structural wall' : 'Room'} on Floor ${el.floor}`,
        });
      }
    } else if (
      el.type === 'charging_station' ||
      el.type === 'start_point' ||
      el.type === 'delivery_destination'
    ) {
      if (!existingLocIds.has(el.id)) {
        const floorY = (el.floor || 0) * 3.6;
        // Find if there's an elevator in this environment if floor > 0
        const primaryElev =
          env.elements.find((e) => e.type === 'elevator_shaft') ??
          derivedElevators[0];
        derivedLocations.push({
          id: el.id,
          name: el.name,
          code:
            el.code ||
            el.name
              .replace(/[^A-Za-z0-9]/g, '')
              .slice(0, 5)
              .toUpperCase() ||
            'LOC',
          buildingId: 'custom-zone',
          position: [el.x, floorY, el.z],
          type: el.type === 'charging_station' ? 'charging' : 'delivery',
          priority: el.priority || 'Standard',
          floor: el.floor || 0,
          isIndoor: (el.floor || 0) > 0,
          elevatorId:
            (el.floor || 0) > 0 && primaryElev ? primaryElev.id : undefined,
        });
      }
    } else if (el.type === 'obstacle' || el.type === 'restricted_area') {
      if (!existingZoneIds.has(el.id)) {
        derivedZones.push({
          id: el.id,
          name: el.name,
          position: [el.x, (el.floor || 0) * 3.6, el.z],
          size: [Math.max(2, el.width), Math.max(2, el.depth)],
          activeInScenarios: ['all'],
          severity:
            el.type === 'restricted_area'
              ? 'Full Pathway Blockade'
              : 'Partial Lane Closure',
        });
      }
    } else if (el.type === 'elevator_shaft') {
      if (!existingElevIds.has(el.id)) {
        // Find upper floor destinations to connect with this elevator
        const upperDest = env.elements.find(
          (d) =>
            (d.type === 'delivery_destination' || d.type === 'room') &&
            d.floor >= 1
        );
        const destX = upperDest ? upperDest.x : el.x + 6;
        const destZ = upperDest ? upperDest.z : el.z;
        derivedElevators.push({
          id: el.id,
          name: el.name,
          buildingId: `bldg-shaft-${el.id}`,
          buildingName: `${ env.name } Vertical Core`,
          position: { x: el.x, z: el.z },
          outdoorApproachPos: { x: el.x, z: el.z + 6, y: 0, floor: 0 },
          entrancePos: { x: el.x, z: el.z + 4, y: 0, floor: 0 },
          groundCorridorWaypoints: [
            { x: el.x, z: el.z + 3, y: 0, floor: 0 },
          ],
          lobbyPos: { x: el.x, z: el.z + 2.2, y: 0, floor: 0 },
          doorwayPos: { x: el.x, z: el.z + 1.1, y: 0, floor: 0 },
          cabinPos: { x: el.x, z: el.z, y: 0, floor: 0 },
          doorwayFacing: 'south',
          firstFloorCorridorWaypoints: [
            { x: el.x, z: el.z + 2.2, y: 3.6, floor: 1 },
            { x: destX, z: destZ, y: 3.6, floor: 1 },
          ],
          firstFloorRoomPos: { x: destX, z: destZ, y: 3.6, floor: 1 },
          firstFloorRoomName: upperDest?.name || 'First Floor Station',
          upperCorridorWaypoints: [
            { x: el.x, z: el.z + 2.2, y: 7.2, floor: 2 },
            { x: destX, z: destZ, y: 7.2, floor: 2 },
          ],
          destinationRoomPos: { x: destX, z: destZ, y: 7.2, floor: 2 },
          destinationRoomName: upperDest?.name || 'Upper Floor Station',
          isPrimary: derivedElevators.length === 0,
          floorsServed: el.floorsServed || [0, 1, 2],
          destinationFloor: upperDest?.floor || 1,
          floorHeightM: 3.6,
        });
      }
    }
  }

  // Ensure every environment has at least 2 locations (1 origin/charging + 1 destination)
  if (derivedLocations.length === 0) {
    derivedLocations.push(
      {
        id: `${env.id}-dock-start`,
        name: 'Primary Charging & Dispatch Dock',
        code: 'DOCK-01',
        buildingId: 'core',
        position: [-20, 0, -16],
        type: 'charging',
        priority: 'Standard',
        floor: 0,
      },
      {
        id: `${env.id}-dest-alpha`,
        name: 'Alpha Dropoff Terminal',
        code: 'DEST-A1',
        buildingId: 'core',
        position: [22, 0, 16],
        type: 'delivery',
        priority: 'Priority',
        floor: 0,
      }
    );
  } else if (derivedLocations.length === 1) {
    derivedLocations.push({
      id: `${env.id}-dest-auto`,
      name: 'Secondary Delivery Bay',
      code: 'BAY-02',
      buildingId: 'core',
      position: [18, 0, 14],
      type: 'delivery',
      priority: 'Standard',
      floor: 0,
    });
  }

  return {
    ...env,
    buildings: derivedBuildings,
    locations: derivedLocations,
    elevators: derivedElevators,
    constructionZones: derivedZones,
  };
}

const CAMPUS_MAP_ELEMENTS: MapElement2D[] = [
  ...CAMPUS_BUILDINGS.map((b) => ({
    id: b.id,
    type: 'room' as const,
    name: b.name,
    floor: 0,
    x: b.position[0],
    z: b.position[2],
    width: b.size[0],
    depth: b.size[2],
    height: b.size[1],
    color: b.color,
  })),
  ...DELIVERY_LOCATIONS.map((l) => ({
    id: l.id,
    type:
      l.type === 'charging'
        ? ('charging_station' as const)
        : ('delivery_destination' as const),
    name: l.name,
    floor: l.floor ?? 0,
    x: l.position[0],
    z: l.position[2],
    width: 3,
    depth: 3,
    code: l.code,
    priority: l.priority,
  })),
  ...CAMPUS_ELEVATORS.map((e) => ({
    id: e.id,
    type: 'elevator_shaft' as const,
    name: e.name,
    floor: 0,
    x: e.cabinPos.x,
    z: e.cabinPos.z,
    width: 3.2,
    depth: 3.2,
    floorsServed: e.floorsServed,
  })),
  ...CONSTRUCTION_ZONES.map((z) => ({
    id: z.id,
    type: 'obstacle' as const,
    name: z.name,
    floor: 0,
    x: z.position[0],
    z: z.position[2],
    width: z.size[0],
    depth: z.size[1],
  })),
];

export const BUILTIN_ENVIRONMENTS: EnvironmentDefinition[] = [
  syncEnvironmentDerivedStructures({
    id: 'env-campus-main',
    name: 'University Innovation Campus (Multi-Floor)',
    version: '2.4.0',
    templateType: 'Campus',
    description:
      'Built-in 100m × 100m autonomous delivery testbed with 6 academic/residential buildings, dynamic pedestrian crosswalks, construction zones, and a 3-floor Student Union elevator core.',
    widthM: 100,
    depthM: 100,
    gridResolutionM: 2.0,
    floors: [
      { floor: 0, label: 'Ground Floor (0.0m)', heightM: 0 },
      { floor: 1, label: 'First Floor — 1F Robotics Lab (3.6m)', heightM: 3.6 },
      { floor: 2, label: 'Second Floor — 2F Skybridge (7.2m)', heightM: 7.2 },
    ],
    elements: CAMPUS_MAP_ELEMENTS,
    buildings: CAMPUS_BUILDINGS,
    locations: DELIVERY_LOCATIONS,
    elevators: CAMPUS_ELEVATORS,
    constructionZones: CONSTRUCTION_ZONES,
    isBuiltIn: true,
    updatedAt: '2026-11-03T18:00:00Z',
  }),

  syncEnvironmentDerivedStructures({
    id: 'env-warehouse-logistics',
    name: 'HyperScale Fulfillment Warehouse B4',
    version: '1.2.0',
    templateType: 'Warehouse',
    description:
      'High-throughput logistics warehouse with parallel pallet racking aisles, inbound/outbound sorting docks, AMR charging bays, and a heavy freight lift to the 1F mezzanine.',
    widthM: 100,
    depthM: 100,
    gridResolutionM: 2.0,
    floors: [
      { floor: 0, label: 'Ground Fulfillment Floor (0.0m)', heightM: 0 },
      { floor: 1, label: '1F Packing Mezzanine (3.6m)', heightM: 3.6 },
    ],
    elements: [
      { id: 'wh-rack-a1', type: 'room', name: 'Pallet Rack Aisle A', floor: 0, x: -24, z: -18, width: 18, depth: 8, height: 6.5, color: '#1e293b' },
      { id: 'wh-rack-a2', type: 'room', name: 'Pallet Rack Aisle B', floor: 0, x: -24, z: 6, width: 18, depth: 8, height: 6.5, color: '#1e293b' },
      { id: 'wh-rack-b1', type: 'room', name: 'Bulk Storage Zone C', floor: 0, x: 22, z: -18, width: 18, depth: 8, height: 6.5, color: '#172554' },
      { id: 'wh-rack-b2', type: 'room', name: 'Cold Chain Vault D', floor: 0, x: 22, z: 18, width: 16, depth: 10, height: 7.0, color: '#0f172a' },
      { id: 'wh-corridor-main', type: 'corridor', name: 'Central AMR Trunk Spine', floor: 0, x: 0, z: 0, width: 12, depth: 76, color: '#0284c7' },
      { id: 'wh-dock-charge', type: 'charging_station', name: 'AMR Fast-Charge Bay 01', code: 'WH-CHG1', floor: 0, x: -34, z: -32, width: 4, depth: 4, priority: 'Standard' },
      { id: 'wh-start-inbound', type: 'start_point', name: 'Inbound Receiving Dock North', code: 'WH-IN1', floor: 0, x: -12, z: -32, width: 4, depth: 4, priority: 'Standard' },
      { id: 'wh-dest-outbound', type: 'delivery_destination', name: 'Outbound Shipping Marshaling South', code: 'WH-OUT1', floor: 0, x: 14, z: 32, width: 4, depth: 4, priority: 'Priority' },
      { id: 'wh-dest-pack', type: 'delivery_destination', name: 'High-Velocity Sortation Cell', code: 'WH-SRT2', floor: 0, x: 30, z: -4, width: 4, depth: 4, priority: 'Standard' },
      { id: 'wh-elev-freight', type: 'elevator_shaft', name: 'Mezzanine Freight Lift #1', floor: 0, x: 0, z: -28, width: 3.6, depth: 3.6, floorsServed: [0, 1] },
      { id: 'wh-dest-mezz', type: 'delivery_destination', name: '1F Mezzanine Quality Pack Station', code: 'WH-MZ1', floor: 1, x: 8, z: -28, width: 4, depth: 4, priority: 'Priority' },
      { id: 'wh-obs-spill', type: 'obstacle', name: 'Staged Pallet Obstruction', floor: 0, x: 0, z: -6, width: 5, depth: 4 },
      { id: 'wh-rest-forklift', type: 'restricted_area', name: 'High-Speed Turret Truck Zone', floor: 0, x: -24, z: 26, width: 12, depth: 8 },
    ],
    buildings: [],
    locations: [],
    elevators: [],
    constructionZones: [],
    isBuiltIn: true,
    updatedAt: '2026-11-03T18:00:00Z',
  }),

  syncEnvironmentDerivedStructures({
    id: 'env-hospital-clinical',
    name: 'St. Jude Autonomous Clinical Pavilion',
    version: '1.3.0',
    templateType: 'Hospital',
    description:
      'Multi-floor clinical hospital logistics environment with Central Pharmacy, Emergency Triage, 1F ICU Isolation Ward, 2F Sterile Surgical Core, and medical lift.',
    widthM: 100,
    depthM: 100,
    gridResolutionM: 2.0,
    floors: [
      { floor: 0, label: 'Ground Clinical & Pharmacy (0.0m)', heightM: 0 },
      { floor: 1, label: '1F Acute ICU & Pathology Lab (3.6m)', heightM: 3.6 },
      { floor: 2, label: '2F Sterile Surgical Suite (7.2m)', heightM: 7.2 },
    ],
    elements: [
      { id: 'hosp-pharm', type: 'room', name: 'Central Automated Pharmacy', floor: 0, x: -26, z: -20, width: 16, depth: 12, height: 8, color: '#0f172a' },
      { id: 'hosp-er', type: 'room', name: 'Emergency Triage & Trauma Wing', floor: 0, x: 26, z: -20, width: 16, depth: 12, height: 8, color: '#1e293b' },
      { id: 'hosp-rad', type: 'room', name: 'MRI & Diagnostic Imaging Suite', floor: 0, x: -26, z: 20, width: 16, depth: 12, height: 8, color: '#172554' },
      { id: 'hosp-chg', type: 'charging_station', name: 'Clean Utility MedBot Dock', code: 'MED-CHG', floor: 0, x: -14, z: -26, width: 3.5, depth: 3.5, priority: 'Standard' },
      { id: 'hosp-start', type: 'start_point', name: 'Pharmacy Dispensing Window', code: 'PHARM-01', floor: 0, x: -14, z: -14, width: 3.5, depth: 3.5, priority: 'Lab Sample' },
      { id: 'hosp-dest-er', type: 'delivery_destination', name: 'ER Nurses Station Alpha', code: 'ER-NS1', floor: 0, x: 14, z: -14, width: 3.5, depth: 3.5, priority: 'Priority' },
      { id: 'hosp-dest-lab', type: 'delivery_destination', name: 'Ground Hematology Dropoff', code: 'HEM-G2', floor: 0, x: 20, z: 22, width: 3.5, depth: 3.5, priority: 'Lab Sample' },
      { id: 'hosp-elev-med', type: 'elevator_shaft', name: 'Clinical Clean Lift A', floor: 0, x: 0, z: -26, width: 3.4, depth: 3.4, floorsServed: [0, 1, 2] },
      { id: 'hosp-dest-icu', type: 'delivery_destination', name: '1F ICU Telemetry Pharmacy Locker', code: 'ICU-1F', floor: 1, x: 8, z: -26, width: 3.5, depth: 3.5, priority: 'Lab Sample' },
      { id: 'hosp-dest-surg', type: 'delivery_destination', name: '2F Sterile OR Supply Core', code: 'OR-2F', floor: 2, x: 8, z: -26, width: 3.5, depth: 3.5, priority: 'Priority' },
      { id: 'hosp-rest-mri', type: 'restricted_area', name: 'High-Gauss MRI Exclusion Zone', floor: 0, x: -14, z: 20, width: 6, depth: 8 },
      { id: 'hosp-obs-gurney', type: 'obstacle', name: 'Parked Corridor Gurney Cluster', floor: 0, x: 4, z: 2, width: 4, depth: 3 },
    ],
    buildings: [],
    locations: [],
    elevators: [],
    constructionZones: [],
    isBuiltIn: true,
    updatedAt: '2026-11-03T18:00:00Z',
  }),

  syncEnvironmentDerivedStructures({
    id: 'env-factory-assembly',
    name: 'Gigafactory Smart Powertrain Plant',
    version: '1.1.0',
    templateType: 'Factory',
    description:
      'Industrial discrete manufacturing floor with CNC machining islands, robotic welding cells, kitting supermarkets, and strict safety exclusion zones.',
    widthM: 100,
    depthM: 100,
    gridResolutionM: 2.0,
    floors: [
      { floor: 0, label: 'Main Assembly & CNC Floor (0.0m)', heightM: 0 },
      { floor: 1, label: '1F Electronics Sub-Assembly Deck (3.6m)', heightM: 3.6 },
    ],
    elements: [
      { id: 'fac-cnc-1', type: 'room', name: '5-Axis CNC Machining Island A', floor: 0, x: -24, z: -16, width: 16, depth: 12, height: 6, color: '#1e293b' },
      { id: 'fac-weld-2', type: 'room', name: 'Automated Laser Welding Cell B', floor: 0, x: 24, z: -16, width: 16, depth: 12, height: 6, color: '#1e1b4b' },
      { id: 'fac-qa-3', type: 'room', name: 'CMM Metrology & QA Room', floor: 0, x: 24, z: 22, width: 14, depth: 10, height: 6, color: '#0f172a' },
      { id: 'fac-chg', type: 'charging_station', name: 'Heavy AGV Inductive Pad 01', code: 'FAC-CHG', floor: 0, x: -32, z: 28, width: 4, depth: 4, priority: 'Standard' },
      { id: 'fac-start', type: 'start_point', name: 'Kitting Supermarket Dispatch', code: 'KIT-01', floor: 0, x: -16, z: 28, width: 4, depth: 4, priority: 'Standard' },
      { id: 'fac-dest-line1', type: 'delivery_destination', name: 'Stator Winding Line Feed B2', code: 'LINE-B2', floor: 0, x: 12, z: -14, width: 4, depth: 4, priority: 'Priority' },
      { id: 'fac-dest-qa', type: 'delivery_destination', name: 'Metrology Sample Drop Bay', code: 'QA-M1', floor: 0, x: 12, z: 22, width: 4, depth: 4, priority: 'Lab Sample' },
      { id: 'fac-rest-weld', type: 'restricted_area', name: 'Robotic Arc Flash Hazard Zone', floor: 0, x: 8, z: -2, width: 8, depth: 6 },
    ],
    buildings: [],
    locations: [],
    elevators: [],
    constructionZones: [],
    isBuiltIn: true,
    updatedAt: '2026-11-03T18:00:00Z',
  }),

  syncEnvironmentDerivedStructures({
    id: 'env-office-corporate',
    name: 'Apex Enterprise Tower & R&D Hub',
    version: '1.0.0',
    templateType: 'Office',
    description:
      'Multi-floor corporate workspace with ground reception, open-plan collaboration zones, 1F executive mailroom, and 2F hardware prototyping suite.',
    widthM: 100,
    depthM: 100,
    gridResolutionM: 2.0,
    floors: [
      { floor: 0, label: 'Ground Lobby & Concierge (0.0m)', heightM: 0 },
      { floor: 1, label: '1F Executive & Product Wing (3.6m)', heightM: 3.6 },
      { floor: 2, label: '2F Hardware Prototyping Lab (7.2m)', heightM: 7.2 },
    ],
    elements: [
      { id: 'off-conf-a', type: 'room', name: 'Boardroom & Auditorium North', floor: 0, x: -24, z: -18, width: 16, depth: 10, height: 5, color: '#1e293b' },
      { id: 'off-work-b', type: 'room', name: 'Open Workspace Pod East', floor: 0, x: 24, z: -14, width: 16, depth: 14, height: 5, color: '#172554' },
      { id: 'off-cafe', type: 'room', name: 'Atrium Barista & Micro-Kitchen', floor: 0, x: -22, z: 20, width: 14, depth: 12, height: 5, color: '#0f172a' },
      { id: 'off-chg', type: 'charging_station', name: 'Concierge Courier Alcove', code: 'OFF-CHG', floor: 0, x: -12, z: -28, width: 3.5, depth: 3.5, priority: 'Standard' },
      { id: 'off-start', type: 'start_point', name: 'Security Mailroom Intake', code: 'MAIL-G1', floor: 0, x: -8, z: 26, width: 3.5, depth: 3.5, priority: 'Standard' },
      { id: 'off-dest-pod', type: 'delivery_destination', name: 'Engineering Desk Cluster 4B', code: 'DESK-4B', floor: 0, x: 12, z: -12, width: 3.5, depth: 3.5, priority: 'Standard' },
      { id: 'off-elev', type: 'elevator_shaft', name: 'Tower Core Service Lift', floor: 0, x: 0, z: -28, width: 3.2, depth: 3.2, floorsServed: [0, 1, 2] },
      { id: 'off-dest-1f', type: 'delivery_destination', name: '1F Executive Briefing Suite', code: 'EXEC-1F', floor: 1, x: 7, z: -28, width: 3.5, depth: 3.5, priority: 'Priority' },
      { id: 'off-dest-2f', type: 'delivery_destination', name: '2F Silicon Validation Lab', code: 'LAB-2F', floor: 2, x: 7, z: -28, width: 3.5, depth: 3.5, priority: 'Lab Sample' },
    ],
    buildings: [],
    locations: [],
    elevators: [],
    constructionZones: [],
    isBuiltIn: true,
    updatedAt: '2026-11-03T18:00:00Z',
  }),

  syncEnvironmentDerivedStructures({
    id: 'env-shopping-mall',
    name: 'Metro Galleria Concourse & Retail Atrium',
    version: '1.0.0',
    templateType: 'Shopping Mall',
    description:
      'High-pedestrian retail concourse with anchor store fronts, central promotional kiosks, food court delivery lockers, and glass atrium elevator.',
    widthM: 100,
    depthM: 100,
    gridResolutionM: 2.0,
    floors: [
      { floor: 0, label: 'Ground Retail Promenade (0.0m)', heightM: 0 },
      { floor: 1, label: '1F Dining & Cinema Terrace (3.6m)', heightM: 3.6 },
    ],
    elements: [
      { id: 'mall-anchor-w', type: 'room', name: 'West Flagship Department Store', floor: 0, x: -28, z: 0, width: 16, depth: 36, height: 8, color: '#1e1b4b' },
      { id: 'mall-anchor-e', type: 'room', name: 'East Luxury Boutique Wing', floor: 0, x: 28, z: 0, width: 16, depth: 36, height: 8, color: '#172554' },
      { id: 'mall-kiosk-1', type: 'obstacle', name: 'Central Promotional Kiosk', floor: 0, x: 0, z: 4, width: 5, depth: 5 },
      { id: 'mall-chg', type: 'charging_station', name: 'Service Corridor Robot Bay', code: 'MALL-CHG', floor: 0, x: -12, z: -34, width: 3.5, depth: 3.5, priority: 'Standard' },
      { id: 'mall-start', type: 'start_point', name: 'Central Click-and-Collect Hub', code: 'HUB-G1', floor: 0, x: 0, z: 32, width: 3.5, depth: 3.5, priority: 'Standard' },
      { id: 'mall-dest-north', type: 'delivery_destination', name: 'North Plaza Concierge Locker', code: 'PLZ-N1', floor: 0, x: 12, z: -24, width: 3.5, depth: 3.5, priority: 'Priority' },
      { id: 'mall-elev', type: 'elevator_shaft', name: 'Atrium Panoramic Lift', floor: 0, x: 0, z: -28, width: 3.4, depth: 3.4, floorsServed: [0, 1] },
      { id: 'mall-dest-food', type: 'delivery_destination', name: '1F Food Court Kitchen Dispatch', code: 'FOOD-1F', floor: 1, x: 8, z: -28, width: 3.5, depth: 3.5, priority: 'Priority' },
    ],
    buildings: [],
    locations: [],
    elevators: [],
    constructionZones: [],
    isBuiltIn: true,
    updatedAt: '2026-11-03T18:00:00Z',
  }),

  syncEnvironmentDerivedStructures({
    id: 'env-research-laboratory',
    name: 'BioNova Cleanroom & Genomics Facility',
    version: '1.1.0',
    templateType: 'Laboratory',
    description:
      'ISO-5 cleanroom and automated assay laboratory requiring ultra-smooth vibration-free sample transport between PCR Prep, Cryo Storage, and Sequencing bays.',
    widthM: 100,
    depthM: 100,
    gridResolutionM: 2.0,
    floors: [
      { floor: 0, label: 'Ground Assay & Cryo Vault (0.0m)', heightM: 0 },
      { floor: 1, label: '1F High-Containment BSL-2 Wing (3.6m)', heightM: 3.6 },
    ],
    elements: [
      { id: 'lab-pcr', type: 'room', name: 'Automated PCR & Liquid Handling Bay', floor: 0, x: -24, z: -18, width: 16, depth: 12, height: 6, color: '#0f172a' },
      { id: 'lab-cryo', type: 'room', name: 'Liquid Nitrogen Cryo Biobank', floor: 0, x: 24, z: -18, width: 16, depth: 12, height: 6, color: '#172554' },
      { id: 'lab-seq', type: 'room', name: 'High-Throughput Sequencing Core', floor: 0, x: 24, z: 20, width: 16, depth: 12, height: 6, color: '#1e293b' },
      { id: 'lab-chg', type: 'charging_station', name: 'Airlock Decontamination Charge Dock', code: 'LAB-CHG', floor: 0, x: -26, z: 24, width: 3.5, depth: 3.5, priority: 'Standard' },
      { id: 'lab-start', type: 'start_point', name: 'Sample Accessioning Intake', code: 'SMP-IN', floor: 0, x: -12, z: 24, width: 3.5, depth: 3.5, priority: 'Lab Sample' },
      { id: 'lab-dest-seq', type: 'delivery_destination', name: 'Sequencer Loading Station S4', code: 'SEQ-S4', floor: 0, x: 12, z: 20, width: 3.5, depth: 3.5, priority: 'Lab Sample' },
      { id: 'lab-dest-cryo', type: 'delivery_destination', name: 'Cryo Vault Transfer Hatch', code: 'CRYO-01', floor: 0, x: 12, z: -18, width: 3.5, depth: 3.5, priority: 'Lab Sample' },
      { id: 'lab-elev', type: 'elevator_shaft', name: 'Cleanroom Airlock Lift', floor: 0, x: 0, z: -28, width: 3.2, depth: 3.2, floorsServed: [0, 1] },
      { id: 'lab-dest-bsl', type: 'delivery_destination', name: '1F BSL-2 Incubator Pass-Through', code: 'BSL-1F', floor: 1, x: 7, z: -28, width: 3.5, depth: 3.5, priority: 'Lab Sample' },
    ],
    buildings: [],
    locations: [],
    elevators: [],
    constructionZones: [],
    isBuiltIn: true,
    updatedAt: '2026-11-03T18:00:00Z',
  }),

  syncEnvironmentDerivedStructures({
    id: 'env-custom-blank',
    name: 'Custom Sandbox Environment',
    version: '1.0.0',
    templateType: 'Custom Environment',
    description:
      'Customizable 100m × 100m multi-floor environment canvas. Add walls, corridors, rooms, doors, obstacles, restricted zones, charging docks, and destinations in the 2D Map Editor or import an external map.',
    widthM: 100,
    depthM: 100,
    gridResolutionM: 2.0,
    floors: [
      { floor: 0, label: 'Ground Floor (0.0m)', heightM: 0 },
      { floor: 1, label: 'First Floor (3.6m)', heightM: 3.6 },
    ],
    elements: [
      { id: 'cust-room-1', type: 'room', name: 'North Operations Hub', floor: 0, x: -22, z: -20, width: 14, depth: 10, height: 6, color: '#1e293b' },
      { id: 'cust-room-2', type: 'room', name: 'South Receiving Wing', floor: 0, x: 22, z: 20, width: 14, depth: 10, height: 6, color: '#172554' },
      { id: 'cust-chg-1', type: 'charging_station', name: 'Primary Charging Station', code: 'CHG-01', floor: 0, x: -26, z: 20, width: 3.5, depth: 3.5, priority: 'Standard' },
      { id: 'cust-start-1', type: 'start_point', name: 'Dispatch Origin Alpha', code: 'STRT-A', floor: 0, x: -12, z: -18, width: 3.5, depth: 3.5, priority: 'Standard' },
      { id: 'cust-dest-1', type: 'delivery_destination', name: 'Target Dropoff Terminal B', code: 'DEST-B', floor: 0, x: 12, z: 18, width: 3.5, depth: 3.5, priority: 'Priority' },
    ],
    buildings: [],
    locations: [],
    elevators: [],
    constructionZones: [],
    isBuiltIn: false,
    updatedAt: '2026-11-03T18:00:00Z',
  }),
];

export function createEnvironmentFromTemplate(
  templateType: EnvironmentTemplateType,
  customName?: string
): EnvironmentDefinition {
  const base =
    BUILTIN_ENVIRONMENTS.find((e) => e.templateType === templateType) ??
    BUILTIN_ENVIRONMENTS[BUILTIN_ENVIRONMENTS.length - 1];
  const nowIso = new Date().toISOString();
  const suffix = Math.floor(100 + Math.random() * 900);
  const clonedElements: MapElement2D[] = base.elements.map((el) => ({
    ...el,
    id: `${el.id}-${suffix}`,
  }));

  return syncEnvironmentDerivedStructures({
    ...base,
    id: `env-custom-${Date.now()}`,
    name: customName?.trim() || `${templateType} Workspace #${suffix}`,
    version: '1.0.0',
    templateType,
    elements: clonedElements,
    isBuiltIn: false,
    updatedAt: nowIso,
  });
}
