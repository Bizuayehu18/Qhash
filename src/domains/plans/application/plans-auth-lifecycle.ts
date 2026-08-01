export type PlansAuthIdentity = Readonly<{
  accessToken: string;
  userId: string;
}>;

export function createPlansAuthIdentity(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
): PlansAuthIdentity | null {
  return userId && accessToken ? { accessToken, userId } : null;
}

export function isSamePlansAuthIdentity(
  current: PlansAuthIdentity | null,
  expected: PlansAuthIdentity | null,
): boolean {
  return current !== null
    && expected !== null
    && current.userId === expected.userId
    && current.accessToken === expected.accessToken;
}

export function createLatestPlansRequestGuard() {
  let generation = 0;
  let active: { generation: number; identity: PlansAuthIdentity } | null = null;

  return {
    begin(identity: PlansAuthIdentity) {
      generation += 1;
      const requestGeneration = generation;
      active = { generation: requestGeneration, identity };

      return {
        isCurrent: (currentIdentity: PlansAuthIdentity | null) => (
          active?.generation === requestGeneration
          && isSamePlansAuthIdentity(active.identity, identity)
          && isSamePlansAuthIdentity(currentIdentity, identity)
        ),
      };
    },
    invalidate() {
      generation += 1;
      active = null;
    },
  };
}

export function createPlansPurchaseFlightGuard() {
  let generation = 0;
  const activeByUserId = new Map<string, number>();

  return {
    begin(userId: string) {
      if (activeByUserId.has(userId)) return null;

      generation += 1;
      const flightGeneration = generation;
      activeByUserId.set(userId, flightGeneration);

      return {
        settle() {
          if (activeByUserId.get(userId) !== flightGeneration) return false;
          activeByUserId.delete(userId);
          return true;
        },
      };
    },
    isActiveFor(userId: string | null | undefined) {
      return Boolean(userId && activeByUserId.has(userId));
    },
  };
}

type PlansPurchaseReconciliationOptions = Readonly<{
  getCurrentIdentity: () => PlansAuthIdentity | null;
  isMounted: () => boolean;
  refreshCatalog: (identity: PlansAuthIdentity) => Promise<boolean>;
  refreshWallet: (identity: PlansAuthIdentity) => Promise<boolean>;
  userId: string;
  waitBeforeRetry: () => Promise<void>;
  waitForPriorCatalog: (userId: string) => Promise<void>;
}>;

export async function reconcilePlansPurchaseFlight(
  options: PlansPurchaseReconciliationOptions,
): Promise<"inactive" | "reconciled"> {
  while (options.isMounted()) {
    const beforeWait = options.getCurrentIdentity();
    if (beforeWait?.userId !== options.userId) return "inactive";

    await options.waitForPriorCatalog(options.userId);

    const refreshIdentity = options.getCurrentIdentity();
    if (refreshIdentity?.userId !== options.userId) return "inactive";

    const [walletRefreshed, catalogRefreshed] = await Promise.all([
      options.refreshWallet(refreshIdentity),
      options.refreshCatalog(refreshIdentity),
    ]);

    const currentIdentity = options.getCurrentIdentity();
    if (currentIdentity?.userId !== options.userId) return "inactive";
    if (
      walletRefreshed
      && catalogRefreshed
      && isSamePlansAuthIdentity(currentIdentity, refreshIdentity)
    ) {
      return "reconciled";
    }

    await options.waitBeforeRetry();
  }

  return "inactive";
}
