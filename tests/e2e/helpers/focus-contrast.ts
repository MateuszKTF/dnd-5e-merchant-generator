import type { Locator, Page } from "@playwright/test";

/**
 * Measure how visible a control's keyboard focus indicator actually is.
 *
 * WCAG 2.4.11 (Focus Appearance, AA) defines the requirement in terms of *the
 * same pixels in the focused and unfocused states*: the indicator must reach
 * 3:1 against what was there before it appeared. That is what this measures —
 * it screenshots the control plus a margin twice, once unfocused and once
 * keyboard-focused, and returns the strongest per-pixel contrast between the
 * two states.
 *
 * Measuring painted pixels rather than computed styles is deliberate, and it is
 * why this is E2E work and not a jsdom test:
 *
 *   - `outline-style: none` still reports a width and a colour, so a computed
 *     style says "3px grey ring" for a control that paints nothing at all.
 *   - `outline-style: auto` reports the *author's* colour while Chromium paints
 *     its own high-contrast ring instead, so the computed value understates it.
 *   - `oklch()` and `color-mix()` have to be resolved by a real colour engine.
 *   - `:focus-visible` only applies to genuine keyboard focus.
 *
 * Only a browser that actually paints can answer this. jsdom has no paint
 * engine and no `:focus-visible`, which is exactly why the test plan (§6.2)
 * lists colour contrast among the things it "cannot do honestly".
 *
 * The comparison is state-versus-state, so there is no stored baseline image —
 * restyling the app cannot break it, which is what separates this from the
 * pixel-snapshot anti-pattern the test plan warns about for Risk #7.
 */
export async function focusIndicatorContrast(page: Page, control: Locator): Promise<number> {
  const box = await control.boundingBox();
  if (box === null) throw new Error("control is not visible, so it has no focus indicator to measure");

  // The indicator is drawn outside the control's own box; 6px covers the
  // widest ring this project uses (a 3px ring at 1px offset).
  const margin = 6;
  const clip = {
    x: Math.max(0, Math.round(box.x - margin)),
    y: Math.max(0, Math.round(box.y - margin)),
    width: Math.round(box.width + margin * 2),
    height: Math.round(box.height + margin * 2),
  };

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const unfocused = (await page.screenshot({ clip })).toString("base64");

  await control.focus();
  const isFocusVisible = await control.evaluate((el) => el.matches(":focus-visible"));
  if (!isFocusVisible) {
    // Premise guard (lessons L-03): without `:focus-visible` the focus styles
    // never apply, so a low reading would say nothing about the indicator.
    throw new Error("control did not enter :focus-visible, so no focus styling was exercised");
  }
  const focused = (await page.screenshot({ clip })).toString("base64");

  return page.evaluate(
    async ([a, b]) => {
      const load = (base64: string): Promise<HTMLImageElement> =>
        new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => {
            resolve(image);
          };
          image.onerror = () => {
            reject(new Error("screenshot did not decode"));
          };
          image.src = `data:image/png;base64,${base64}`;
        });

      const [before, after] = await Promise.all([load(a), load(b)]);
      const canvas = document.createElement("canvas");
      canvas.width = before.width;
      canvas.height = before.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context === null) throw new Error("no 2d context");

      context.drawImage(before, 0, 0);
      const unfocusedPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(after, 0, 0);
      const focusedPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;

      // WCAG relative luminance.
      const channel = (value: number): number => {
        const v = value / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      const luminance = (r: number, g: number, bl: number): number =>
        0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(bl);

      let strongest = 1;
      for (let i = 0; i < unfocusedPixels.length; i += 4) {
        if (
          unfocusedPixels[i] === focusedPixels[i] &&
          unfocusedPixels[i + 1] === focusedPixels[i + 1] &&
          unfocusedPixels[i + 2] === focusedPixels[i + 2]
        ) {
          continue;
        }
        const one = luminance(unfocusedPixels[i], unfocusedPixels[i + 1], unfocusedPixels[i + 2]);
        const two = luminance(focusedPixels[i], focusedPixels[i + 1], focusedPixels[i + 2]);
        const [high, low] = one > two ? [one, two] : [two, one];
        const ratio = (high + 0.05) / (low + 0.05);
        if (ratio > strongest) strongest = ratio;
      }
      return strongest;
    },
    [unfocused, focused],
  );
}
