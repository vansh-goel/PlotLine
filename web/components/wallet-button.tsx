"use client";

import { useNearWallet } from "near-connect-hooks";

export function WalletButton() {
  const { loading, signedAccountId, signIn, signOut } = useNearWallet();
  const label = loading ? "Checking wallet" : signedAccountId || "Connect wallet";

  return (
    <button
      className="wallet-button"
      disabled={loading}
      onClick={() => void (signedAccountId ? signOut() : signIn()).catch(() => undefined)}
      type="button"
    >
      <span className="wallet-status" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
