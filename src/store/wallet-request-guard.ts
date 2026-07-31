export type WalletRequestIdentity = Readonly<{
  generation: number;
  userId: string;
}>;

export function createWalletRequestGuard() {
  let activeUserId: string | null = null;
  let generation = 0;

  return {
    activateUser(userId: string) {
      if (activeUserId === userId) return false;
      activeUserId = userId;
      generation += 1;
      return true;
    },
    begin(userId: string) {
      if (activeUserId !== userId) {
        activeUserId = userId;
        generation += 1;
      }

      generation += 1;
      const identity: WalletRequestIdentity = { generation, userId };
      return {
        identity,
        isCurrent(currentUserId: string | null) {
          return currentUserId === identity.userId
            && activeUserId === identity.userId
            && generation === identity.generation;
        },
      };
    },
    invalidate() {
      activeUserId = null;
      generation += 1;
    },
  };
}
