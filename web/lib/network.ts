import { FailoverRpcProvider, JsonRpcProvider } from "near-api-js";

export const TESTNET_RPC_URLS = [
  "https://near-testnet.drpc.org",
  "https://testnet-rpc.intea.rs",
  "https://test.rpc.fastnear.com",
] as const;

export const createTestnetProvider = () => new FailoverRpcProvider(
  TESTNET_RPC_URLS.map((url) => new JsonRpcProvider({ url })),
);

export function rpcMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /providers to execute request|failed to fetch|network request|fetch failed|connectivity/i.test(message)
    ? "NEAR testnet RPC is temporarily unavailable. Retrying…"
    : message || fallback;
}
