"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useNearWallet } from "near-connect-hooks";
import { parseConfig, parsePieces, type ChainConfig, type ChainPiece } from "@/lib/contract";
import { PALETTE, SHAPES, type Placement } from "@/lib/plot";

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
  const [config, setConfig] = useState<ChainConfig>({ allowance_per_day: 12, plot_size: { x: 12, y: 12, z: 12 } });
  const [allowance, setAllowance] = useState<number | null>(null);
  const [ghost, setGhost] = useState<{ placement: Placement; valid: boolean; reason?: string } | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "placing" | "error">("idle");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    if (!contractId) return;
    setStatus((current) => current === "placing" ? current : "loading");
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
        const left = await viewFunction({ contractId, method: "allowance_left", args: { account_id: signedAccountId, day: currentDay } });
        setAllowance(Number(left));
      } else {
        setAllowance(null);
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

  const placeLabel = !contractId
    ? "Add contract ID to enable placement"
    : !signedAccountId
      ? "Connect wallet to place"
      : status === "placing"
        ? "Placing piece…"
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
          size={config.plot_size}
          onPlacementChange={handlePlacementChange}
        />
        <div className="scene-note"><span className="live-dot" /> {contractId ? `Live day ${day}` : "Demo composition"} · drag to orbit</div>
      </section>

      <aside className="workbench" aria-label="Piece placement controls">
        <div className="theme-block">
          <p>Today’s build</p>
          <h1>Creature from the canopy</h1>
          <div className="time-row"><strong>04:38:12</strong><span>until the plot closes</span></div>
        </div>

        <div className="field-row">
          <span>Allowance</span><strong>{allowance ?? "—"} / {config.allowance_per_day} pieces left</strong>
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
                {candidate.name}
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
          disabled={status === "placing" || Boolean(signedAccountId && (!contractId || !ghost?.valid))}
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
    </main>
  );
}
