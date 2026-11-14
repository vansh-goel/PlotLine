import { NextRequest, NextResponse } from "next/server";
import { base64Decode } from "near-api-js";
import { verifyMessage } from "near-api-js/nep413";
import { redisCommand } from "@/lib/redis";
import { createTestnetProvider } from "@/lib/network";

const ACCOUNT_ID = /^[a-z0-9._-]{2,64}$/;
const RECIPIENT = "plot-line-peach.vercel.app";
const provider = createTestnetProvider();
type ChatMessage = { id: string; accountId: string; name?: string; message: string; imageUrl?: string; createdAt: number };

export async function GET(request: NextRequest) {
  const day = Number(request.nextUrl.searchParams.get("day"));
  if (!Number.isSafeInteger(day) || day < 0) return NextResponse.json({ error: "Invalid day" }, { status: 400 });
  const raw = await redisCommand<string[]>(["LRANGE", `chat:${day}`, "-50", "-1"]);
  const messages = (raw ?? []).flatMap((value) => {
    try { return [JSON.parse(value) as ChatMessage]; } catch { return []; }
  });
  const accounts = [...new Set(messages.map(({ accountId }) => accountId))];
  const profiles = Object.fromEntries((await Promise.all(accounts.map(async (account) => [account, await redisCommand<string>(["GET", `profile:${account}`])] as const))).filter(([, name]) => name));
  return NextResponse.json({ messages: messages.map((message) => ({ ...message, name: profiles[message.accountId] ?? undefined })) });
}

export async function POST(request: Request) {
  const body = await request.json() as { accountId?: string; day?: number; message?: string; imageUrl?: string; nonce?: string; publicKey?: string; signature?: string };
  if (!body.accountId || !ACCOUNT_ID.test(body.accountId) || !body.nonce || !body.publicKey || !body.signature) {
    return NextResponse.json({ error: "Invalid chat request" }, { status: 400 });
  }
  const challenge = await redisCommand<string>(["GETDEL", `chat-challenge:${body.accountId}:${body.nonce}`], true);
  if (!challenge) return NextResponse.json({ error: "Challenge expired or already used" }, { status: 401 });
  let expected: { day: number; message: string; imageUrl: string };
  try { expected = JSON.parse(challenge) as typeof expected; } catch { return NextResponse.json({ error: "Invalid challenge" }, { status: 401 }); }
  if (expected.day !== body.day || expected.message !== body.message?.trim() || expected.imageUrl !== (body.imageUrl?.trim() ?? "")) return NextResponse.json({ error: "Message changed after signing" }, { status: 400 });
  try {
    await verifyMessage({
      signerAccountId: body.accountId,
      signerPublicKey: body.publicKey,
      payload: { message: `Post to PlotLine day ${expected.day}:\n${expected.message}${expected.imageUrl ? `\nImage: ${expected.imageUrl}` : ""}`, recipient: RECIPIENT, nonce: base64Decode(body.nonce) },
      signature: base64Decode(body.signature),
      provider,
    });
  } catch {
    return NextResponse.json({ error: "Invalid wallet signature" }, { status: 401 });
  }
  const allowed = await redisCommand<string>(["SET", `chat-rate:${body.accountId}`, "1", "NX", "EX", "5"], true);
  if (!allowed) return NextResponse.json({ error: "Wait a few seconds before posting again" }, { status: 429 });
  const entry = { id: crypto.randomUUID(), accountId: body.accountId, message: expected.message, imageUrl: expected.imageUrl || undefined, createdAt: Date.now() };
  await redisCommand(["RPUSH", `chat:${expected.day}`, JSON.stringify(entry)], true);
  await redisCommand(["LTRIM", `chat:${expected.day}`, "-100", "-1"], true);
  return NextResponse.json(entry);
}
