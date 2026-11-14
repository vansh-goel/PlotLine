import { NextRequest, NextResponse } from "next/server";
import { base64Decode } from "near-api-js";
import { verifyMessage } from "near-api-js/nep413";
import { redisCommand } from "@/lib/redis";
import { createTestnetProvider } from "@/lib/network";

const ACCOUNT_ID = /^[a-z0-9._-]{2,64}$/;
const RECIPIENT = "plot-line-peach.vercel.app";
const provider = createTestnetProvider();

export async function GET(request: NextRequest) {
  const accounts = (request.nextUrl.searchParams.get("accounts") ?? "").split(",").filter(Boolean).slice(0, 100);
  if (accounts.some((account) => !ACCOUNT_ID.test(account))) return NextResponse.json({ error: "Invalid account ID" }, { status: 400 });
  const entries = await Promise.all(accounts.map(async (account) => [account, await redisCommand<string>(["GET", `profile:${account}`])] as const));
  return NextResponse.json({ profiles: Object.fromEntries(entries.filter(([, name]) => name)) });
}

export async function PUT(request: Request) {
  const body = await request.json() as {
    accountId?: string; name?: string; nonce?: string; publicKey?: string; signature?: string;
  };
  const name = body.name?.trim() ?? "";
  if (!body.accountId || !ACCOUNT_ID.test(body.accountId)) return NextResponse.json({ error: "Invalid account ID" }, { status: 400 });
  if (name.length < 2 || name.length > 32 || [...name].some((character) => /\p{C}/u.test(character))) {
    return NextResponse.json({ error: "Name must be 2 to 32 visible characters" }, { status: 400 });
  }
  if (!body.nonce || !body.publicKey || !body.signature) return NextResponse.json({ error: "Missing wallet signature" }, { status: 400 });

  const challenge = await redisCommand<string>(["GETDEL", `profile-challenge:${body.accountId}:${body.nonce}`], true);
  if (!challenge) return NextResponse.json({ error: "Challenge expired or already used" }, { status: 401 });

  try {
    await verifyMessage({
      signerAccountId: body.accountId,
      signerPublicKey: body.publicKey,
      payload: {
        message: "Update my PlotLine builder profile",
        recipient: RECIPIENT,
        nonce: base64Decode(body.nonce),
      },
      signature: base64Decode(body.signature),
      provider,
    });
  } catch {
    return NextResponse.json({ error: "Invalid wallet signature" }, { status: 401 });
  }

  await redisCommand(["SET", `profile:${body.accountId}`, name], true);
  return NextResponse.json({ name });
}
