import assert from "node:assert/strict";
import test from "node:test";
import { planBscWatcherRanges } from "../src/lib/server/bsc-watcher-range-plan.ts";

const defaults = {
  initialLookbackBlocks: 2_000,
  blocksPerBatch: 100,
  maxBatches: 5,
};

test("plans five contiguous provider-safe batches while catching up", () => {
  assert.deepEqual(
    planBscWatcherRanges({
      ...defaults,
      checkpoint: 1_000,
      safeHead: 3_000,
    }),
    [
      { fromBlock: 1_001, toBlock: 1_100 },
      { fromBlock: 1_101, toBlock: 1_200 },
      { fromBlock: 1_201, toBlock: 1_300 },
      { fromBlock: 1_301, toBlock: 1_400 },
      { fromBlock: 1_401, toBlock: 1_500 },
    ],
  );
});

test("limits the first run to the configured lookback window", () => {
  assert.deepEqual(
    planBscWatcherRanges({
      ...defaults,
      checkpoint: 0,
      safeHead: 10_000,
    }),
    [
      { fromBlock: 8_001, toBlock: 8_100 },
      { fromBlock: 8_101, toBlock: 8_200 },
      { fromBlock: 8_201, toBlock: 8_300 },
      { fromBlock: 8_301, toBlock: 8_400 },
      { fromBlock: 8_401, toBlock: 8_500 },
    ],
  );
});

test("caps the final batch at the safe head", () => {
  assert.deepEqual(
    planBscWatcherRanges({
      ...defaults,
      checkpoint: 1_000,
      safeHead: 1_150,
    }),
    [
      { fromBlock: 1_001, toBlock: 1_100 },
      { fromBlock: 1_101, toBlock: 1_150 },
    ],
  );
});

test("returns no work when the checkpoint is already at the safe head", () => {
  assert.deepEqual(
    planBscWatcherRanges({
      ...defaults,
      checkpoint: 1_000,
      safeHead: 1_000,
    }),
    [],
  );
});

test("rejects invalid batch limits instead of creating an unsafe plan", () => {
  assert.throws(
    () => planBscWatcherRanges({
      ...defaults,
      checkpoint: 1_000,
      safeHead: 2_000,
      blocksPerBatch: 0,
    }),
    /Invalid BSC watcher range-plan input/,
  );
});
