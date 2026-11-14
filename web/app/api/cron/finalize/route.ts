import { NextResponse } from "next/server";
import { Account, JsonRpcProvider, KeyPairSigner, type KeyPairString } from "near-api-js";

const RPC_URL = "https://test.rpc.fastnear.com";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID?.trim();
  const keeperId = process.env.KEEPER_ACCOUNT_ID?.trim();
  const privateKey = process.env.KEEPER_PRIVATE_KEY?.trim();
  if (!contractId || !keeperId || !privateKey) return NextResponse.json({ error: "Keeper is not configured" }, { status: 503 });

  const provider = new JsonRpcProvider({ url: RPC_URL });
  const currentDay = await provider.callFunction<number>({ contractId, method: "current_day", args: {} });
  if (!currentDay) return NextResponse.json({ status: "nothing-ended" });
  const candidates: number[] = [];
  for (let day = Math.max(0, currentDay - 24); day < currentDay; day += 1) {
    const [state, pieces] = await Promise.all([
      provider.callFunction<object>({ contractId, method: "day_state", args: { day } }),
      provider.callFunction<unknown[]>({ contractId, method: "pieces", args: { day, from_index: 0, limit: 1 } }),
    ]);
    if (!state && pieces?.length) candidates.push(day);
  }
  if (!candidates.length) return NextResponse.json({ status: "nothing-to-finalize" });

  const signer = KeyPairSigner.fromSecretKey(privateKey as KeyPairString);
  const keeper = new Account(keeperId, provider, signer);
  const finalized: number[] = [];
  for (const day of candidates.slice(0, 4)) {
    try {
      await keeper.callFunction({ contractId, methodName: "finalize", args: { day }, gas: "30000000000000", deposit: "0", waitUntil: "FINAL" });
      finalized.push(day);
    } catch (error) {
      if (!(error instanceof Error && error.message.toLowerCase().includes("already finalized"))) throw error;
    }
  }
  return NextResponse.json({ status: "finalized", days: finalized });
}
