import { TodayPlot } from "@/components/today-plot";
import { WalletButton } from "@/components/wallet-button";

export default function Home() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="PlotLine home">
          <span className="plot-mark" aria-hidden="true"><i /><i /><i /></span>
          PlotLine
        </a>
        <nav aria-label="Primary navigation">
          <a className="active" href="/">Today</a>
          <a href="/day/0">Archive</a>
          <a href="#builders">Builders</a>
        </nav>
        <WalletButton />
      </header>
      <TodayPlot />
    </div>
  );
}
