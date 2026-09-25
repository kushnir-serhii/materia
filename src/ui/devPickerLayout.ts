// Pure layout math for the dev material-picker panel (Hud.ts), split out
// from hud.ts so it can be imported by e2e tests without pulling in Phaser
// (which throws at import time outside a browser — Playwright's spec files
// run under Node, not a page).

import { ALL_MATERIAL_IDS } from '../game/materials';

const SCREEN_W = 540;
const SWATCH_SIZE = 28;
const SWATCH_GAP = 4;
const PANEL_RIGHT_X = SCREEN_W - 16;
const PANEL_TOP_Y = 74;

export const DEV_PICKER_LAYOUT = {
  wrenchX: SCREEN_W - 88,
  wrenchY: 46,
  panelTopY: PANEL_TOP_Y,
  swatchSize: SWATCH_SIZE,
  swatchGap: SWATCH_GAP,
  panelRightX: PANEL_RIGHT_X,
  swatchCenterX: (i: number): number => {
    const totalW = ALL_MATERIAL_IDS.length * SWATCH_SIZE + (ALL_MATERIAL_IDS.length - 1) * SWATCH_GAP;
    const leftX = PANEL_RIGHT_X - totalW;
    return leftX + i * (SWATCH_SIZE + SWATCH_GAP) + SWATCH_SIZE / 2;
  },
  swatchCenterY: PANEL_TOP_Y + SWATCH_SIZE / 2,
};
