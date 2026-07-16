export type BscWatcherRange = {
  fromBlock: number;
  toBlock: number;
};

type BscWatcherRangePlanOptions = {
  checkpoint: number;
  safeHead: number;
  initialLookbackBlocks: number;
  blocksPerBatch: number;
  maxBatches: number;
};

export function planBscWatcherRanges({
  checkpoint,
  safeHead,
  initialLookbackBlocks,
  blocksPerBatch,
  maxBatches,
}: BscWatcherRangePlanOptions): BscWatcherRange[] {
  if (
    !Number.isSafeInteger(checkpoint) ||
    !Number.isSafeInteger(safeHead) ||
    !Number.isSafeInteger(initialLookbackBlocks) ||
    !Number.isSafeInteger(blocksPerBatch) ||
    !Number.isSafeInteger(maxBatches) ||
    checkpoint < 0 ||
    initialLookbackBlocks <= 0 ||
    blocksPerBatch <= 0 ||
    maxBatches <= 0
  ) {
    throw new Error("Invalid BSC watcher range-plan input");
  }

  if (safeHead < 0 || checkpoint >= safeHead) return [];

  const ranges: BscWatcherRange[] = [];
  let fromBlock = checkpoint === 0
    ? Math.max(0, safeHead - initialLookbackBlocks + 1)
    : checkpoint + 1;

  while (fromBlock <= safeHead && ranges.length < maxBatches) {
    const toBlock = Math.min(safeHead, fromBlock + blocksPerBatch - 1);
    ranges.push({ fromBlock, toBlock });
    fromBlock = toBlock + 1;
  }

  return ranges;
}
