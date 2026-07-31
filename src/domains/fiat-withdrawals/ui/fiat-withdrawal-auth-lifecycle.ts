export type FiatWithdrawalAuthIdentity = Readonly<{
  accessToken: string;
  userId: string;
}>;

export function createFiatWithdrawalAuthIdentity(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
): FiatWithdrawalAuthIdentity | null {
  return userId && accessToken ? { accessToken, userId } : null;
}

export function isSameFiatWithdrawalAuthIdentity(
  current: FiatWithdrawalAuthIdentity | null,
  expected: FiatWithdrawalAuthIdentity | null,
): boolean {
  return current !== null
    && expected !== null
    && current.userId === expected.userId
    && current.accessToken === expected.accessToken;
}

export function fiatWithdrawalAuthIdentityMatches(
  current: FiatWithdrawalAuthIdentity | null,
  expected: FiatWithdrawalAuthIdentity | null,
): boolean {
  return current === null && expected === null
    ? true
    : isSameFiatWithdrawalAuthIdentity(current, expected);
}

export function createLatestFiatWithdrawalRequestGuard() {
  let generation = 0;
  let active: {
    generation: number;
    identity: FiatWithdrawalAuthIdentity;
  } | null = null;

  return {
    begin(identity: FiatWithdrawalAuthIdentity) {
      generation += 1;
      const requestGeneration = generation;
      active = { generation: requestGeneration, identity };
      return {
        isCurrent: (currentIdentity: FiatWithdrawalAuthIdentity | null) => (
          active?.generation === requestGeneration
          && isSameFiatWithdrawalAuthIdentity(active.identity, identity)
          && isSameFiatWithdrawalAuthIdentity(currentIdentity, identity)
        ),
      };
    },
    invalidate() {
      generation += 1;
      active = null;
    },
  };
}
