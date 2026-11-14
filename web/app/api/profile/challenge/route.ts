import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { redisCommand } from "@/lib/redis";

const ACCOUNT_ID = /^[a-z0-9._-]{2,64}$/;
const RECIPIENT = "plot-line-peach.vercel.app";

export async function POST(request: Request) {
  const { accountId } = await request.json() as { accountId?: string };
  if (!accountId || !ACCOUNT_ID.test(accountId)) return NextResponse.json({ error: "Invalid account ID" }, { status: 400 });

  const nonce = randomBytes(32).toString("base64");
  await redisCommand(["SET", `profile-challenge:${accountId}:${nonce}`, "1", "EX", "300"], true);
  return NextResponse.json({ message: "Update my PlotLine builder profile", nonce, recipient: RECIPIENT });
}
