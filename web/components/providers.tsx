"use client";

import { NearProvider } from "near-connect-hooks";
import { TESTNET_RPC_URLS } from "@/lib/network";

const nearConfig = { network: "testnet" as const, providers: { testnet: [...TESTNET_RPC_URLS] } };

export function Providers({ children }: { children: React.ReactNode }) {
  return <NearProvider config={nearConfig}>{children}</NearProvider>;
}
