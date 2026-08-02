export type AuthenticatedRequestIdentity = Readonly<{
  accessToken: string;
  userId: string;
}>;

export function createAuthenticatedRequestIdentity(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
): AuthenticatedRequestIdentity | null {
  return userId && accessToken ? { accessToken, userId } : null;
}

export function isSameAuthenticatedRequestIdentity(
  current: AuthenticatedRequestIdentity | null,
  expected: AuthenticatedRequestIdentity | null,
): boolean {
  return current !== null
    && expected !== null
    && current.userId === expected.userId
    && current.accessToken === expected.accessToken;
}

export function createLatestAuthenticatedRequestGuard() {
  let generation = 0;
  let active: {
    generation: number;
    identity: AuthenticatedRequestIdentity;
  } | null = null;

  return {
    begin(identity: AuthenticatedRequestIdentity) {
      generation += 1;
      const requestGeneration = generation;
      active = { generation: requestGeneration, identity };

      return {
        isCurrent: (currentIdentity: AuthenticatedRequestIdentity | null) => (
          active?.generation === requestGeneration
          && isSameAuthenticatedRequestIdentity(active.identity, identity)
          && isSameAuthenticatedRequestIdentity(currentIdentity, identity)
        ),
      };
    },
    invalidate() {
      generation += 1;
      active = null;
    },
  };
}

export type AuthenticatedScopedRequestKey<Scope extends string> = Readonly<{
  identity: AuthenticatedRequestIdentity;
  scope: Scope;
}>;

export function createAuthenticatedScopedRequestKey<Scope extends string>(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
  scope: Scope,
): AuthenticatedScopedRequestKey<Scope> | null {
  const identity = createAuthenticatedRequestIdentity(userId, accessToken);
  return identity ? { identity, scope } : null;
}

export function isSameAuthenticatedScopedRequestKey<Scope extends string>(
  current: AuthenticatedScopedRequestKey<Scope> | null,
  expected: AuthenticatedScopedRequestKey<Scope> | null,
): boolean {
  return current !== null
    && expected !== null
    && current.scope === expected.scope
    && isSameAuthenticatedRequestIdentity(current.identity, expected.identity);
}

export function createLatestAuthenticatedScopedRequestGuard<Scope extends string>() {
  let generation = 0;
  let active: {
    generation: number;
    key: AuthenticatedScopedRequestKey<Scope>;
  } | null = null;

  return {
    begin(key: AuthenticatedScopedRequestKey<Scope>) {
      generation += 1;
      const requestGeneration = generation;
      active = { generation: requestGeneration, key };

      return {
        isCurrent: (currentKey: AuthenticatedScopedRequestKey<Scope> | null) => (
          active?.generation === requestGeneration
          && isSameAuthenticatedScopedRequestKey(active.key, key)
          && isSameAuthenticatedScopedRequestKey(currentKey, key)
        ),
      };
    },
    invalidate() {
      generation += 1;
      active = null;
    },
  };
}

type RequestLoadAdmission = Readonly<{
  coalescesWithActiveFlight: boolean;
  resetRetryCount?: boolean;
}>;

export function createRequestRetryPolicy(maxRetries: number) {
  let retryCount = 0;

  return {
    admitLoad({
      coalescesWithActiveFlight,
      resetRetryCount = false,
    }: RequestLoadAdmission): boolean {
      if (coalescesWithActiveFlight) return false;
      if (resetRetryCount) retryCount = 0;
      return true;
    },
    reset() {
      retryCount = 0;
    },
    reserveRetry(): boolean {
      if (retryCount >= maxRetries) return false;
      retryCount += 1;
      return true;
    },
  };
}
