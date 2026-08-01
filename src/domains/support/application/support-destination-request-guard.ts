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

export async function runLatestSupportDestinationRequest({
  guard,
  isMounted,
  load,
  publish,
}: {
  guard: SupportDestinationRequestGuard;
  isMounted: () => boolean;
  load: () => Promise<string | null>;
  publish: (url: string | null) => void;
}) {
  const request = guard.begin();
  const url = await load();

  if (!isMounted() || !request.isCurrent()) {
    return null;
  }

  publish(url);
  return url;
}
