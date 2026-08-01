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
