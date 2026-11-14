export function walletMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /reject|cancel/i.test(message) ? "Wallet request cancelled." : message || fallback;
}
