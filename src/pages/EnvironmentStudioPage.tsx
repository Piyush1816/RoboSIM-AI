import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  FileUp,
  Grid,
  HardDrive,
  Layers,
  MapPin,
  Maximize2,
  Move,
  Play,
  Plus,
  RotateCcw,
  Save,
  ShieldAlert,
  Trash2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  BUILTIN_ENVIRONMENTS,
  createEnvironmentFromTemplate,
  syncEnvironmentDerivedStructures,
} from '../data/environmentTemplates';
import {
  extractWallsFromFloorplanImage,
  parseGeoJsonToMapElements,
  parseRosMapYaml,
  validateEnvironment,
} from '../simulation/environmentValidator';
import { useExperimentStore } from '../storage/ExperimentContext';
import {
  formatBytes,
  localEnvironmentFileStorage,
  ResolvedLocalEnvironmentFile,
} from '../storage/localFileStorage';
import {
  EnvironmentDefinition,
  EnvironmentElementType,
  EnvironmentTemplateType,
  LocalEnvironmentFileRef,
  MapElement2D,
  NavPageId,
} from '../types/simulation';

interface EnvironmentStudioPageProps {
  onNavigate: (page: NavPageId) => void;
}

const TEMPLATE_TYPES: EnvironmentTemplateType[] = [
  'Campus',
  'Warehouse',
  'Hospital',
  'Factory',
  'Office',
  'Shopping Mall',
  'Laboratory',
  'Custom Environment',
];

const ELEMENT_PALETTE: {
  type: EnvironmentElementType | 'select' | 'pan';
  label: string;
  shortDesc: string;
  color: string;
  defaultW: number;
  defaultD: number;
}[] = [
  {
    type: 'select',
    label: 'Select / Move',
    shortDesc: 'Click element to inspect, drag to reposition',
    color: '#38bdf8',
    defaultW: 0,
    defaultD: 0,
  },
  {
    type: 'pan',
    label: 'Pan Viewport',
    shortDesc: 'Drag canvas to pan across the 2D floor map',
    color: '#94a3b8',
    defaultW: 0,
    defaultD: 0,
  },
  {
    type: 'wall',
    label: 'Wall Segment',
    shortDesc: 'Structural barrier blocking robot navigation',
    color: '#64748b',
    defaultW: 12,
    defaultD: 2,
  },
  {
    type: 'room',
    label: 'Room / Building',
    shortDesc: 'Enclosed room or building block (3D extruded)',
    color: '#3b82f6',
    defaultW: 14,
    defaultD: 10,
  },
  {
    type: 'corridor',
    label: 'Walkable Corridor',
    shortDesc: 'Designated robot navigation lane / clearance',
    color: '#0284c7',
    defaultW: 8,
    defaultD: 24,
  },
  {
    type: 'door',
    label: 'Doorway Portal',
    shortDesc: 'Walkable opening through a wall or room boundary',
    color: '#22d3ee',
    defaultW: 3.5,
    defaultD: 2.5,
  },
  {
    type: 'obstacle',
    label: 'Static Obstacle',
    shortDesc: 'Pallet, kiosk, or temporary construction barrier',
    color: '#f59e0b',
    defaultW: 4,
    defaultD: 4,
  },
  {
    type: 'restricted_area',
    label: 'Restricted Zone',
    shortDesc: 'High-hazard exclusion zone (forbidden to enter)',
    color: '#ef4444',
    defaultW: 8,
    defaultD: 6,
  },
  {
    type: 'charging_station',
    label: 'Charging Station',
    shortDesc: 'Robot dispatch & inductive battery recharge dock',
    color: '#10b981',
    defaultW: 3.5,
    defaultD: 3.5,
  },
  {
    type: 'start_point',
    label: 'Starting Point',
    shortDesc: 'Mission origin / pickup dispatch point',
    color: '#14b8a6',
    defaultW: 3.5,
    defaultD: 3.5,
  },
  {
    type: 'delivery_destination',
    label: 'Delivery Destination',
    shortDesc: 'Target dropoff terminal or room station',
    color: '#a855f7',
    defaultW: 3.5,
    defaultD: 3.5,
  },
  {
    type: 'elevator_shaft',
    label: 'Elevator Shaft',
    shortDesc: 'Multi-floor vertical lift connecting G / 1F / 2F',
    color: '#ec4899',
    defaultW: 3.6,
    defaultD: 3.6,
  },
];

