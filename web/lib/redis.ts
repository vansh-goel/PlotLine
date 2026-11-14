import "server-only";

type RedisResponse<T> = { result?: T; error?: string };

export async function redisCommand<T>(command: string[], write = false): Promise<T | null> {
  const url = process.env.KV_REST_API_URL;
  const token = write ? process.env.KV_REST_API_TOKEN : process.env.KV_REST_API_READ_ONLY_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("Redis is not configured");

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  const data = await response.json() as RedisResponse<T>;
  if (!response.ok || data.error) throw new Error(data.error ?? "Redis request failed");
  return data.result ?? null;
}
