"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useNearWallet } from "near-connect-hooks";
import { walletMessage } from "@/lib/wallet";

type OwnedToken = { token_id: string; metadata?: { title?: string; media?: string } };
type Earning = { day: number; amount: string };

const formatNear = (yocto: string) => {
  const value = BigInt(yocto);
  const whole = value / 1_000_000_000_000_000_000_000_000n;
  const fraction = (value % 1_000_000_000_000_000_000_000_000n).toString().padStart(24, "0").slice(0, 4).replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""} NEAR`;
};

export default function ProfilePage() {
  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID?.trim() ?? "";
  const { signedAccountId, signIn, signNEP413Message, viewFunction, callFunction } = useNearWallet();
  const [name, setName] = useState("");
  const [tokens, setTokens] = useState<OwnedToken[]>([]);
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    if (!contractId || !signedAccountId) return;
    try {
      const [profileResponse, owned, currentDayValue] = await Promise.all([
        fetch(`/api/profile?accounts=${encodeURIComponent(signedAccountId)}`),
        viewFunction({ contractId, method: "nft_tokens_for_owner", args: { account_id: signedAccountId, from_index: "0", limit: 50 } }),
        viewFunction({ contractId, method: "current_day", args: {} }),
      ]);
      const currentDay = Number(currentDayValue);
      // shortcut: scan recent demo days; add a per-builder day index before long-running production use.
      const days = Array.from({ length: Math.min(currentDay, 24) }, (_, index) => currentDay - index - 1);
      const recentEarnings = await Promise.all(days.map(async (day) => ({
        day,
        amount: String(await viewFunction({ contractId, method: "claimable", args: { day, account_id: signedAccountId } })),
      })));
      const profileData = await profileResponse.json() as { profiles?: Record<string, string> };
      setName(profileData.profiles?.[signedAccountId] ?? "");
      setTokens(Array.isArray(owned) ? owned as OwnedToken[] : []);
      setEarnings(recentEarnings.filter(({ amount }) => BigInt(amount) > 0n));
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "Could not load profile");
    }
  }, [contractId, signedAccountId, viewFunction]);

  useEffect(() => { void load(); }, [load]);

  const withdraw = async (day: number) => {
    setStatus(`Withdrawing day ${day} earnings…`);
    try {
      await callFunction({ contractId, method: "withdraw", args: { day }, gas: "30000000000000", deposit: "0" });
      setStatus(`Day ${day} earnings withdrawn.`);
      await load();
    } catch (cause) {
      setStatus(walletMessage(cause, "Withdrawal was not completed"));
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!signedAccountId || !contractId) return;
    setStatus("Saving name…");
    try {
      const challengeResponse = await fetch("/api/profile/challenge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: signedAccountId }) });
      const challenge = await challengeResponse.json() as { message?: string; nonce?: string; recipient?: string; error?: string };
      if (!challengeResponse.ok || !challenge.message || !challenge.nonce || !challenge.recipient) throw new Error(challenge.error ?? "Could not start profile update");
      const nonce = Uint8Array.from(atob(challenge.nonce), (character) => character.charCodeAt(0));
      const signed = await signNEP413Message({ message: challenge.message, recipient: challenge.recipient, nonce });
      const saveResponse = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: signedAccountId, name, nonce: challenge.nonce, publicKey: signed.publicKey, signature: signed.signature }),
      });
      const saved = await saveResponse.json() as { error?: string };
      if (!saveResponse.ok) throw new Error(saved.error ?? "Name was not saved");
      setStatus("Name saved");
      await load();
    } catch (cause) {
      setStatus(walletMessage(cause, "Name was not saved"));
    }
  };

  if (!signedAccountId) {
    return <main className="directory-page profile-connect"><h1>Your PlotLine profile.</h1><p>Connect a testnet wallet to see collected editions and set your public builder name.</p><button onClick={() => void signIn().catch((cause) => setStatus(walletMessage(cause, "Could not connect wallet")))} type="button">Connect wallet</button>{status && <p className="route-message" role="status">{status}</p>}</main>;
  }

  return (
    <main className="directory-page">
      <header className="profile-heading"><div><p>Builder profile</p><h1>{name || "Unnamed builder"}</h1><span>{signedAccountId}</span></div></header>
      <section className="earnings"><div className="collection-heading"><h2>Builder earnings</h2><span>{earnings.length}</span></div>{earnings.length === 0 ? <p className="earnings-empty">No unclaimed earnings from the latest 24 plots.</p> : <ol>{earnings.map((earning) => <li key={earning.day}><div><span>Day {earning.day}</span><strong>{formatNear(earning.amount)}</strong></div><button onClick={() => void withdraw(earning.day)} type="button">Withdraw</button></li>)}</ol>}</section>
      <section className="collection"><div className="collection-heading"><h2>Collected editions</h2><span>{tokens.length}</span></div>{tokens.length === 0 ? <div className="collection-empty"><p>No PlotLine editions collected yet.</p><Link href="/archive">Explore finished plots</Link></div> : <div className="collection-grid">{tokens.map((token) => <article key={token.token_id}>{token.metadata?.media && <img alt={token.metadata?.title ?? `PlotLine edition ${token.token_id}`} src={token.metadata.media} />}<strong>{token.metadata?.title ?? `Edition ${token.token_id}`}</strong><span>Token {token.token_id}</span></article>)}</div>}</section>
      <form className="profile-form" onSubmit={(event) => void save(event)}>
        <label htmlFor="profile-name">Public builder name</label>
        <div><input id="profile-name" maxLength={32} minLength={2} onChange={(event) => setName(event.target.value)} value={name} /><button type="submit">Save name</button></div>
        <small>Shown with your account ID on the builders leaderboard. Stored publicly on testnet.</small>
      </form>
      {status && <p className="route-message" role="status">{status}</p>}
    </main>
  );
}