export const EnvironmentStudioPage: React.FC<EnvironmentStudioPageProps> = ({
  onNavigate,
}) => {
  const { user } = useAuth();
  const {
    environments,
    activeEnvironment,
    setSelectedEnvironmentId,
    saveEnvironmentProfile,
    deleteEnvironmentProfile,
  } = useExperimentStore();

  const [draftEnv, setDraftEnv] = useState<EnvironmentDefinition>(() =>
    syncEnvironmentDerivedStructures(activeEnvironment)
  );
  const [activeFloor, setActiveFloor] = useState<number>(0);
  const [activeTool, setActiveTool] = useState<
    EnvironmentElementType | 'select' | 'pan'
  >('select');
  const [selectedElementId, setSelectedElementId] = useState<string | null>(
    null
  );
  const [zoom, setZoom] = useState<number>(1.0);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [snapToGrid, setSnapToGrid] = useState<boolean>(true);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [localFileResolution, setLocalFileResolution] =
    useState<ResolvedLocalEnvironmentFile | null>(null);
  const [envLocalFiles, setEnvLocalFiles] = useState<LocalEnvironmentFileRef[]>(
    []
  );

  // Import modal state
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [importTab, setImportTab] = useState<
    'floorplan' | 'ros' | 'geojson' | 'gltf'
  >('floorplan');
  const [calibratedWidthM, setCalibratedWidthM] = useState<number>(100);
  const [calibratedDepthM, setCalibratedDepthM] = useState<number>(100);
  const [autoExtractDarkWalls, setAutoExtractDarkWalls] =
    useState<boolean>(true);
  const [rosYamlText, setRosYamlText] = useState<string>(
    `image: warehouse_occupancy.png\nresolution: 0.05\norigin: [-50.0, -50.0, 0.0]\nnegate: 0\noccupied_thresh: 0.65\nfree_thresh: 0.196`
  );
  const [geoJsonText, setGeoJsonText] = useState<string>(
    JSON.stringify(
      {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {
              name: 'Imported Sorting Room A',
              elementType: 'room',
              floor: 0,
              height: 6,
            },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-28, -22],
                  [-12, -22],
                  [-12, -10],
                  [-28, -10],
                  [-28, -22],
                ],
              ],
            },
          },
          {
            type: 'Feature',
            properties: {
              name: 'Imported Dispatch Dock',
              elementType: 'start_point',
              code: 'GJ-ST1',
              floor: 0,
            },
            geometry: { type: 'Point', coordinates: [-18, 20] },
          },
          {
            type: 'Feature',
            properties: {
              name: 'Imported Delivery Bay',
              elementType: 'delivery_destination',
              code: 'GJ-DST1',
              floor: 0,
            },
            geometry: { type: 'Point', coordinates: [20, 16] },
          },
        ],
      },
      null,
      2
    )
  );

  // Dragging state on SVG canvas
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [draggingState, setDraggingState] = useState<{
    mode: 'element' | 'pan';
    elementId?: string;
    startClientX: number;
    startClientY: number;
    initialX: number;
    initialZ: number;
  } | null>(null);

  // Sync draft when user picks another environment from selector
  const handleSelectEnvironment = (envId: string) => {
    setSelectedEnvironmentId(envId);
    const found =
      environments.find((e) => e.id === envId) ?? BUILTIN_ENVIRONMENTS[0];
    setDraftEnv(syncEnvironmentDerivedStructures(found));
    setSelectedElementId(null);
    setActiveFloor(0);
    setStatusBanner(`Loaded environment "${found.name}" (v${found.version}).`);
  };

  const handleCreateFromTemplate = (templateType: EnvironmentTemplateType) => {
    const created = createEnvironmentFromTemplate(templateType);
    saveEnvironmentProfile(created);
    setSelectedEnvironmentId(created.id);
    setDraftEnv(created);
    setSelectedElementId(null);
    setActiveFloor(0);
    setStatusBanner(
      `Created new ${templateType} workspace "${created.name}".`
    );
  };

  const handleSaveDraft = () => {
    // Bump patch version on save
    const parts = draftEnv.version.split('.').map((n) => parseInt(n, 10) || 0);
    const nextVersion = `${parts[0] || 1}.${parts[1] || 0}.${(parts[2] || 0) + 1}`;
    const synced = syncEnvironmentDerivedStructures({
      ...draftEnv,
      version: nextVersion,
      updatedAt: new Date().toISOString(),
    });
    saveEnvironmentProfile(synced);
    setSelectedEnvironmentId(synced.id);
    setDraftEnv(synced);
    setStatusBanner(
      `Saved "${synced.name}" (v${synced.version}) to your workspace and activated for simulation.`
    );
  };

  const handleDuplicateEnvironment = () => {
    const suffix = Math.floor(100 + Math.random() * 900);
    const dup = syncEnvironmentDerivedStructures({
      ...draftEnv,
      id: `env-custom-${Date.now()}`,
      name: `${draftEnv.name} (Copy #${suffix})`,
      version: '1.0.0',
      isBuiltIn: false,
      updatedAt: new Date().toISOString(),
    });
    saveEnvironmentProfile(dup);
    setSelectedEnvironmentId(dup.id);
    setDraftEnv(dup);
    setStatusBanner(`Duplicated environment as "${dup.name}".`);
  };

  const handleResetBuiltIn = () => {
    const orig = BUILTIN_ENVIRONMENTS.find((b) => b.id === draftEnv.id);
    if (orig) {
      deleteEnvironmentProfile(orig.id);
      setDraftEnv(syncEnvironmentDerivedStructures(orig));
      setStatusBanner(`Reset "${orig.name}" to default template geometry.`);
    }
  };

  const validationReport = useMemo(
    () => validateEnvironment(draftEnv),
    [draftEnv]
  );

  const floorElements = useMemo(
    () =>
      draftEnv.elements.filter(
        (el) =>
          (el.floor ?? 0) === activeFloor || el.type === 'elevator_shaft'
      ),
    [draftEnv.elements, activeFloor]
  );

  const selectedElement = useMemo(
    () =>
      draftEnv.elements.find((el) => el.id === selectedElementId) ?? null,
    [draftEnv.elements, selectedElementId]
  );

  // Convert SVG client coordinates to world (x, z) in meters
  const clientToWorldCoords = (
    clientX: number,
    clientY: number
  ): { x: number; z: number } => {
    if (!svgRef.current) return { x: 0, z: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    const normX = (clientX - rect.left) / rect.width;
    const normY = (clientY - rect.top) / rect.height;
    const viewW = draftEnv.widthM / zoom;
    const viewD = draftEnv.depthM / zoom;
    const minX = -viewW / 2 - panOffset.x;
    const minZ = -viewD / 2 - panOffset.y;
    let wx = minX + normX * viewW;
    let wz = minZ + normY * viewD;
    if (snapToGrid) {
      wx = Math.round(wx);
      wz = Math.round(wz);
    } else {
      wx = Number(wx.toFixed(1));
      wz = Number(wz.toFixed(1));
    }
    const halfW = draftEnv.widthM / 2 - 2;
    const halfD = draftEnv.depthM / 2 - 2;
    return {
      x: Math.max(-halfW, Math.min(halfW, wx)),
      z: Math.max(-halfD, Math.min(halfD, wz)),
    };
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    if (activeTool === 'pan') {
      setDraggingState({
        mode: 'pan',
        startClientX: e.clientX,
        startClientY: e.clientY,
        initialX: panOffset.x,
        initialZ: panOffset.y,
      });
      return;
    }

    if (activeTool !== 'select') {
      // Place a new element at clicked world coordinates
      const coords = clientToWorldCoords(e.clientX, e.clientY);
      const toolSpec = ELEMENT_PALETTE.find((t) => t.type === activeTool)!;
      const count =
        draftEnv.elements.filter((el) => el.type === activeTool).length + 1;
      const newId = `el-${activeTool}-${Date.now().toString().slice(-4)}`;
      const newElement: MapElement2D = {
        id: newId,
        type: activeTool,
        name: `${toolSpec.label} #${count}`,
        floor: activeTool === 'elevator_shaft' ? 0 : activeFloor,
        x: coords.x,
        z: coords.z,
        width: toolSpec.defaultW || 4,
        depth: toolSpec.defaultD || 4,
        height:
          activeTool === 'room'
            ? 6
            : activeTool === 'wall'
            ? 3.8
            : undefined,
        color: toolSpec.color,
        code:
          activeTool === 'delivery_destination'
            ? `DST-${count}`
            : activeTool === 'start_point'
            ? `STR-${count}`
            : activeTool === 'charging_station'
            ? `CHG-${count}`
            : undefined,
        priority: 'Standard',
        floorsServed:
          activeTool === 'elevator_shaft'
            ? draftEnv.floors.map((f) => f.floor)
            : undefined,
      };

      const nextEnv = syncEnvironmentDerivedStructures({
        ...draftEnv,
        elements: [...draftEnv.elements, newElement],
      });
      setDraftEnv(nextEnv);
      setSelectedElementId(newId);
      setActiveTool('select');
      return;
    }

    // Clicked empty background in select mode
    if (e.target === svgRef.current) {
      setSelectedElementId(null);
    }
  };

  const handleElementMouseDown = (
    e: React.MouseEvent,
    el: MapElement2D
  ) => {
    e.stopPropagation();
    if (activeTool === 'pan') return;
    setSelectedElementId(el.id);
    setDraggingState({
      mode: 'element',
      elementId: el.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      initialX: el.x,
      initialZ: el.z,
    });
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!draggingState || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const viewW = draftEnv.widthM / zoom;
    const viewD = draftEnv.depthM / zoom;
    const deltaWorldX = ((e.clientX - draggingState.startClientX) / rect.width) * viewW;
    const deltaWorldZ = ((e.clientY - draggingState.startClientY) / rect.height) * viewD;

    if (draggingState.mode === 'pan') {
      setPanOffset({
        x: Number((draggingState.initialX + deltaWorldX).toFixed(1)),
        y: Number((draggingState.initialZ + deltaWorldZ).toFixed(1)),
      });
    } else if (draggingState.mode === 'element' && draggingState.elementId) {
      let nx = draggingState.initialX + deltaWorldX;
      let nz = draggingState.initialZ + deltaWorldZ;
      if (snapToGrid) {
        nx = Math.round(nx);
        nz = Math.round(nz);
      } else {
        nx = Number(nx.toFixed(1));
        nz = Number(nz.toFixed(1));
      }
      const halfW = draftEnv.widthM / 2 - 2;
      const halfD = draftEnv.depthM / 2 - 2;
      nx = Math.max(-halfW, Math.min(halfW, nx));
      nz = Math.max(-halfD, Math.min(halfD, nz));

      setDraftEnv((prev) =>
        syncEnvironmentDerivedStructures({
          ...prev,
          elements: prev.elements.map((item) =>
            item.id === draggingState.elementId
              ? { ...item, x: nx, z: nz }
              : item
          ),
        })
      );
    }
  };

  const handleCanvasMouseUp = () => {
    setDraggingState(null);
  };

  const updateSelectedElement = (patch: Partial<MapElement2D>) => {
    if (!selectedElementId) return;
    setDraftEnv((prev) =>
      syncEnvironmentDerivedStructures({
        ...prev,
        elements: prev.elements.map((el) =>
          el.id === selectedElementId ? { ...el, ...patch } : el
        ),
      })
    );
  };

  const deleteSelectedElement = () => {
    if (!selectedElementId) return;
    setDraftEnv((prev) =>
      syncEnvironmentDerivedStructures({
        ...prev,
        elements: prev.elements.filter((el) => el.id !== selectedElementId),
      })
    );
    setSelectedElementId(null);
  };

  const handleAddFloor = () => {
    if (draftEnv.floors.length >= 3) return;
    const nextFloorNum = draftEnv.floors.length;
    const nextHeight = Number((nextFloorNum * 3.6).toFixed(1));
    setDraftEnv((prev) => ({
      ...prev,
      floors: [
        ...prev.floors,
        {
          floor: nextFloorNum,
          label: `Floor ${nextFloorNum} (${nextHeight}m)`,
          heightM: nextHeight,
        },
      ],
    }));
    setActiveFloor(nextFloorNum);
  };

  const refreshEnvironmentLocalFiles = useCallback(
    async (env: EnvironmentDefinition) => {
      const files = await localEnvironmentFileStorage.listFilesForEnvironment(
        env.id,
        user?.uid
      );
      // Merge with any references saved in env.importedMap.localAssets
      const byId = new Map<string, LocalEnvironmentFileRef>();
      for (const f of files) {
        byId.set(f.localFileId, f);
      }
      if (env.importedMap?.localFileRef) {
        if (!byId.has(env.importedMap.localFileRef.localFileId)) {
          byId.set(
            env.importedMap.localFileRef.localFileId,
            env.importedMap.localFileRef
          );
        }
      }
      if (Array.isArray(env.importedMap?.localAssets)) {
        for (const asset of env.importedMap.localAssets) {
          if (asset && asset.localFileId && !byId.has(asset.localFileId)) {
            byId.set(asset.localFileId, asset);
          }
        }
      }
      setEnvLocalFiles(Array.from(byId.values()));

      const primaryRef = env.importedMap?.localFileRef;
      if (!primaryRef) {
        setLocalFileResolution(null);
        return;
      }

      const resolved = await localEnvironmentFileStorage.getFile(
        primaryRef,
        user?.uid
      );
      setLocalFileResolution(resolved);

      if (resolved.status === 'available') {
        if (resolved.dataUrl && !env.importedMap?.imageDataUrl) {
          setDraftEnv((prev) => {
            if (prev.id !== env.id || !prev.importedMap) return prev;
            return {
              ...prev,
              importedMap: {
                ...prev.importedMap,
                imageDataUrl: resolved.dataUrl,
              },
            };
          });
        } else if (resolved.objectUrl && !env.importedMap?.modelDataUrl) {
          setDraftEnv((prev) => {
            if (prev.id !== env.id || !prev.importedMap) return prev;
            return {
              ...prev,
              importedMap: {
                ...prev.importedMap,
                modelDataUrl: resolved.objectUrl,
              },
            };
          });
        }
      }
    },
    [user?.uid]
  );

  useEffect(() => {
    void refreshEnvironmentLocalFiles(draftEnv);
  }, [
    draftEnv.id,
    draftEnv.importedMap?.localFileRef?.localFileId,
    refreshEnvironmentLocalFiles,
  ]);

  // File Import Handlers (Backed by Browser IndexedDB on Firebase Spark Plan)
  const handleFloorplanFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorBanner(null);

    const category =
      importTab === 'ros' ? 'ros-occupancy-image' : 'floorplan-image';
    const validation = localEnvironmentFileStorage.validateFile(file, category);
    if (!validation.valid) {
      setErrorBanner(validation.error || 'Invalid floor plan image file.');
      return;
    }

    try {
      const saved = await localEnvironmentFileStorage.saveFile({
        file,
        category,
        environmentId: draftEnv.id,
        ownerUid: user?.uid ?? 'local-workspace',
      });

      const dataUrl = saved.dataUrl || '';
      let extractedWalls: MapElement2D[] = [];
      if (autoExtractDarkWalls && dataUrl) {
        extractedWalls = await extractWallsFromFloorplanImage(
          dataUrl,
          calibratedWidthM,
          calibratedDepthM
        );
      }

      const existingAssets = draftEnv.importedMap?.localAssets ?? [];
      const updatedAssets = [
        saved.ref,
        ...existingAssets.filter((a) => a.localFileId !== saved.ref.localFileId),
      ];

      const nextEnv = syncEnvironmentDerivedStructures({
        ...draftEnv,
        widthM: calibratedWidthM,
        depthM: calibratedDepthM,
        importedMap: {
          ...draftEnv.importedMap,
          sourceType:
            importTab === 'ros' ? 'ros-occupancy' : 'floorplan-image',
          fileName: file.name,
          importedAt: new Date().toISOString(),
          imageDataUrl: dataUrl,
          metersPerPixel: Number((calibratedWidthM / 1000).toFixed(4)),
          localFileRef: saved.ref,
          localAssets: updatedAssets,
        },
        elements: [
          ...draftEnv.elements.filter((el) => !el.id.startsWith('imp-wall-')),
          ...extractedWalls,
        ],
      });
      setDraftEnv(nextEnv);
      saveEnvironmentProfile(nextEnv);
      setLocalFileResolution(saved);
      await refreshEnvironmentLocalFiles(nextEnv);
      setShowImportModal(false);
      setStatusBanner(
        `Saved "${file.name}" (${formatBytes(
          saved.ref.sizeBytes
        )}) to Browser IndexedDB and overlaid on "${nextEnv.name}" (${calibratedWidthM}m × ${calibratedDepthM}m)${
          extractedWalls.length > 0
            ? ` with ${extractedWalls.length} extracted wall segments.`
            : '.'
        }`
      );
    } catch (err) {
      setErrorBanner(
        err instanceof Error
          ? err.message
          : 'Failed to store floor plan in IndexedDB.'
      );
    }
  };

  const handleRosYamlFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorBanner(null);

    const validation = localEnvironmentFileStorage.validateFile(
      file,
      'ros-yaml'
    );
    if (!validation.valid) {
      setErrorBanner(validation.error || 'Invalid ROS YAML file.');
      return;
    }

    try {
      const saved = await localEnvironmentFileStorage.saveFile({
        file,
        category: 'ros-yaml',
        environmentId: draftEnv.id,
        ownerUid: user?.uid ?? 'local-workspace',
      });
      const text = saved.textContent || (await file.text());
      setRosYamlText(text);
      const existingAssets = draftEnv.importedMap?.localAssets ?? [];
      setDraftEnv((prev) => ({
        ...prev,
        importedMap: {
          sourceType: 'ros-occupancy',
          fileName: file.name,
          importedAt: new Date().toISOString(),
          ...prev.importedMap,
          rosYamlContent: text,
          localAssets: [
            saved.ref,
            ...existingAssets.filter(
              (a) => a.localFileId !== saved.ref.localFileId
            ),
          ],
        },
      }));
      await refreshEnvironmentLocalFiles(draftEnv);
      setStatusBanner(
        `Loaded ROS YAML file "${file.name}" and saved in Browser IndexedDB.`
      );
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Failed to read ROS YAML file.'
      );
    }
  };

  const handleApplyRosYaml = async () => {
    setErrorBanner(null);
    const parsed = parseRosMapYaml(rosYamlText);
    const estWidth = Math.max(
      40,
      Math.min(200, Math.round(Math.abs(parsed.origin[0]) * 2))
    );
    const estDepth = Math.max(
      40,
      Math.min(200, Math.round(Math.abs(parsed.origin[1]) * 2))
    );
    setCalibratedWidthM(estWidth);
    setCalibratedDepthM(estDepth);

    const yamlFile = new File(
      [rosYamlText],
      parsed.imageName
        ? `${parsed.imageName.replace(/\.[^.]+$/, '')}.yaml`
        : 'ros_map.yaml',
      { type: 'text/yaml' }
    );
    let yamlRef: LocalEnvironmentFileRef | undefined;
    try {
      const savedYaml = await localEnvironmentFileStorage.saveFile({
        file: yamlFile,
        category: 'ros-yaml',
        environmentId: draftEnv.id,
        ownerUid: user?.uid ?? 'local-workspace',
      });
      yamlRef = savedYaml.ref;
    } catch {
      // ignore if IndexedDB unavailable
    }

    const existingAssets = draftEnv.importedMap?.localAssets ?? [];
    const updatedAssets = yamlRef
      ? [
          yamlRef,
          ...existingAssets.filter((a) => a.localFileId !== yamlRef!.localFileId),
        ]
      : existingAssets;

    const nextEnv = syncEnvironmentDerivedStructures({
      ...draftEnv,
      widthM: estWidth,
      depthM: estDepth,
      importedMap: {
        ...draftEnv.importedMap,
        sourceType: 'ros-occupancy',
        fileName: parsed.imageName || 'ros_map.yaml',
        importedAt: new Date().toISOString(),
        rosResolution: parsed.resolution,
        occupiedThreshold: parsed.occupiedThresh,
        freeThreshold: parsed.freeThresh,
        originWorld: [parsed.origin[0], parsed.origin[1]],
        rosYamlContent: rosYamlText,
        imageDataUrl: draftEnv.importedMap?.imageDataUrl,
        localFileRef: draftEnv.importedMap?.localFileRef ?? yamlRef,
        localAssets: updatedAssets,
      },
    });
    setDraftEnv(nextEnv);
    saveEnvironmentProfile(nextEnv);
    await refreshEnvironmentLocalFiles(nextEnv);
    setStatusBanner(
      `Applied ROS YAML configuration (resolution: ${parsed.resolution}m/px, bounds: ${estWidth}m × ${estDepth}m) and stored metadata in IndexedDB.`
    );
  };

  const handleApplyGeoJson = async () => {
    setErrorBanner(null);
    const elements = parseGeoJsonToMapElements(geoJsonText);
    if (elements.length === 0) {
      setErrorBanner('No valid Polygon or Point features found in GeoJSON.');
      return;
    }

    const geoFile = new File([geoJsonText], 'imported_features.geojson', {
      type: 'application/geo+json',
    });
    let geoRef: LocalEnvironmentFileRef | undefined;
    try {
      const savedGeo = await localEnvironmentFileStorage.saveFile({
        file: geoFile,
        category: 'geojson',
        environmentId: draftEnv.id,
        ownerUid: user?.uid ?? 'local-workspace',
      });
      geoRef = savedGeo.ref;
    } catch {
      // ignore
    }

    const existingAssets = draftEnv.importedMap?.localAssets ?? [];
    const updatedAssets = geoRef
      ? [
          geoRef,
          ...existingAssets.filter((a) => a.localFileId !== geoRef!.localFileId),
        ]
      : existingAssets;

    const nextEnv = syncEnvironmentDerivedStructures({
      ...draftEnv,
      importedMap: {
        ...draftEnv.importedMap,
        sourceType: 'geojson',
        fileName: 'imported_features.geojson',
        importedAt: new Date().toISOString(),
        localFileRef: draftEnv.importedMap?.localFileRef ?? geoRef,
        localAssets: updatedAssets,
      },
      elements: [...draftEnv.elements, ...elements],
    });
    setDraftEnv(nextEnv);
    saveEnvironmentProfile(nextEnv);
    await refreshEnvironmentLocalFiles(nextEnv);
    setShowImportModal(false);
    setStatusBanner(
      `Imported ${elements.length} physical map features from GeoJSON and saved source file in Browser IndexedDB.`
    );
  };

  const handleGltfFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorBanner(null);

    const validation = localEnvironmentFileStorage.validateFile(
      file,
      'gltf-3d'
    );
    if (!validation.valid) {
      setErrorBanner(validation.error || 'Invalid GLB/GLTF file.');
      return;
    }

    try {
      const saved = await localEnvironmentFileStorage.saveFile({
        file,
        category: 'gltf-3d',
        environmentId: draftEnv.id,
        ownerUid: user?.uid ?? 'local-workspace',
      });

      const existingAssets = draftEnv.importedMap?.localAssets ?? [];
      const updatedAssets = [
        saved.ref,
        ...existingAssets.filter((a) => a.localFileId !== saved.ref.localFileId),
      ];

      const nextEnv = syncEnvironmentDerivedStructures({
        ...draftEnv,
        importedMap: {
          ...draftEnv.importedMap,
          sourceType: 'gltf-3d',
          fileName: file.name,
          importedAt: new Date().toISOString(),
          modelDataUrl: saved.objectUrl,
          localFileRef: saved.ref,
          localAssets: updatedAssets,
        },
      });
      setDraftEnv(nextEnv);
      saveEnvironmentProfile(nextEnv);
      setLocalFileResolution(saved);
      await refreshEnvironmentLocalFiles(nextEnv);
      setShowImportModal(false);
      setStatusBanner(
        `Saved 3D asset "${file.name}" (${formatBytes(
          saved.ref.sizeBytes
        )}) in Browser IndexedDB and linked to "${nextEnv.name}".`
      );
    } catch (err) {
      setErrorBanner(
        err instanceof Error
          ? err.message
          : 'Failed to store GLB/GLTF asset in IndexedDB.'
      );
    }
  };

  const handleDownloadLocalAsset = async (ref: LocalEnvironmentFileRef) => {
    setErrorBanner(null);
    const resolved = await localEnvironmentFileStorage.getFile(ref, user?.uid);
    if (resolved.status !== 'available' || !resolved.blob) {
      setErrorBanner(resolved.message);
      return;
    }
    const url = URL.createObjectURL(resolved.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = ref.fileName;
    a.click();
    URL.revokeObjectURL(url);
    setStatusBanner(
      `Retrieved and downloaded "${ref.fileName}" (${formatBytes(
        ref.sizeBytes
      )}) from Browser IndexedDB.`
    );
  };

  const handleDeleteLocalAsset = async (ref: LocalEnvironmentFileRef) => {
    await localEnvironmentFileStorage.deleteFile(ref.localFileId);
    const isPrimary =
      draftEnv.importedMap?.localFileRef?.localFileId === ref.localFileId;
    const remainingAssets = (draftEnv.importedMap?.localAssets ?? []).filter(
      (a) => a.localFileId !== ref.localFileId
    );
    const nextEnv = syncEnvironmentDerivedStructures({
      ...draftEnv,
      importedMap: draftEnv.importedMap
        ? {
            ...draftEnv.importedMap,
            imageDataUrl: isPrimary
              ? undefined
              : draftEnv.importedMap.imageDataUrl,
            modelDataUrl: isPrimary
              ? undefined
              : draftEnv.importedMap.modelDataUrl,
            localFileRef: isPrimary
              ? remainingAssets[0]
              : draftEnv.importedMap.localFileRef,
            localAssets: remainingAssets,
          }
        : undefined,
    });
    setDraftEnv(nextEnv);
    saveEnvironmentProfile(nextEnv);
    await refreshEnvironmentLocalFiles(nextEnv);
    setStatusBanner(
      `Deleted "${ref.fileName}" from Browser IndexedDB and updated environment references.`
    );
  };

  const handleExportEnvironmentJson = () => {
    const blob = new Blob([JSON.stringify(draftEnv, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${draftEnv.id}.robosim-env.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const viewW = draftEnv.widthM / zoom;
  const viewD = draftEnv.depthM / zoom;
  const viewMinX = -viewW / 2 - panOffset.x;
  const viewMinZ = -viewD / 2 - panOffset.y;

  return (
    <div className="h-full w-full overflow-y-auto p-6 space-y-5 bg-[#070b14] text-slate-100">
      {/* Top Header & Template Bar */}
      <div className="bg-[#0b1120] border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="font-display font-bold text-lg text-slate-100">
                Environment Studio & 2D Map Editor
              </h2>
              <span className="text-xs font-mono text-cyan-400">
                v{draftEnv.version} · {draftEnv.templateType}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Select a domain template, build multi-floor 2D layouts, import floor plans / ROS / GeoJSON maps, and validate connectivity before simulation.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-cyan-400" />
              <span>Import Map (PNG / ROS / GeoJSON / GLB)</span>
            </button>

            <button
              type="button"
              onClick={handleExportEnvironmentJson}
              className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-slate-400" />
              <span>Export JSON</span>
            </button>

            <button
              type="button"
              onClick={handleDuplicateEnvironment}
              className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5 text-slate-400" />
              <span>Duplicate</span>
            </button>

            <button
              type="button"
              onClick={handleSaveDraft}
              className="px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save & Activate Environment</span>
            </button>

            <button
              type="button"
              disabled={!validationReport.canSimulate}
              onClick={() => {
                handleSaveDraft();
                onNavigate('simulation-lab');
              }}
              className="px-3.5 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Launch in Simulation Lab</span>
            </button>
          </div>
        </div>

        {/* Saved Environments Selector & Quick Template Spawner */}
        <div className="pt-3 border-t border-slate-800/80 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
          <div className="lg:col-span-5 flex items-center gap-2.5">
            <label className="text-xs font-medium text-slate-400 whitespace-nowrap">
              Active Workspace Map:
            </label>
            <select
              value={draftEnv.id}
              onChange={(e) => handleSelectEnvironment(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg bg-[#070b14] border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
            >
              {environments.map((env) => (
                <option key={env.id} value={env.id}>
                  [{env.templateType}] {env.name} (v{env.version})
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-7 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-mono uppercase text-slate-400 mr-1">
              New from Template:
            </span>
            {TEMPLATE_TYPES.map((tpl) => (
              <button
                key={tpl}
                type="button"
                onClick={() => handleCreateFromTemplate(tpl)}
                className="px-2.5 py-1.5 rounded-md bg-[#0f172a] hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-300 hover:text-cyan-300 transition-colors cursor-pointer"
              >
                + {tpl}
              </button>
            ))}
          </div>
        </div>

        {statusBanner && (
          <div className="px-3.5 py-2 rounded-lg bg-cyan-950/40 border border-cyan-500/30 text-xs text-cyan-200 flex items-center justify-between">
            <span>{statusBanner}</span>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="text-cyan-400 hover:text-cyan-200 text-xs ml-4 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {errorBanner && (
          <div className="px-3.5 py-2 rounded-lg bg-rose-950/50 border border-rose-500/40 text-xs text-rose-200 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorBanner}</span>
            </span>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="text-rose-300 hover:text-rose-100 text-xs ml-4 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {localFileResolution && localFileResolution.status !== 'available' && (
          <div className="px-3.5 py-2.5 rounded-lg bg-amber-950/40 border border-amber-500/40 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-amber-300">
                  Device-Local IndexedDB Asset Notice ({localFileResolution.ref.fileName})
                </div>
                <div className="text-[11px] text-amber-200/90 mt-0.5">
                  {localFileResolution.message}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              className="px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs cursor-pointer shrink-0"
            >
              Re-upload Local File
            </button>
          </div>
        )}
      </div>

      {/* Main 3-Column Editor Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left Column: Tool Palette & Multi-Floor Switcher */}
        <div className="xl:col-span-3 bg-[#0b1120] border border-slate-800 rounded-xl p-4 space-y-4">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              1. Floor Level Selection
            </h3>
            <div className="space-y-1.5">
              {draftEnv.floors.map((fl) => (
                <button
                  key={fl.floor}
                  type="button"
                  onClick={() => setActiveFloor(fl.floor)}
                  className={`w-full px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                    activeFloor === fl.floor
                      ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40'
                      : 'bg-[#070b14] text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5" />
                    <span>{fl.label}</span>
                  </span>
                  <span className="font-mono text-[11px]">
                    {
                      draftEnv.elements.filter(
                        (e) => (e.floor ?? 0) === fl.floor
                      ).length
                    }{' '}
                    items
                  </span>
                </button>
              ))}
              {draftEnv.floors.length < 3 && (
                <button
                  type="button"
                  onClick={handleAddFloor}
                  className="w-full py-1.5 rounded-lg border border-dashed border-slate-700 hover:border-cyan-500/50 text-xs text-slate-400 hover:text-cyan-300 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Upper Floor Level</span>
                </button>
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              2. Map Elements & Tools
            </h3>
            <p className="text-[11px] text-slate-400 mb-2.5">
              Select an element type below, then click anywhere on the 2D canvas to place it.
            </p>
            <div className="grid grid-cols-1 gap-1.5">
              {ELEMENT_PALETTE.map((item) => {
                const isSelected = activeTool === item.type;
                return (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => setActiveTool(item.type)}
                    className={`w-full px-3 py-2 rounded-lg text-left transition-colors flex items-center justify-between cursor-pointer ${
                      isSelected
                        ? 'bg-cyan-500/20 border border-cyan-400 text-slate-100'
                        : 'bg-[#070b14] hover:bg-slate-900 border border-slate-800/90 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="w-3 h-3 rounded-sm shrink-0"
                        style={{ backgroundColor: item.color }}
                      />
                      <div className="truncate">
                        <div className="text-xs font-medium leading-tight">
                          {item.label}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {item.shortDesc}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Center Column: Interactive 2D SVG Map Canvas */}
        <div className="xl:col-span-6 bg-[#0b1120] border border-slate-800 rounded-xl p-4 space-y-3">
          {/* Canvas Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-slate-200">
                2D Floor Plan Canvas ({draftEnv.widthM}m × {draftEnv.depthM}m)
              </span>
              <span className="text-slate-500">·</span>
              <span className="font-mono text-cyan-400">
                Floor {activeFloor}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowGrid(!showGrid)}
                className={`px-2.5 py-1 rounded text-xs flex items-center gap-1 border cursor-pointer ${
                  showGrid
                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                    : 'bg-slate-900 text-slate-400 border-slate-800'
                }`}
              >
                <Grid className="w-3.5 h-3.5" />
                <span>Grid</span>
              </button>
              <button
                type="button"
                onClick={() => setSnapToGrid(!snapToGrid)}
                className={`px-2.5 py-1 rounded text-xs border cursor-pointer ${
                  snapToGrid
                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                    : 'bg-slate-900 text-slate-400 border-slate-800'
                }`}
              >
                Snap 1m
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(2.5, Number((z + 0.25).toFixed(2))))}
                className="p-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 cursor-pointer"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.6, Number((z - 0.25).toFixed(2))))}
                className="p-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 cursor-pointer"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setZoom(1.0);
                  setPanOffset({ x: 0, y: 0 });
                }}
                className="p-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 cursor-pointer"
                title="Reset View"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Interactive SVG Map */}
          <div className="relative w-full aspect-square max-h-[580px] mx-auto rounded-lg overflow-hidden border border-slate-800 bg-[#050811]">
            <svg
              ref={svgRef}
              viewBox={`${viewMinX} ${viewMinZ} ${viewW} ${viewD}`}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseUp}
              className={`w-full h-full select-none ${
                activeTool === 'pan'
                  ? 'cursor-grab active:cursor-grabbing'
                  : activeTool === 'select'
                  ? 'cursor-default'
                  : 'cursor-crosshair'
              }`}
            >
              <defs>
                <pattern
                  id="env-grid-minor"
                  width="2"
                  height="2"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M 2 0 L 0 0 0 2"
                    fill="none"
                    stroke="#1e293b"
                    strokeWidth="0.08"
                  />
                </pattern>
                <pattern
                  id="env-grid-major"
                  width="10"
                  height="10"
                  patternUnits="userSpaceOnUse"
                >
                  <rect width="10" height="10" fill="url(#env-grid-minor)" />
                  <path
                    d="M 10 0 L 0 0 0 10"
                    fill="none"
                    stroke="#334155"
                    strokeWidth="0.18"
                  />
                </pattern>
              </defs>

              {/* World Bounds */}
              <rect
                x={-draftEnv.widthM / 2}
                y={-draftEnv.depthM / 2}
                width={draftEnv.widthM}
                height={draftEnv.depthM}
                fill={showGrid ? 'url(#env-grid-major)' : '#090e1a'}
                stroke="#38bdf8"
                strokeWidth="0.4"
                strokeDasharray="2 1"
              />

              {/* Optional Imported Floor-Plan Image Backdrop */}
              {draftEnv.importedMap?.imageDataUrl && (
                <image
                  href={draftEnv.importedMap.imageDataUrl}
                  x={-draftEnv.widthM / 2}
                  y={-draftEnv.depthM / 2}
                  width={draftEnv.widthM}
                  height={draftEnv.depthM}
                  opacity={0.42}
                  preserveAspectRatio="none"
                />
              )}

              {/* Coordinate Axes */}
              <line
                x1={-draftEnv.widthM / 2}
                y1={0}
                x2={draftEnv.widthM / 2}
                y2={0}
                stroke="#1e293b"
                strokeWidth="0.25"
              />
              <line
                x1={0}
                y1={-draftEnv.depthM / 2}
                x2={0}
                y2={draftEnv.depthM / 2}
                stroke="#1e293b"
                strokeWidth="0.25"
              />

              {/* Render Floor Elements */}
              {floorElements.map((el) => {
                const isSelected = el.id === selectedElementId;
                const paletteItem = ELEMENT_PALETTE.find(
                  (p) => p.type === el.type
                );
                const fill = el.color || paletteItem?.color || '#38bdf8';
                const isPointMarker =
                  el.type === 'charging_station' ||
                  el.type === 'start_point' ||
                  el.type === 'delivery_destination' ||
                  el.type === 'elevator_shaft';

                return (
                  <g
                    key={el.id}
                    onMouseDown={(e) => handleElementMouseDown(e, el)}
                    className="cursor-move"
                  >
                    <rect
                      x={el.x - el.width / 2}
                      y={el.z - el.depth / 2}
                      width={el.width}
                      height={el.depth}
                      rx={isPointMarker ? 0.8 : 0.3}
                      fill={fill}
                      fillOpacity={
                        el.type === 'corridor'
                          ? 0.22
                          : el.type === 'restricted_area'
                          ? 0.35
                          : 0.78
                      }
                      stroke={isSelected ? '#ffffff' : fill}
                      strokeWidth={isSelected ? 0.6 : 0.25}
                      strokeDasharray={
                        el.type === 'restricted_area' || el.type === 'corridor'
                          ? '1.2 0.8'
                          : undefined
                      }
                    />
                    <text
                      x={el.x}
                      y={el.z + 0.4}
                      textAnchor="middle"
                      fill="#f8fafc"
                      fontSize={isPointMarker ? '1.6' : '1.9'}
                      fontWeight="600"
                      className="pointer-events-none font-mono"
                    >
                      {el.code || el.name.slice(0, 14)}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Bottom Overlay Helper */}
            <div className="absolute bottom-2.5 left-3 right-3 px-3 py-1.5 rounded bg-slate-950/85 border border-slate-800/90 flex items-center justify-between text-[11px] text-slate-300 pointer-events-none">
              <span>
                Mode:{' '}
                <strong className="text-cyan-400 uppercase">{activeTool}</strong>{' '}
                {activeTool === 'select'
                  ? '— Click any room, wall, or station to inspect or drag to move'
                  : activeTool === 'pan'
                  ? '— Drag canvas to pan'
                  : '— Click on map to place new element'}
              </span>
              <span className="font-mono text-slate-400">
                Zoom: {(zoom * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        </div>

        {/* Right Column: Element Inspector & Live Environment Validation */}
        <div className="xl:col-span-3 space-y-4">
          {/* Selected Element Inspector */}
          <div className="bg-[#0b1120] border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                3. Element Inspector
              </h3>
              {selectedElement && (
                <button
                  type="button"
                  onClick={deleteSelectedElement}
                  className="px-2 py-1 rounded bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-500/30 text-[11px] flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Delete</span>
                </button>
              )}
            </div>

            {selectedElement ? (
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">
                    Element Name
                  </label>
                  <input
                    type="text"
                    value={selectedElement.name}
                    onChange={(e) =>
                      updateSelectedElement({ name: e.target.value })
                    }
                    className="w-full px-2.5 py-1.5 rounded bg-[#070b14] border border-slate-700 text-slate-100"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-400 mb-1">
                      Center X (m)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      value={selectedElement.x}
                      onChange={(e) =>
                        updateSelectedElement({
                          x: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded bg-[#070b14] border border-slate-700 text-slate-100 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">
                      Center Z (m)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      value={selectedElement.z}
                      onChange={(e) =>
                        updateSelectedElement({
                          z: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded bg-[#070b14] border border-slate-700 text-slate-100 font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-400 mb-1">
                      Width (m)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="80"
                      step="0.5"
                      value={selectedElement.width}
                      onChange={(e) =>
                        updateSelectedElement({
                          width: Math.max(1, parseFloat(e.target.value) || 2),
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded bg-[#070b14] border border-slate-700 text-slate-100 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">
                      Depth (m)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="80"
                      step="0.5"
                      value={selectedElement.depth}
                      onChange={(e) =>
                        updateSelectedElement({
                          depth: Math.max(1, parseFloat(e.target.value) || 2),
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded bg-[#070b14] border border-slate-700 text-slate-100 font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-400 mb-1">
                      Floor Level
                    </label>
                    <select
                      value={selectedElement.floor}
                      onChange={(e) =>
                        updateSelectedElement({
                          floor: parseInt(e.target.value, 10) || 0,
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded bg-[#070b14] border border-slate-700 text-slate-100"
                    >
                      {draftEnv.floors.map((f) => (
                        <option key={f.floor} value={f.floor}>
                          Floor {f.floor}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">
                      Station Code
                    </label>
                    <input
                      type="text"
                      value={selectedElement.code || ''}
                      onChange={(e) =>
                        updateSelectedElement({ code: e.target.value })
                      }
                      placeholder="LOC-01"
                      className="w-full px-2.5 py-1.5 rounded bg-[#070b14] border border-slate-700 text-slate-100 font-mono"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-4 text-xs text-slate-400 space-y-2">
                <p>
                  Click any element on the 2D canvas to edit its coordinates, dimensions, floor assignment, or station code.
                </p>
                <div className="pt-2 border-t border-slate-800 space-y-2">
                  <label className="block text-slate-400">
                    Environment Name
                  </label>
                  <input
                    type="text"
                    value={draftEnv.name}
                    onChange={(e) =>
                      setDraftEnv((prev) => ({ ...prev, name: e.target.value }))
                    }
                    className="w-full px-2.5 py-1.5 rounded bg-[#070b14] border border-slate-700 text-slate-100"
                  />
                  {draftEnv.isBuiltIn && (
                    <button
                      type="button"
                      onClick={handleResetBuiltIn}
                      className="text-[11px] text-amber-400 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Reset built-in template to factory defaults</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Environment Validation Panel */}
          <div className="bg-[#0b1120] border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                4. Pre-Simulation Validation
              </h3>
              <span
                className={`text-xs font-mono font-semibold flex items-center gap-1 ${
                  validationReport.canSimulate
                    ? 'text-emerald-400'
                    : 'text-rose-400'
                }`}
              >
                {validationReport.canSimulate ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Sim Ready</span>
                  </>
                ) : (
                  <>
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>Fix Required</span>
                  </>
                )}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded bg-[#070b14] border border-slate-800">
                <div className="text-[11px] text-slate-400">Walkable Area</div>
                <div className="font-mono font-semibold text-sm text-cyan-400 tabular-nums">
                  {validationReport.walkableCoveragePct}%
                </div>
              </div>
              <div className="p-2.5 rounded bg-[#070b14] border border-slate-800">
                <div className="text-[11px] text-slate-400">
                  Connected Destinations
                </div>
                <div className="font-mono font-semibold text-sm text-emerald-400 tabular-nums">
                  {validationReport.reachableDestinationsCount} /{' '}
                  {validationReport.totalDestinationsCount}
                </div>
              </div>
            </div>

            {validationReport.issues.length === 0 ? (
              <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-xs text-emerald-200">
                All 6 validation checks passed (Scale, Walls, Walkable Coverage, Start/Destination Placement, A* Connectivity, and Multi-Floor Elevators).
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {validationReport.issues.map((issue) => (
                  <div
                    key={issue.id}
                    className={`p-2.5 rounded-lg border text-xs space-y-1 ${
                      issue.severity === 'error'
                        ? 'bg-rose-950/40 border-rose-500/40 text-rose-200'
                        : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                    }`}
                  >
                    <div className="font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{issue.category}</span>
                    </div>
                    <p className="text-[11px] leading-relaxed">{issue.message}</p>
                    {issue.suggestion && (
                      <p className="text-[11px] text-slate-300 font-mono">
                        Fix: {issue.suggestion}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 5. Local Asset Files (IndexedDB · Firebase Spark Plan) */}
          <div className="bg-[#0b1120] border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-cyan-400" />
                <span>5. Local Asset Files (IndexedDB)</span>
              </h3>
              <span className="px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30 font-mono text-[10px] text-cyan-300">
                Spark Plan · Device-Local
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-[#070b14] border border-slate-800/90 text-[11px] text-slate-400 leading-relaxed">
              Uploaded binary files (<strong className="text-slate-200">PNG/JPG floor plans, ROS occupancy maps, GLB/GLTF 3D meshes</strong>) are stored locally in this browser&apos;s{' '}
              <strong className="text-cyan-300">IndexedDB</strong> so your project stays 100% free on the Firebase Spark plan. Environment geometry &amp; file references sync to Firestore, while binary blobs remain specific to this browser/device.
            </div>

            {envLocalFiles.length === 0 ? (
              <div className="text-xs text-slate-500 py-2 text-center border border-dashed border-slate-800 rounded-lg">
                No local binary files attached to &ldquo;{draftEnv.name}&rdquo; yet.
              </div>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto">
                {envLocalFiles.map((fileRef) => {
                  const isMissing =
                    localFileResolution?.ref.localFileId ===
                      fileRef.localFileId &&
                    localFileResolution.status !== 'available';
                  return (
                    <div
                      key={fileRef.localFileId}
                      className="p-2.5 rounded-lg bg-[#070b14] border border-slate-800 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div
                          className="font-medium text-slate-200 truncate"
                          title={fileRef.fileName}
                        >
                          {fileRef.fileName}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono flex items-center gap-2 mt-0.5">
                          <span>{fileRef.category}</span>
                          <span>·</span>
                          <span>{formatBytes(fileRef.sizeBytes)}</span>
                          <span>·</span>
                          <span
                            className={
                              isMissing ? 'text-amber-400' : 'text-emerald-400'
                            }
                          >
                            {isMissing
                              ? 'Missing on this device'
                              : 'Stored in IndexedDB'}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => void handleDownloadLocalAsset(fileRef)}
                          title="Retrieve & download file from IndexedDB"
                          className="p-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-cyan-300 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteLocalAsset(fileRef)}
                          title="Delete file from IndexedDB"
                          className="p-1.5 rounded bg-slate-900 hover:bg-rose-950 border border-slate-700 text-rose-300 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Map Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-[#0b1120] border border-slate-700 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-display font-bold text-base text-slate-100">
                  Import External Map or 3D Asset
                </h3>
                <p className="text-xs text-slate-400">
                  Calibrate scale and convert external maps into validated navigable elements.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-4 gap-2 p-1 rounded-lg bg-[#070b14] border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setImportTab('floorplan')}
                className={`py-2 rounded font-semibold cursor-pointer ${
                  importTab === 'floorplan'
                    ? 'bg-cyan-500 text-slate-950'
                    : 'text-slate-400'
                }`}
              >
                Floor Plan (PNG/JPG)
              </button>
              <button
                type="button"
                onClick={() => setImportTab('ros')}
                className={`py-2 rounded font-semibold cursor-pointer ${
                  importTab === 'ros'
                    ? 'bg-cyan-500 text-slate-950'
                    : 'text-slate-400'
                }`}
              >
                ROS YAML + Map
              </button>
              <button
                type="button"
                onClick={() => setImportTab('geojson')}
                className={`py-2 rounded font-semibold cursor-pointer ${
                  importTab === 'geojson'
                    ? 'bg-cyan-500 text-slate-950'
                    : 'text-slate-400'
                }`}
              >
                GeoJSON
              </button>
              <button
                type="button"
                onClick={() => setImportTab('gltf')}
                className={`py-2 rounded font-semibold cursor-pointer ${
                  importTab === 'gltf'
                    ? 'bg-cyan-500 text-slate-950'
                    : 'text-slate-400'
                }`}
              >
                GLB / GLTF 3D
              </button>
            </div>

            {importTab === 'floorplan' && (
              <div className="space-y-4 text-xs">
                <p className="text-slate-300">
                  Upload a PNG or JPG architectural floor plan. Calibrate the physical width/depth in meters; RoboSim AI will overlay the floor plan on the 2D canvas and optionally extract high-contrast dark walls into physical collision blocks.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-400 mb-1">
                      Calibrated World Width (m)
                    </label>
                    <input
                      type="number"
                      min="40"
                      max="250"
                      value={calibratedWidthM}
                      onChange={(e) =>
                        setCalibratedWidthM(parseInt(e.target.value, 10) || 100)
                      }
                      className="w-full px-3 py-2 rounded bg-[#070b14] border border-slate-700 text-slate-100 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">
                      Calibrated World Depth (m)
                    </label>
                    <input
                      type="number"
                      min="40"
                      max="250"
                      value={calibratedDepthM}
                      onChange={(e) =>
                        setCalibratedDepthM(parseInt(e.target.value, 10) || 100)
                      }
                      className="w-full px-3 py-2 rounded bg-[#070b14] border border-slate-700 text-slate-100 font-mono"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoExtractDarkWalls}
                    onChange={(e) => setAutoExtractDarkWalls(e.target.checked)}
                  />
                  <span>
                    Auto-extract dark structural walls from image luminance into 3D/2D obstacles
                  </span>
                </label>
                <label className="block w-full py-6 border-2 border-dashed border-slate-700 hover:border-cyan-500 rounded-xl text-center cursor-pointer">
                  <FileUp className="w-6 h-6 text-cyan-400 mx-auto mb-1.5" />
                  <span className="font-semibold text-slate-200">
                    Select PNG / JPG Floor Plan Image
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleFloorplanFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            )}

            {importTab === 'ros' && (
              <div className="space-y-3 text-xs">
                <p className="text-slate-300">
                  Paste or edit your ROS <code className="font-mono text-cyan-300">map.yaml</code> metadata below and optionally attach the occupancy grid image:
                </p>
                <textarea
                  rows={6}
                  value={rosYamlText}
                  onChange={(e) => setRosYamlText(e.target.value)}
                  className="w-full p-3 rounded bg-[#070b14] border border-slate-700 font-mono text-xs text-slate-100"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => void handleApplyRosYaml()}
                    className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold cursor-pointer"
                  >
                    Parse &amp; Apply ROS YAML Metadata
                  </button>
                  <div className="flex items-center gap-2">
                    <label className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer">
                      <span>Upload .YAML File</span>
                      <input
                        type="file"
                        accept=".yaml,.yml,.txt"
                        onChange={handleRosYamlFileUpload}
                        className="hidden"
                      />
                    </label>
                    <label className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer">
                      <span>Attach Occupancy Image (PNG/PGM)</span>
                      <input
                        type="file"
                        accept="image/*,.pgm"
                        onChange={handleFloorplanFileUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}

            {importTab === 'geojson' && (
              <div className="space-y-3 text-xs">
                <p className="text-slate-300">
                  Paste GeoJSON <code className="font-mono text-cyan-300">FeatureCollection</code> containing Polygon rooms/walls/obstacles and Point stations:
                </p>
                <textarea
                  rows={8}
                  value={geoJsonText}
                  onChange={(e) => setGeoJsonText(e.target.value)}
                  className="w-full p-3 rounded bg-[#070b14] border border-slate-700 font-mono text-xs text-slate-100"
                />
                <button
                  type="button"
                  onClick={handleApplyGeoJson}
                  className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold cursor-pointer"
                >
                  Import GeoJSON Features into Map
                </button>
              </div>
            )}

            {importTab === 'gltf' && (
              <div className="space-y-3 text-xs">
                <p className="text-slate-300">
                  Attach a <code className="font-mono text-cyan-300">.glb</code> or <code className="font-mono text-cyan-300">.gltf</code> 3D environment mesh. Use the 2D Map Editor to define walkable corridors, walls, and delivery destinations matching your 3D asset.
                </p>
                <label className="block w-full py-6 border-2 border-dashed border-slate-700 hover:border-cyan-500 rounded-xl text-center cursor-pointer">
                  <FileUp className="w-6 h-6 text-cyan-400 mx-auto mb-1.5" />
                  <span className="font-semibold text-slate-200">
                    Select .GLB or .GLTF 3D File
                  </span>
                  <input
                    type="file"
                    accept=".glb,.gltf"
                    onChange={handleGltfFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
