import type { Placement, PlotSize } from "./plot";
import { SHAPES } from "./plot";

export type ChainPiece = {
  id: number | string;
  day: number;
  owner: string;
  placement: Placement;
};

export type ChainConfig = {
  allowance_per_day: number;
  build_credit_price: string;
  plot_size: PlotSize;
};

export type BuilderRank = { accountId: string; pieces: number; credits: number; share: number };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const integer = (value: unknown, field: string) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid contract field: ${field}`);
  }
  return value;
};

const string = (value: unknown, field: string) => {
  if (typeof value !== "string") throw new Error(`Invalid contract field: ${field}`);
  return value;
};

export function parsePieces(value: unknown): ChainPiece[] {
  if (!Array.isArray(value)) throw new Error("Invalid pieces response");
  return value.map((piece, index) => {
    if (!isRecord(piece) || !isRecord(piece.placement) || typeof piece.owner !== "string") {
      throw new Error(`Invalid piece at index ${index}`);
    }
    const placement = piece.placement;
    return {
      id: typeof piece.id === "string" ? piece.id : integer(piece.id, "piece.id"),
      day: integer(piece.day, "piece.day"),
      owner: piece.owner,
      placement: {
        shape: integer(placement.shape, "placement.shape"),
        rotation: integer(placement.rotation, "placement.rotation"),
        x: integer(placement.x, "placement.x"),
        y: integer(placement.y, "placement.y"),
        z: integer(placement.z, "placement.z"),
        color: integer(placement.color, "placement.color"),
      },
    };
  });
}

export function rankBuilders(pieces: readonly ChainPiece[]): BuilderRank[] {
  const counts = new Map<string, { pieces: number; credits: number }>();
  for (const piece of pieces) {
    const current = counts.get(piece.owner) ?? { pieces: 0, credits: 0 };
    const credits = SHAPES.find((shape) => shape.id === piece.placement.shape)?.offsets.length ?? 0;
    counts.set(piece.owner, { pieces: current.pieces + 1, credits: current.credits + credits });
  }
  const total = [...counts.values()].reduce((sum, value) => sum + value.credits, 0);
  return [...counts.entries()]
    .map(([accountId, value]) => ({ accountId, ...value, share: total === 0 ? 0 : value.credits / total }))
    .sort((a, b) => b.credits - a.credits || a.accountId.localeCompare(b.accountId));
}

export function parseConfig(value: unknown): ChainConfig {
  if (!isRecord(value) || !isRecord(value.plot_size)) throw new Error("Invalid config response");
  return {
    allowance_per_day: integer(value.allowance_per_day, "allowance_per_day"),
    build_credit_price: string(value.build_credit_price, "build_credit_price"),
    plot_size: {
      x: integer(value.plot_size.x, "plot_size.x"),
      y: integer(value.plot_size.y, "plot_size.y"),
      z: integer(value.plot_size.z, "plot_size.z"),
    },
  };
}
