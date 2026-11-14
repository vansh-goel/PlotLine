import { describe, expect, it } from "vitest";
import { parseConfig, parsePieces, rankBuilders } from "./contract";

describe("contract response parsing", () => {
  it("accepts valid pieces and config", () => {
    expect(parsePieces([{ id: 7, day: 2, owner: "builder.testnet", placement: { shape: 1, rotation: 3, x: 4, y: 0, z: 5, color: 2 } }])).toHaveLength(1);
    expect(parseConfig({ allowance_per_day: 1, build_credit_price: "10000000000000000000000", plot_size: { x: 32, y: 24, z: 32 } })).toEqual({
      allowance_per_day: 1,
      build_credit_price: "10000000000000000000000",
      plot_size: { x: 32, y: 24, z: 32 },
    });
  });

  it("rejects malformed chain data", () => {
    expect(() => parsePieces([{ owner: "builder.testnet" }])).toThrow("Invalid piece at index 0");
    expect(() => parseConfig({ allowance_per_day: -1 })).toThrow("Invalid config response");
  });

  it("ranks builders by active piece contribution", () => {
    const pieces = parsePieces([
      { id: 1, day: 0, owner: "alice.testnet", placement: { shape: 1, rotation: 0, x: 0, y: 0, z: 0, color: 0 } },
      { id: 2, day: 0, owner: "bob.testnet", placement: { shape: 0, rotation: 0, x: 1, y: 0, z: 0, color: 0 } },
      { id: 3, day: 0, owner: "alice.testnet", placement: { shape: 0, rotation: 0, x: 2, y: 0, z: 0, color: 0 } },
    ]);
    expect(rankBuilders(pieces)).toEqual([
      { accountId: "alice.testnet", pieces: 2, credits: 3, share: 3 / 4 },
      { accountId: "bob.testnet", pieces: 1, credits: 1, share: 1 / 4 },
    ]);
  });
});
