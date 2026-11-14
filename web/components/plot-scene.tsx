"use client";

import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { ChainPiece } from "@/lib/contract";
import { PALETTE, occupiedVoxels, snapWorldPoint, validatePlacement, type Placement, type Voxel } from "@/lib/plot";

const SAMPLE: Placement[] = [
  { shape: 3, rotation: 0, x: 3, y: 0, z: 5, color: 0 },
  { shape: 2, rotation: 0, x: 5, y: 0, z: 5, color: 2 },
  { shape: 1, rotation: 1, x: 5, y: 1, z: 5, color: 3 },
  { shape: 0, rotation: 0, x: 6, y: 1, z: 6, color: 1 },
  { shape: 4, rotation: 0, x: 8, y: 0, z: 5, color: 4 },
  { shape: 5, rotation: 0, x: 8, y: 0, z: 7, color: 5 },
];

const wedgeGeometry = new THREE.BufferGeometry();
wedgeGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
  -0.47, 0, -0.47, 0.47, 0, -0.47, 0.47, 0, 0.47, -0.47, 0, 0.47,
  -0.47, 0.12, -0.47, 0.47, 0.8, -0.47, 0.47, 0.8, 0.47, -0.47, 0.12, 0.47,
]), 3));
wedgeGeometry.setIndex([
  0, 2, 1, 0, 3, 2,
  0, 1, 5, 0, 5, 4,
  1, 2, 6, 1, 6, 5,
  2, 3, 7, 2, 7, 6,
  3, 0, 4, 3, 4, 7,
  4, 5, 6, 4, 6, 7,
]);
wedgeGeometry.computeVertexNormals();

type CellProps = {
  voxel: Voxel;
  color: string;
  size: { x: number; z: number };
  shape: number;
  rotation: number;
  ghost?: boolean;
  valid?: boolean;
  onSurface?: (event: ThreeEvent<PointerEvent>) => void;
};

function Material({ color, ghost, valid }: Pick<CellProps, "color" | "ghost" | "valid">) {
  return (
    <meshStandardMaterial
      color={color}
      emissive={ghost ? (valid ? "#16824a" : "#b52d27") : "#000000"}
      emissiveIntensity={ghost ? 0.42 : 0}
      transparent={ghost}
      opacity={ghost ? 0.68 : 1}
      roughness={0.28}
      metalness={0.02}
    />
  );
}

function Cell({ voxel, color, size, shape, rotation, ghost = false, valid, onSurface }: CellProps) {
  const interactive = ghost ? undefined : onSurface;
  return (
    <group position={[voxel.x - size.x / 2 + 0.5, voxel.y + 0.02, voxel.z - size.z / 2 + 0.5]} onPointerMove={interactive}>
      {shape === 4 ? (
        <>
          <mesh castShadow receiveShadow position={[0, 0.4, 0]}>
            <cylinderGeometry args={[0.45, 0.45, 0.8, 32]} />
            <Material color={color} ghost={ghost} valid={valid} />
          </mesh>
          <mesh castShadow position={[0, 0.87, 0]}>
            <cylinderGeometry args={[0.22, 0.22, 0.14, 32]} />
            <Material color={color} ghost={ghost} valid={valid} />
          </mesh>
        </>
      ) : shape === 5 ? (
        <mesh castShadow receiveShadow geometry={wedgeGeometry} rotation={[0, -rotation * Math.PI / 2, 0]}>
          <Material color={color} ghost={ghost} valid={valid} />
        </mesh>
      ) : (
        <>
          <mesh castShadow receiveShadow position={[0, 0.4, 0]}>
            <boxGeometry args={[0.94, 0.8, 0.94]} />
            <Material color={color} ghost={ghost} valid={valid} />
          </mesh>
          <mesh castShadow position={[0, 0.87, 0]}>
            <cylinderGeometry args={[0.2, 0.2, 0.14, 24]} />
            <Material color={color} ghost={ghost} valid={valid} />
          </mesh>
        </>
      )}
    </group>
  );
}

