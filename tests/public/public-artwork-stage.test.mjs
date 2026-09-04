import assert from "node:assert/strict";
import test from "node:test";

import {
  STAGE_SWITCH_HYSTERESIS_PX,
  rememberStageReveal,
  selectStableStageIndex,
  shouldQueueStageActivation,
} from "../../lib/public-artwork-stage.ts";

test("a stage item is revealed only once across 0 to 1 to 0 to 1 activation", () => {
  const history = new WeakSet();
  const items = [{ index: 0 }, { index: 1 }];

  assert.equal(rememberStageReveal(history, items[0]), true);
  assert.equal(rememberStageReveal(history, items[1]), true);
  assert.equal(rememberStageReveal(history, items[0]), false);
  assert.equal(rememberStageReveal(history, items[1]), false);
});

test("stage activation ignores the active, queued, and in-flight targets", () => {
  const baseState = {
    activeIndex: 0,
    queuedIndex: 1,
    transitionTargetIndex: 2,
  };

  assert.equal(
    shouldQueueStageActivation({ ...baseState, requestedIndex: 0 }),
    false,
  );
  assert.equal(
    shouldQueueStageActivation({ ...baseState, requestedIndex: 1 }),
    false,
  );
  assert.equal(
    shouldQueueStageActivation({ ...baseState, requestedIndex: 2 }),
    false,
  );
  assert.equal(
    shouldQueueStageActivation({ ...baseState, requestedIndex: 3 }),
    true,
  );
});

test("stage selection resists small scroll jitter until a challenger clears the hysteresis", () => {
  const readingLineY = 500;

  assert.equal(STAGE_SWITCH_HYSTERESIS_PX, 48);
  assert.equal(selectStableStageIndex([], 0, readingLineY), null);
  assert.equal(
    selectStableStageIndex(
      [
        { index: 0, centerY: 560 },
        { index: 1, centerY: 513 },
      ],
      0,
      readingLineY,
    ),
    0,
    "a challenger only 47px closer must not replace the active item",
  );
  assert.equal(
    selectStableStageIndex(
      [
        { index: 0, centerY: 560 },
        { index: 1, centerY: 512 },
      ],
      0,
      readingLineY,
    ),
    1,
    "a challenger exactly 48px closer may replace the active item",
  );
  assert.equal(
    selectStableStageIndex(
      [
        { index: 1, centerY: 540 },
        { index: 2, centerY: 505 },
      ],
      0,
      readingLineY,
    ),
    2,
    "when the active item is absent, the nearest visible candidate wins",
  );
});
