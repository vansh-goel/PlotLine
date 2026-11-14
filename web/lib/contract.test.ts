import { describe, expect, it } from "vitest";
import { parseConfig, parsePieces } from "./contract";

describe("contract response parsing", () => {
  it("accepts valid pieces and config", () => {
    expect(parsePieces([{ id: 7, day: 2, owner: "builder.testnet", placement: { shape: 1, rotation: 3, x: 4, y: 0, z: 5, color: 2 } }])).toHaveLength(1);
    expect(parseConfig({ allowance_per_day: 12, plot_size: { x: 32, y: 24, z: 32 } })).toEqual({
      allowance_per_day: 12,
      plot_size: { x: 32, y: 24, z: 32 },
    });
  });

  it("rejects malformed chain data", () => {
    expect(() => parsePieces([{ owner: "builder.testnet" }])).toThrow("Invalid piece at index 0");
    expect(() => parseConfig({ allowance_per_day: -1 })).toThrow("Invalid config response");
  });
});
