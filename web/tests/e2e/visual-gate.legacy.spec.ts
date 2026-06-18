// Proves the visual gate is REAL — i.e. that compareImages() actually
// discriminates, so a "visual test passing" means something. Two screenshots of
// the same settled legacy state must be ~identical (deterministic render), and
// the same screenshot vs a solid-black image must diverge massively. If either
// expectation breaks, the comparator (not just a capture) is broken.

import {test, expect, reachRidingView} from "./fixtures.js";
import {compareImages, solidPng, writeVisualReport} from "../visual/compare.js";

test.describe("visual gate self-test (the comparator must discriminate)", () => {
  test("identical renders ~0 diff; vs solid image ~total diff", async ({configuredPage}) => {
    const page = configuredPage;
    await reachRidingView(page);

    const shotA = await page.screenshot();
    const shotB = await page.screenshot();

    // 1) Determinism: two screenshots of the same settled state are ~identical.
    const same = compareImages(shotA, shotB);
    expect(same.sizeMismatch).toBe(false);
    expect(same.diffRatio).toBeLessThan(0.005);

    // 2) Negative control: vs a solid-black image of the same size, the
    //    comparator must report massive divergence (proves it isn't a no-op).
    const black = solidPng(same.width, same.height, [0, 0, 0, 255]);
    const broken = compareImages(shotA, black);
    expect(broken.diffRatio).toBeGreaterThan(0.5);

    writeVisualReport("_gate-selftest", shotA, shotB, same.diffPng, {
      identicalDiffRatio: same.diffRatio,
      negativeControlDiffRatio: broken.diffRatio,
      width: same.width,
      height: same.height,
    });
  });
});
