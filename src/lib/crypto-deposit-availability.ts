export type CryptoDepositNetwork = "TRON" | "BSC";

export function isUserCryptoDepositNetworkEnabled(
  network: CryptoDepositNetwork,
  bscUserDepositsEnabled: boolean,
): boolean {
  return network === "BSC" && bscUserDepositsEnabled;
}
