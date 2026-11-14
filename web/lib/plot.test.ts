import { describe, expect, it } from "vitest";
import { occupiedVoxels, validatePlacement, type Placement } from "./plot";

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
});
