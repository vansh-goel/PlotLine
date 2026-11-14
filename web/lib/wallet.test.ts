import { describe, expect, it } from "vitest";
import { walletMessage } from "./wallet";

describe("walletMessage", () => {
  it("treats wallet rejection as a normal cancellation", () => {
    expect(walletMessage(new Error("User rejected"), "Failed")).toBe("Wallet request cancelled.");
  });

  it("preserves real wallet failures", () => {
    expect(walletMessage(new Error("RPC unavailable"), "Failed")).toBe("RPC unavailable");
  });
});
