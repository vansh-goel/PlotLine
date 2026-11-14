"use client";

import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import type { ChainPiece } from "@/lib/contract";
import { PALETTE, occupiedVoxels, validatePlacement, type Placement, type Voxel } from "@/lib/plot";

const SAMPLE: Placement[] = [
  { shape: 3, rotation: 0, x: 3, y: 0, z: 5, color: 0 },
  { shape: 2, rotation: 0, x: 5, y: 0, z: 5, color: 2 },
  { shape: 1, rotation: 1, x: 5, y: 1, z: 5, color: 3 },
  { shape: 0, rotation: 0, x: 6, y: 1, z: 6, color: 1 },
];

function Cell({ voxel, color, size, ghost = false }: { voxel: Voxel; color: string; size: { x: number; z: number }; ghost?: boolean }) {
  return (
    <group position={[voxel.x - size.x / 2 + 0.5, voxel.y + 0.42, voxel.z - size.z / 2 + 0.5]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.94, 0.8, 0.94]} />
        <meshStandardMaterial color={color} transparent={ghost} opacity={ghost ? 0.62 : 1} roughness={0.28} metalness={0.02} />
      </mesh>
      <mesh castShadow position={[0, 0.47, 0]}>
        <cylinderGeometry args={[0.2, 0.2, 0.14, 24]} />
        <meshStandardMaterial color={color} transparent={ghost} opacity={ghost ? 0.62 : 1} roughness={0.25} />
      </mesh>
    </group>
  );
}

export default function PlotScene({
  selected,
  rotation,
  color,
  pieces,
  size,
  onPlacementChange,
}: {
  selected: number;
  rotation: number;
  color: number;
  pieces: ChainPiece[] | null;
  size: { x: number; y: number; z: number };
  onPlacementChange: (placement: Placement, valid: boolean, reason?: string) => void;
}) {
  const placements = pieces?.map((piece) => piece.placement) ?? SAMPLE;
  const occupied = useMemo(() => placements.flatMap(occupiedVoxels), [placements]);
  const [origin, setOrigin] = useState({ x: 1, y: 0, z: 1 });
  const ghost = { ...origin, shape: selected, rotation, color };
  const verdict = validatePlacement(ghost, size, occupied);

  useEffect(() => {
    onPlacementChange(ghost, verdict.valid, verdict.reason);
  }, [color, onPlacementChange, origin.x, origin.y, origin.z, rotation, selected, verdict.reason, verdict.valid]);

  const moveGhost = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    setOrigin({
      x: Math.max(0, Math.min(size.x - 1, Math.floor(event.point.x + size.x / 2))),
      y: 0,
      z: Math.max(0, Math.min(size.z - 1, Math.floor(event.point.z + size.z / 2))),
    });
  };

  return (
    <Canvas camera={{ position: [11, 11, 13], fov: 38 }} shadows dpr={[1, 1.75]}>
      <color attach="background" args={["#dcd5c3"]} />
      <ambientLight intensity={1.7} />
      <directionalLight castShadow intensity={2.5} position={[6, 12, 8]} shadow-mapSize={[1024, 1024]} />
      <mesh receiveShadow position={[0, -0.08, 0]} onPointerMove={moveGhost}>
        <boxGeometry args={[size.x + 0.5, 0.16, size.z + 0.5]} />
        <meshStandardMaterial color="#496f4d" roughness={0.78} />
      </mesh>
      <gridHelper args={[Math.max(size.x, size.z), Math.max(size.x, size.z), "#dae2cf", "#739071"]} position={[0, 0.01, 0]} />
      {placements.flatMap((piece, pieceIndex) =>
        occupiedVoxels(piece).map((voxel, voxelIndex) => (
          <Cell key={`${pieceIndex}-${voxelIndex}`} voxel={voxel} color={PALETTE[piece.color]} size={size} />
        )),
      )}
      {occupiedVoxels(ghost).map((voxel, index) => (
        <Cell key={`ghost-${index}`} voxel={voxel} color={verdict.valid ? "#e85d2a" : "#b63d32"} size={size} ghost />
      ))}
      <ContactShadows opacity={0.28} scale={18} blur={2.5} far={8} />
      <OrbitControls makeDefault minDistance={9} maxDistance={28} maxPolarAngle={Math.PI / 2.15} target={[0, 1, 0]} />
    </Canvas>
  );
}
