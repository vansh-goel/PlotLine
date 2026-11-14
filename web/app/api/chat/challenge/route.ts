import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { redisCommand } from "@/lib/redis";

const ACCOUNT_ID = /^[a-z0-9._-]{2,64}$/;

export async function POST(request: Request) {
  const { accountId, day, message, imageUrl } = await request.json() as { accountId?: string; day?: number; message?: string; imageUrl?: string };
  const text = message?.trim() ?? "";
  const image = imageUrl?.trim() ?? "";
  if (!accountId || !ACCOUNT_ID.test(accountId) || !Number.isSafeInteger(day) || (day ?? -1) < 0) {
    return NextResponse.json({ error: "Invalid chat request" }, { status: 400 });
  }
  if ((!text && !image) || text.length > 280 || [...text].some((character) => /\p{C}/u.test(character) && character !== "\n")) {
    return NextResponse.json({ error: "Add a message or image link; messages can be up to 280 characters" }, { status: 400 });
  }
  if (image.length > 1000) return NextResponse.json({ error: "Image link is too long" }, { status: 400 });
  try {
    if (image && new URL(image).protocol !== "https:") throw new Error();
  } catch {
    return NextResponse.json({ error: "Image link must be a valid HTTPS URL" }, { status: 400 });
  }
  const nonce = randomBytes(32).toString("base64");
  await redisCommand(["SET", `chat-challenge:${accountId}:${nonce}`, JSON.stringify({ day, message: text, imageUrl: image }), "EX", "300"], true);
  return NextResponse.json({ message: `Post to PlotLine day ${day}:\n${text}${image ? `\nImage: ${image}` : ""}`, nonce, recipient: "plot-line-peach.vercel.app" });
}
