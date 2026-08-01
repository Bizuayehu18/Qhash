export type NotificationsAuthIdentity = Readonly<{
  accessToken: string;
  userId: string;
}>;

export function createNotificationsAuthIdentity(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
): NotificationsAuthIdentity | null {
  return userId && accessToken ? { accessToken, userId } : null;
}

export function isSameNotificationsAuthIdentity(
  current: NotificationsAuthIdentity | null,
  expected: NotificationsAuthIdentity | null,
): boolean {
  return current !== null
    && expected !== null
    && current.userId === expected.userId
    && current.accessToken === expected.accessToken;
}

export function createLatestNotificationsRequestGuard() {
  let generation = 0;
  let active: {
    generation: number;
    identity: NotificationsAuthIdentity;
  } | null = null;

  return {
    begin(identity: NotificationsAuthIdentity) {
      generation += 1;
      const requestGeneration = generation;
      active = { generation: requestGeneration, identity };

      return {
        isCurrent: (currentIdentity: NotificationsAuthIdentity | null) => (
          active?.generation === requestGeneration
          && isSameNotificationsAuthIdentity(active.identity, identity)
          && isSameNotificationsAuthIdentity(currentIdentity, identity)
        ),
      };
    },
    invalidate() {
      generation += 1;
      active = null;
    },
  };
}

type NotificationsLoadAdmission = Readonly<{
  coalescesWithActiveFlight: boolean;
  resetRetryCount?: boolean;
}>;

export function createNotificationsRetryPolicy(maxAutoRetries: number) {
  let retryCount = 0;

  return {
    admitLoad({
      coalescesWithActiveFlight,
      resetRetryCount = false,
    }: NotificationsLoadAdmission): boolean {
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
