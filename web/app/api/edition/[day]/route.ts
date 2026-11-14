import { NextResponse } from "next/server";
import { PALETTE, occupiedVoxels } from "@/lib/plot";
import { parsePieces } from "@/lib/contract";

const RPC_URL = "https://rpc.testnet.near.org";

const shade = (hex: string, factor: number) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return `#${[value >> 16, value >> 8 & 255, value & 255].map((channel) => Math.round(channel * factor).toString(16).padStart(2, "0")).join("")}`;
};

export async function GET(_request: Request, { params }: { params: Promise<{ day: string }> }) {
  const day = Number((await params).day);
  if (!Number.isSafeInteger(day) || day < 0) return NextResponse.json({ error: "Invalid day" }, { status: 400 });
  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID?.trim();
  if (!contractId) return NextResponse.json({ error: "Contract is not configured" }, { status: 503 });

  const rpc = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "plotline-edition", method: "query", params: { request_type: "call_function", finality: "final", account_id: contractId, method_name: "pieces", args_base64: Buffer.from(JSON.stringify({ day, from_index: 0, limit: 100 })).toString("base64") } }),
    next: { revalidate: 30 },
  });
  const payload = await rpc.json() as { result?: { result?: number[] }; error?: unknown };
  if (!rpc.ok || !payload.result?.result) return NextResponse.json({ error: "Could not load edition" }, { status: 502 });
  // shortcut: edition media renders the first 100 pieces; paginate when plots regularly exceed that.
  const pieces = parsePieces(JSON.parse(Buffer.from(payload.result.result).toString("utf8")) as unknown);
  const cells = pieces.flatMap((piece) => occupiedVoxels(piece.placement).map((voxel) => ({ ...voxel, color: PALETTE[piece.placement.color] })))
    .sort((a, b) => a.x + a.z + a.y - (b.x + b.z + b.y));
  const cubes = cells.map(({ x, y, z, color }) => {
    const sx = 320 + (x - z) * 9;
    const sy = 65 + (x + z) * 4.5 - y * 9;
    return `<g><path d="M${sx} ${sy - 8}l9 4.5-9 4.5-9-4.5z" fill="${color}"/><path d="M${sx - 9} ${sy - 3.5}l9 4.5v9l-9-4.5z" fill="${shade(color, .72)}"/><path d="M${sx + 9} ${sy - 3.5}l-9 4.5v9l9-4.5z" fill="${shade(color, .86)}"/></g>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 420" role="img" aria-labelledby="title"><title id="title">PlotLine day ${day} edition</title><rect width="640" height="420" fill="#eee9dc"/><path d="M320 42L603 183.5 320 325 37 183.5z" fill="#496f4d" stroke="#20231e"/><g stroke="#20231e" stroke-width=".5" stroke-linejoin="round">${cubes}</g><text x="28" y="382" fill="#20231e" font-family="sans-serif" font-size="30" font-weight="700">PlotLine · Day ${day}</text><text x="28" y="404" fill="#5e6258" font-family="sans-serif" font-size="12">Built together on NEAR testnet</text></svg>`;
  return new NextResponse(svg, { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300" } });
}
