"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletButton } from "./wallet-button";

const links = [
  { href: "/", label: "Build" },
  { href: "/archive", label: "Archive" },
  { href: "/builders", label: "Builders" },
  { href: "/profile", label: "Profile" },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="topbar">
      <Link className="wordmark" href="/" aria-label="PlotLine home">
        <span className="plot-mark" aria-hidden="true"><i /><i /><i /></span>
        PlotLine
      </Link>
      <nav aria-label="Primary navigation">
        {links.map((link) => (
          <Link className={pathname === link.href ? "active" : undefined} href={link.href} key={link.href}>
            {link.label}
          </Link>
        ))}
      </nav>
      <WalletButton />
    </header>
  );
}
