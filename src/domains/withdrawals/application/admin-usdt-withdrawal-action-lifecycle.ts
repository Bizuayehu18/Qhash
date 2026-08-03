const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function createLatestAdminWithdrawalRequestGuard() {
  let generation = 0;
  let active: {
    controller: AbortController;
    generation: number;
    identity: unknown;
  } | null = null;

  return {
    begin(identity: unknown) {
      generation += 1;
      active?.controller.abort();
      const controller = new AbortController();
      const requestGeneration = generation;
      active = { controller, generation: requestGeneration, identity };
      return {
        generation: requestGeneration,
        signal: controller.signal,
        isCurrent: () => (
          active?.controller === controller
          && active.generation === requestGeneration
          && Object.is(active.identity, identity)
          && !controller.signal.aborted
        ),
      };
    },
    invalidate() {
      generation += 1;
      active?.controller.abort();
      active = null;
    },
  };
}

export function createAdminWithdrawalActionKeyManager(
  createKey: () => string = () => globalThis.crypto.randomUUID(),
) {
  let fingerprint: string | null = null;
  let key: string | null = null;

  return {
    keyFor(nextFingerprint: string) {
      if (fingerprint !== nextFingerprint || key === null) {
        const nextKey = createKey();
        if (!UUID_V4_PATTERN.test(nextKey)) {
          throw new Error("invalid_action_key_factory");
        }
        fingerprint = nextFingerprint;
        key = nextKey.toLowerCase();
      }
      return key;
    },
    clear() {
      fingerprint = null;
      key = null;
    },
  };
}

export function runAdminWithdrawalSingleFlight<T>(
  holder: { current: Promise<T> | null },
  operation: () => Promise<T>,
): Promise<T> {
  if (holder.current) return holder.current;
  const current = operation();
  holder.current = current;
  void current.finally(() => {
    if (holder.current === current) holder.current = null;
  }).catch(() => {
    // The caller observes the original rejection; this handles cleanup only.
  });
  return current;
}

export function createAdminWithdrawalActionLifecycle(
  identity: {
    userId: string;
    tokenGeneration: number;
  },
  createKey: () => string = () => globalThis.crypto.randomUUID(),
) {
  const controller = new AbortController();
  const promiseHolder: { current: Promise<void> | null } = { current: null };
  const actionKeys = createAdminWithdrawalActionKeyManager(createKey);
  let active = true;
  let busy = false;
  let noticeId: string | number | null = null;

  return {
    identity,
    signal: controller.signal,
    isActive: () => active,
    isBusy: () => busy,
    run(
      fingerprint: string,
      operation: (context: {
        actionId: string;
        signal: AbortSignal;
      }) => Promise<void>,
      onBusyChange: (nextBusy: boolean) => void,
    ): Promise<void> {
      if (!active) return Promise.resolve();
      return runAdminWithdrawalSingleFlight(promiseHolder, async () => {
        if (!active) return;
        const actionId = actionKeys.keyFor(fingerprint);
        busy = true;
        onBusyChange(true);
        try {
          await operation({
            actionId,
            signal: controller.signal,
          });
        } finally {
          if (active) {
            busy = false;
            onBusyChange(false);
          }
        }
      });
    },
    clearActionKey() {
      if (active) actionKeys.clear();
    },
    setNotice(
      nextNoticeId: string | number,
      dismiss: (id: string | number) => void,
    ) {
      if (!active) {
        dismiss(nextNoticeId);
        return;
      }
      if (noticeId !== null) dismiss(noticeId);
      noticeId = nextNoticeId;
    },
    invalidate(dismiss: (id: string | number) => void = () => undefined) {
      if (!active) return;
      active = false;
      busy = false;
      controller.abort();
      actionKeys.clear();
      if (noticeId !== null) {
        dismiss(noticeId);
        noticeId = null;
      }
    },
  };
}
