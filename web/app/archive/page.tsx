"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useNearWallet } from "near-connect-hooks";
import { parsePieces } from "@/lib/contract";

type ArchiveDay = { day: number; pieces: number; finalized: boolean; editions: number; current: boolean; price: string | null; saleEndsAt: string | null };

export default function ArchivePage() {
  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID?.trim() ?? "";
  const { signedAccountId, signIn, viewFunction, callFunction } = useNearWallet();
  const [days, setDays] = useState<ArchiveDay[]>([]);
  const [error, setError] = useState("");
  const [action, setAction] = useState("");

  const load = useCallback(async () => {
    if (!contractId) {
      setError("NEXT_PUBLIC_CONTRACT_ID is not configured");
      return;
    }
    try {
      const currentDay = Number(await viewFunction({ contractId, method: "current_day", args: {} }));
      const dayNumbers = Array.from({ length: Math.min(currentDay + 1, 24) }, (_, index) => currentDay - index);
      const loaded = await Promise.all(dayNumbers.map(async (day) => {
        const [pieceResponse, state] = await Promise.all([
          viewFunction({ contractId, method: "pieces", args: { day, from_index: 0, limit: 100 } }),
          viewFunction({ contractId, method: "day_state", args: { day } }),
        ]);
        const finalized = typeof state === "object" && state !== null;
        const editions = finalized && "editions_minted" in state ? Number(state.editions_minted) : 0;
        const price = finalized && "edition_price" in state ? String(state.edition_price) : null;
        const saleEndsAt = finalized && "sale_ends_at_ns" in state ? String(state.sale_ends_at_ns) : null;
        return { day, pieces: parsePieces(pieceResponse).length, finalized, editions, current: day === currentDay, price, saleEndsAt };
      }));
      setDays(loaded);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the archive");
    }
  }, [contractId, viewFunction]);

  useEffect(() => { void load(); }, [load]);

  const transact = async (entry: ArchiveDay) => {
    if (!signedAccountId) { await signIn(); return; }
    const collecting = entry.finalized;
    setAction(`${collecting ? "Collecting" : "Finalizing"} day ${entry.day}…`);
    try {
      await callFunction({
        contractId,
        method: collecting ? "collect" : "finalize",
        args: { day: entry.day },
        gas: "30000000000000",
        deposit: collecting && entry.price ? (BigInt(entry.price) + 50_000_000_000_000_000_000_000n).toString() : "0",
      });
      setAction(`${collecting ? "Edition collected" : "Day finalized"}.`);
      await load();
    } catch (cause) {
      setAction(cause instanceof Error ? cause.message : "Transaction was not completed");
    }
  };

  return (
    <main className="directory-page">
      <header className="directory-heading">
        <p>Every shared plot</p>
        <h1>The build changes. The record stays.</h1>
        <span>Recent plots, their contribution totals, and whether their limited edition has opened.</span>
      </header>

      {error ? <p className="route-message is-error" role="alert">{error}</p> : days.length === 0 ? (
        <p className="route-message">Loading recent plots…</p>
      ) : (
        <div className="archive-list">
          {days.map((entry) => entry.current && entry.pieces === 0 ? (
            <Link className="archive-empty-callout" href="/" key={entry.day}>
              <div><span>Day</span><strong>#{entry.day}</strong></div>
              <div className="archive-empty-copy">
                <strong>No pieces yet. Be part of this plot’s history.</strong>
                <span>Your first piece starts today’s shared build.</span>
              </div>
              <b>Start building</b>
            </Link>
          ) : (
            <article key={entry.day}>
              <div><span>Day</span><strong>#{entry.day}</strong></div>
              <div><span>Pieces</span><strong>{entry.pieces}</strong></div>
              <div><span>Status</span><strong>{entry.pieces === 0 ? "No build" : entry.finalized ? "Collecting" : "Building"}</strong></div>
              <div><span>Editions</span><strong>{entry.editions}</strong></div>
              {!entry.current && entry.pieces > 0 && (!entry.finalized || (entry.saleEndsAt && BigInt(entry.saleEndsAt) > BigInt(Date.now()) * 1_000_000n)) ? <button className="archive-action" onClick={() => void transact(entry)} type="button">{entry.finalized ? "Collect edition" : "Finalize day"}</button> : <span className="archive-action-note">{entry.finalized ? "Sale closed" : "—"}</span>}
            </article>
          ))}
        </div>
      )}
      {action && <p className="route-message" role="status">{action}</p>}
    </main>
  );
}
