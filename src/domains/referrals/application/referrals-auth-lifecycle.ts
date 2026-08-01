export type ReferralsAuthIdentity = Readonly<{
  accessToken: string;
  userId: string;
}>;

export function createReferralsAuthIdentity(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
): ReferralsAuthIdentity | null {
  return userId && accessToken ? { accessToken, userId } : null;
}

export function isSameReferralsAuthIdentity(
  current: ReferralsAuthIdentity | null,
  expected: ReferralsAuthIdentity | null,
): boolean {
  return current !== null
    && expected !== null
    && current.userId === expected.userId
    && current.accessToken === expected.accessToken;
}

export function createLatestReferralsRequestGuard() {
  let generation = 0;
  let active: {
    generation: number;
    identity: ReferralsAuthIdentity;
  } | null = null;

  return {
    begin(identity: ReferralsAuthIdentity) {
      generation += 1;
      const requestGeneration = generation;
      active = { generation: requestGeneration, identity };

      return {
        isCurrent: (currentIdentity: ReferralsAuthIdentity | null) => (
          active?.generation === requestGeneration
          && isSameReferralsAuthIdentity(active.identity, identity)
          && isSameReferralsAuthIdentity(currentIdentity, identity)
        ),
      };
    },
    invalidate() {
      generation += 1;
      active = null;
    },
  };
}

type ReferralsLoadAdmission = Readonly<{
  coalescesWithActiveFlight: boolean;
  resetRetryCount?: boolean;
}>;

export function createReferralsRetryPolicy(maxAutoRetries: number) {
  let retryCount = 0;

  return {
    admitLoad({
      coalescesWithActiveFlight,
      resetRetryCount = false,
    }: ReferralsLoadAdmission): boolean {
      if (coalescesWithActiveFlight) return false;
      if (resetRetryCount) retryCount = 0;
      return true;
    },
    reset() {
      retryCount = 0;
    },
    reserveRetry(): boolean {
      if (retryCount >= maxAutoRetries) return false;
      retryCount += 1;
      return true;
    },
  };
}
