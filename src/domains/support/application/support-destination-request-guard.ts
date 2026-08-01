export function createLatestSupportDestinationRequestGuard() {
  let generation = 0;

  return {
    begin() {
      generation += 1;
      const requestGeneration = generation;
      return {
        isCurrent: () => requestGeneration === generation,
      };
    },
    invalidate() {
      generation += 1;
    },
  };
}

type SupportDestinationRequestGuard = ReturnType<
  typeof createLatestSupportDestinationRequestGuard
>;

type SupportDestinationRequestOptions = {
  guard: SupportDestinationRequestGuard;
  isMounted: () => boolean;
  load: () => Promise<string | null>;
  publish: (url: string | null) => void;
};

export type SupportDestinationRequestResult =
  | { status: "resolved"; url: string | null }
  | { status: "stale" }
  | { status: "skipped" }
  | { status: "failed" };

export async function runLatestSupportDestinationRequest({
  guard,
  isMounted,
  load,
  publish,
}: SupportDestinationRequestOptions): Promise<SupportDestinationRequestResult> {
  const request = guard.begin();
  const url = await load();

  if (!isMounted() || !request.isCurrent()) {
    return { status: "stale" };
  }

  publish(url);
  return { status: "resolved", url };
}

export async function runPassiveSupportDestinationRequest({
  isInteractivePending,
  ...requestOptions
}: SupportDestinationRequestOptions & {
  isInteractivePending: () => boolean;
}): Promise<SupportDestinationRequestResult> {
  if (isInteractivePending()) {
    return { status: "skipped" };
  }

  return runLatestSupportDestinationRequest(requestOptions);
}

export function getSupportNavigationTarget(
  result: SupportDestinationRequestResult,
): string | null {
  if (result.status === "stale" || result.status === "skipped") {
    return null;
  }

  if (result.status === "failed") {
    return "/support";
  }

  return result.url ?? "/support";
}
