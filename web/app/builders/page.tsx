"use client";

import { useCallback, useEffect, useState } from "react";
import { useNearWallet } from "near-connect-hooks";
import { parsePieces, rankBuilders, type BuilderRank } from "@/lib/contract";

export default function BuildersPage() {
  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID?.trim() ?? "";
  const { viewFunction } = useNearWallet();
  const [day, setDay] = useState<number | null>(null);
  const [builders, setBuilders] = useState<BuilderRank[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!contractId) {
      setError("NEXT_PUBLIC_CONTRACT_ID is not configured");
      return;
    }
    try {
      const currentDay = Number(await viewFunction({ contractId, method: "current_day", args: {} }));
      const response = await viewFunction({ contractId, method: "pieces", args: { day: currentDay, from_index: 0, limit: 100 } });
      setDay(currentDay);
      const ranked = rankBuilders(parsePieces(response));
      setBuilders(ranked);
      const profileResponse = await fetch(`/api/profile?accounts=${encodeURIComponent(ranked.map((builder) => builder.accountId).join(","))}`);
      const profileData = await profileResponse.json() as { profiles?: Record<string, string> };
      setNames(profileData.profiles ?? {});
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load builders");
    }
  }, [contractId, viewFunction]);

  useEffect(() => { void load(); }, [load]);

  return (
    <main className="directory-page">
      <header className="directory-heading">
        <p>{day === null ? "Current plot" : `Day ${day}`}</p>
        <h1>Built by many hands.</h1>
        <span>Edition rewards follow active build credits at finalization. Larger pieces carry more credits and earn a larger share of the 90% builder pool.</span>
      </header>

      {error ? <p className="route-message is-error" role="alert">{error}</p> : builders.length === 0 ? (
        <p className="route-message">No builders on this plot yet. Place the first piece.</p>
      ) : (
        <ol className="leaderboard">
          {builders.map((builder, index) => (
            <li key={builder.accountId}>
              <span className="rank">{String(index + 1).padStart(2, "0")}</span>
              <div className="builder-identity">
                <strong>{names[builder.accountId] ?? builder.accountId}</strong>
                {names[builder.accountId] && <small>{builder.accountId}</small>}
              </div>
              <span>{builder.credits} credits · {builder.pieces} {builder.pieces === 1 ? "piece" : "pieces"}</span>
              <b>{(builder.share * 90).toFixed(1)}% of proceeds</b>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
