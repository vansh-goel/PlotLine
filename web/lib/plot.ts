export type Voxel = { x: number; y: number; z: number };
export type PlotSize = { x: number; y: number; z: number };
export type Placement = Voxel & { shape: number; rotation: number; color: number };

export const SHAPES = [
  { id: 0, name: "1 × 1", offsets: [[0, 0, 0]] },
  { id: 1, name: "1 × 2", offsets: [[0, 0, 0], [1, 0, 0]] },
  { id: 2, name: "2 × 2", offsets: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]] },
  {
    id: 3,
    name: "2 × 4",
    offsets: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [0, 0, 1], [1, 0, 1], [2, 0, 1], [3, 0, 1]],
  },
  { id: 4, name: "Cylinder", offsets: [[0, 0, 0]] },
  { id: 5, name: "Slope", offsets: [[0, 0, 0]] },
  { id: 6, name: "Hook", offsets: [[0, 0, 0]] },
  { id: 7, name: "Rotor", offsets: [[0, 0, 0]] },
] as const;

export const PALETTE = [
  "#e5522e", "#f0b429", "#207a55", "#2573d9", "#6f4fc8", "#e988b4", "#efe8d8", "#252821",
  "#8c593d", "#77b9dd", "#89a94f", "#d8d0b7", "#f57b20", "#a7a9a3", "#7b3434", "#3c5268",
] as const;

export const THEMES = [
  "Creature from the canopy",
  "A machine that gardens",
  "Sky harbor at dusk",
  "Tiny monument to rain",
  "Deep-sea courier",
  "Ruins with a heartbeat",
  "Neighborhood on wheels",
] as const;

export const themeForDay = (day: number) => THEMES[((day % THEMES.length) + THEMES.length) % THEMES.length];

const rotate = ([x, y, z]: readonly number[], rotation: number): Voxel => {
  if (rotation === 1) return { x: z, y, z: -x };
  if (rotation === 2) return { x: -x, y, z: -z };
  if (rotation === 3) return { x: -z, y, z: x };
  return { x, y, z };
};

export function occupiedVoxels(placement: Placement): Voxel[] {
  const shape = SHAPES.find((candidate) => candidate.id === placement.shape);
  if (!shape || placement.rotation < 0 || placement.rotation > 3) return [];
  const rotated = shape.offsets.map((offset) => rotate(offset, placement.rotation));
  const minX = Math.min(...rotated.map((voxel) => voxel.x));
  const minZ = Math.min(...rotated.map((voxel) => voxel.z));
  return rotated.map((voxel) => ({
    x: placement.x + voxel.x - minX,
    y: placement.y + voxel.y,
    z: placement.z + voxel.z - minZ,
  }));
}

export function snapWorldPoint(point: Voxel, surfaceNormal: Voxel, size: PlotSize): Voxel {
  const axes = ["x", "y", "z"] as const;
  const axis = axes.reduce((largest, candidate) =>
    Math.abs(surfaceNormal[candidate]) > Math.abs(surfaceNormal[largest]) ? candidate : largest,
  );
  const offset = { x: 0, y: 0, z: 0 };
  offset[axis] = Math.sign(surfaceNormal[axis]) * 0.22;

  return {
    x: Math.max(0, Math.min(size.x - 1, Math.floor(point.x + offset.x + size.x / 2))),
    y: Math.max(0, Math.min(size.y - 1, Math.floor(point.y + offset.y))),
    z: Math.max(0, Math.min(size.z - 1, Math.floor(point.z + offset.z + size.z / 2))),
  };
}

const key = ({ x, y, z }: Voxel) => `${x}:${y}:${z}`;

export function validatePlacement(
  placement: Placement,
  size: PlotSize,
  occupied: readonly Voxel[],
): { valid: boolean; reason?: string } {
  if (!SHAPES.some((shape) => shape.id === placement.shape)) return { valid: false, reason: "Unknown shape" };
  if (placement.rotation < 0 || placement.rotation > 3) return { valid: false, reason: "Invalid rotation" };
  if (placement.color < 0 || placement.color >= PALETTE.length) return { valid: false, reason: "Invalid color" };

  const voxels = occupiedVoxels(placement);
  if (voxels.some(({ x, y, z }) => x < 0 || y < 0 || z < 0 || x >= size.x || y >= size.y || z >= size.z)) {
    return { valid: false, reason: "Outside the plot" };
  }

  const occupiedKeys = new Set(occupied.map(key));
  if (voxels.some((voxel) => occupiedKeys.has(key(voxel)))) return { valid: false, reason: "Space is occupied" };

  const supported = voxels.some((voxel) =>
    voxel.y === 0 || occupiedKeys.has(key({ ...voxel, y: voxel.y - 1 })) || occupiedKeys.has(key({ ...voxel, y: voxel.y + 1 })),
  );
  return supported ? { valid: true } : { valid: false, reason: "Needs vertical support" };
}
