import { describe, expect, it } from "vitest";
import { rpcMessage, TESTNET_RPC_URLS } from "./network";

describe("NEAR RPC failover", () => {
  it("keeps more than one independent testnet provider", () => {
    expect(new Set(TESTNET_RPC_URLS).size).toBeGreaterThan(1);
  });

  it("turns provider exhaustion into a retryable status", () => {
    expect(rpcMessage(new Error("Exceeded 1 providers to execute request"), "Failed")).toContain("Retrying");
  });
});
