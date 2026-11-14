import { describe, expect, it } from "vitest";
import { occupiedVoxels, snapWorldPoint, validatePlacement, type Placement } from "./plot";

const size = { x: 8, y: 8, z: 8 };
const placement = (overrides: Partial<Placement> = {}): Placement => ({
  shape: 1, rotation: 0, x: 1, y: 0, z: 1, color: 0, ...overrides,
});

describe("plot placement rules", () => {
  it("normalizes all four rotations to the placement origin", () => {
    for (let rotation = 0; rotation < 4; rotation += 1) {
      const voxels = occupiedVoxels(placement({ rotation }));
      expect(Math.min(...voxels.map(({ x }) => x))).toBe(1);
      expect(Math.min(...voxels.map(({ z }) => z))).toBe(1);
    }
  });

  it("accepts ground placements and rejects overlap and bounds violations", () => {
    expect(validatePlacement(placement(), size, [])).toEqual({ valid: true });
    expect(validatePlacement(placement(), size, [{ x: 1, y: 0, z: 1 }]).reason).toBe("Space is occupied");
    expect(validatePlacement(placement({ shape: 3, x: 7 }), size, []).reason).toBe("Outside the plot");
  });

  it("requires vertical support above the ground", () => {
    const floating = placement({ y: 2 });
    expect(validatePlacement(floating, size, []).reason).toBe("Needs vertical support");
    expect(validatePlacement(floating, size, [{ x: 1, y: 1, z: 1 }])).toEqual({ valid: true });
  });

  it("keeps the slope within one grid cell", () => {
    expect(occupiedVoxels(placement({ shape: 5, x: 3, z: 4 }))).toEqual([{ x: 3, y: 0, z: 4 }]);
  });

  it("snaps to the exposed face instead of inside an occupied piece", () => {
    const plot = { x: 12, y: 12, z: 12 };
    expect(snapWorldPoint({ x: -4.5, y: 0.08, z: -4.5 }, { x: 0, y: 1, z: 0 }, plot)).toEqual({ x: 1, y: 0, z: 1 });
    expect(snapWorldPoint({ x: -4.5, y: 0.96, z: -4.5 }, { x: 0, y: 1, z: 0 }, plot)).toEqual({ x: 1, y: 1, z: 1 });
    expect(snapWorldPoint({ x: -4, y: 0.4, z: -4.5 }, { x: 1, y: 0, z: 0 }, plot)).toEqual({ x: 2, y: 0, z: 1 });
  });
});