export default function PlotScene({
  selected,
  rotation,
  color,
  pieces,
  demo,
  size,
  onPlacementChange,
}: {
  selected: number;
  rotation: number;
  color: number;
  pieces: ChainPiece[] | null;
  demo: boolean;
  size: { x: number; y: number; z: number };
  onPlacementChange: (placement: Placement, valid: boolean, reason?: string) => void;
}) {
  const placements = pieces?.map((piece) => piece.placement) ?? (demo ? SAMPLE : []);
  const extent = Math.max(size.x, size.z);
  const occupied = useMemo(() => placements.flatMap(occupiedVoxels), [placements]);
  const [origin, setOrigin] = useState({ x: 1, y: 0, z: 1 });
  const ghost = { ...origin, shape: selected, rotation, color };
  const verdict = validatePlacement(ghost, size, occupied);

  useEffect(() => {
    onPlacementChange(ghost, verdict.valid, verdict.reason);
  }, [color, onPlacementChange, origin.x, origin.y, origin.z, rotation, selected, verdict.reason, verdict.valid]);

  const moveGhost = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const surfaceNormal = event.face?.normal.clone().transformDirection(event.object.matrixWorld) ?? new THREE.Vector3(0, 1, 0);
    const normal = new THREE.Vector3();
    const axis = ["x", "y", "z"].reduce((largest, candidate) =>
      Math.abs(surfaceNormal[candidate as "x" | "y" | "z"]) > Math.abs(surfaceNormal[largest as "x" | "y" | "z"]) ? candidate : largest,
    );
    normal[axis as "x" | "y" | "z"] = Math.sign(surfaceNormal[axis as "x" | "y" | "z"]);
    setOrigin(snapWorldPoint(event.point, normal, size));
  };

  return (
    <Canvas key={`${size.x}-${size.y}-${size.z}`} camera={{ position: [extent * 0.75, extent * 0.72, extent * 0.85], fov: 38 }} shadows dpr={[1, 1.75]}>
      <color attach="background" args={["#dcd5c3"]} />
      <ambientLight intensity={1.7} />
      <directionalLight
        castShadow
        intensity={2.5}
        position={[extent * 0.4, extent, extent * 0.55]}
        shadow-camera-left={-extent}
        shadow-camera-right={extent}
        shadow-camera-top={extent}
        shadow-camera-bottom={-extent}
        shadow-camera-far={extent * 3}
        shadow-mapSize={[1024, 1024]}
      />
      <mesh receiveShadow position={[0, -0.08, 0]} onPointerMove={moveGhost}>
        <boxGeometry args={[size.x + 0.5, 0.16, size.z + 0.5]} />
        <meshStandardMaterial color="#496f4d" roughness={0.78} />
      </mesh>
      <gridHelper args={[Math.max(size.x, size.z), Math.max(size.x, size.z), "#dae2cf", "#739071"]} position={[0, 0.01, 0]} />
      {placements.flatMap((piece, pieceIndex) =>
        occupiedVoxels(piece).map((voxel, voxelIndex) => (
          <Cell
            key={`${pieceIndex}-${voxelIndex}`}
            voxel={voxel}
            color={PALETTE[piece.color]}
            size={size}
            shape={piece.shape}
            rotation={piece.rotation}
            onSurface={moveGhost}
          />
        )),
      )}
      {occupiedVoxels(ghost).map((voxel, index) => (
        <Cell
          key={`ghost-${index}`}
          voxel={voxel}
          color={PALETTE[color]}
          size={size}
          shape={selected}
          rotation={rotation}
          valid={verdict.valid}
          ghost
        />
      ))}
      <ContactShadows opacity={0.28} scale={extent + 4} blur={2.5} far={Math.max(8, size.y)} />
      <OrbitControls makeDefault minDistance={extent * 0.35} maxDistance={extent * 2.2} maxPolarAngle={Math.PI / 2.15} target={[0, 1, 0]} />
    </Canvas>
  );
}
