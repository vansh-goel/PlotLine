"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useNearWallet } from "near-connect-hooks";
import { parseConfig, parsePieces, type ChainConfig, type ChainPiece } from "@/lib/contract";
import { PALETTE, SHAPES, type Placement } from "@/lib/plot";
import { BuildChat } from "./build-chat";

const PlotScene = dynamic(() => import("./plot-scene"), {
  ssr: false,
  loading: () => <div className="scene-loading">Surveying today’s plot…</div>,
});

export function TodayPlot() {
  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID?.trim() ?? "";
  const { signedAccountId, signIn, viewFunction, callFunction } = useNearWallet();
  const [shape, setShape] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [color, setColor] = useState(0);
  const [day, setDay] = useState(0);
  const [pieces, setPieces] = useState<ChainPiece[] | null>(null);
  const [config, setConfig] = useState<ChainConfig>({ allowance_per_day: 1, build_credit_price: "10000000000000000000000", plot_size: { x: 12, y: 12, z: 12 } });
  const [allowance, setAllowance] = useState<number | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [ghost, setGhost] = useState<{ placement: Placement; valid: boolean; reason?: string } | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "placing" | "buying" | "error">("idle");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    if (!contractId) return;
    setStatus((current) => current === "placing" || current === "buying" ? current : "loading");
    try {
      const currentDay = Number(await viewFunction({ contractId, method: "current_day", args: {} }));
      const [rawConfig, rawPieces] = await Promise.all([
        viewFunction({ contractId, method: "config", args: {} }),
        viewFunction({ contractId, method: "pieces", args: { day: currentDay, from_index: 0, limit: 500 } }),
      ]);
      const nextConfig = parseConfig(rawConfig);
      setDay(currentDay);
      setConfig(nextConfig);
      setPieces(parsePieces(rawPieces));
      if (signedAccountId) {
        const [left, balance] = await Promise.all([
          viewFunction({ contractId, method: "allowance_left", args: { account_id: signedAccountId, day: currentDay } }),
          viewFunction({ contractId, method: "credit_balance", args: { account_id: signedAccountId } }),
        ]);
        setAllowance(Number(left));
        setCredits(Number(balance));
      } else {
        setAllowance(null);
        setCredits(null);
      }
      setStatus("idle");
      setMessage("");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Could not read the contract");
    }
  }, [contractId, signedAccountId, viewFunction]);

  useEffect(() => {
    void refresh();
    if (!contractId) return;
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [contractId, refresh]);

  useEffect(() => {
    const rotate = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "r") setRotation((current) => (current + 1) % 4);
    };
    window.addEventListener("keydown", rotate);
    return () => window.removeEventListener("keydown", rotate);
  }, []);

  const place = async () => {
    if (!signedAccountId) {
      await signIn();
      return;
    }
    if (!ghost?.valid || !contractId) return;
    setStatus("placing");
    setMessage("Confirm the placement in your wallet");
    try {
      await callFunction({
        contractId,
        method: "place",
        args: { placement: ghost.placement },
        gas: "30000000000000",
        deposit: "50000000000000000000000",
      });
      setMessage("Piece placed. Refreshing the plot…");
      await refresh();
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Placement was not completed");
    }
  };

  const buyCredits = async () => {
    if (!signedAccountId) { await signIn(); return; }
    const amount = 10;
    setStatus("buying");
    setMessage("Confirm 10 build credits in your wallet");
    try {
      await callFunction({
        contractId,
        method: "buy_credits",
        args: { credits: amount },
        gas: "30000000000000",
        deposit: (BigInt(config.build_credit_price) * BigInt(amount) + 10_000_000_000_000_000_000_000n).toString(),
      });
      await refresh();
      setMessage("10 build credits added");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Credits were not purchased");
    }
  };

  const selectedCost = SHAPES.find((candidate) => candidate.id === shape)?.offsets.length ?? 0;
  const needsCredits = signedAccountId && allowance === 0;
  const lacksCredits = Boolean(needsCredits && (credits ?? 0) < selectedCost);

  const placeLabel = !contractId
    ? "Add contract ID to enable placement"
    : !signedAccountId
      ? "Connect wallet to place"
      : status === "placing"
        ? "Placing piece…"
        : lacksCredits
          ? `Needs ${selectedCost} build credits`
        : !ghost?.valid
          ? ghost?.reason ?? "Choose a valid position"
          : "Place piece";

  const handlePlacementChange = useCallback((placement: Placement, valid: boolean, reason?: string) => {
    setGhost({ placement, valid, reason });
  }, []);

  return (
    <main className="workspace">
      <section className="plot-stage" aria-label="Today’s shared 3D plot">
        <div className="plot-coordinates" aria-hidden="true"><span>N 00</span><span>PLOT {config.plot_size.x} × {config.plot_size.z}</span><span>E {config.plot_size.x}</span></div>
        <PlotScene
          selected={shape}
          rotation={rotation}
          color={color}
          pieces={pieces}
          demo={!contractId}
          size={config.plot_size}
          onPlacementChange={handlePlacementChange}
        />
        <div className="scene-note"><span className="live-dot" /> {contractId ? `Live day ${day}` : "Demo composition"} · drag to orbit</div>
      </section>

      <div className="side-rail">
      <aside className="workbench" aria-label="Piece placement controls">
        <div className="theme-block">
          <p>Today’s build</p>
          <h1>Creature from the canopy</h1>
          <div className="time-row"><strong>04:38:12</strong><span>until the plot closes</span></div>
        </div>

        <div className="field-row">
          <span>Free placement</span><strong>{allowance ?? "—"} left today</strong>
        </div>

        <div className="credit-row">
          <span><b>{credits ?? "—"}</b> banked credits</span>
          <button onClick={() => void buyCredits()} disabled={status === "buying"} type="button">{status === "buying" ? "Buying…" : "Buy 10"}</button>
        </div>

        <fieldset>
          <legend>Piece</legend>
          <div className="shape-grid">
            {SHAPES.map((candidate) => (
              <button
                aria-pressed={shape === candidate.id}
                className="shape-button"
                key={candidate.id}
                onClick={() => setShape(candidate.id)}
                type="button"
              >
                <span className={`shape-mark shape-${candidate.id}`} aria-hidden="true" />
                {candidate.name}<small>{candidate.offsets.length} cr</small>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Color</legend>
          <div className="palette">
            {PALETTE.slice(0, 8).map((value, index) => (
              <button
                aria-label={`Select color ${index + 1}`}
                aria-pressed={color === index}
                key={value}
                onClick={() => setColor(index)}
                style={{ backgroundColor: value }}
                type="button"
              />
            ))}
          </div>
        </fieldset>

        <div className="rotation-row">
          <button onClick={() => setRotation((current) => (current + 3) % 4)} type="button">Rotate left</button>
          <strong>{rotation * 90}°</strong>
          <button onClick={() => setRotation((current) => (current + 1) % 4)} type="button">Rotate right <kbd>R</kbd></button>
        </div>

        <button
          className="place-button"
          type="button"
          disabled={status === "placing" || status === "buying" || lacksCredits || Boolean(signedAccountId && (!contractId || !ghost?.valid))}
          onClick={() => void place()}
        >
          {placeLabel}
        </button>

        {message && <p className={`contract-message ${status === "error" ? "is-error" : ""}`} role="status">{message}</p>}

        <div className="split-note">
          <span>Edition proceeds</span>
          <strong>90% builders · 10% treasury</strong>
        </div>
      </aside>
      <BuildChat day={day} />
      </div>
    </main>
  );
}
