// Pure layout math for the dev material-picker panel (Hud.ts), split out
// from hud.ts so it can be imported by e2e tests without pulling in Phaser
// (which throws at import time outside a browser — Playwright's spec files
// run under Node, not a page).
//
// 8 materials (ALL_MATERIAL_IDS) plus one "Wormy" swatch (forces the next
// piece to a wormy wood variant — see GDD §2.0 "Looks & living details"),
// laid out 4 per row over 3 rows so the panel stays a reasonable width —
// plus one text line below the grid showing the selected swatch's props
// (see Hud.setSelectedMaterial).

import { ALL_MATERIAL_IDS } from '../game/materials';

const SCREEN_W = 540;
const SWATCH_SIZE = 30;
const SWATCH_GAP = 5;
const COLUMNS = 4;
const PANEL_RIGHT_X = SCREEN_W - 16;
const PANEL_TOP_Y = 74;
/** Height reserved for the props text line under the swatch grid. */
const PROPS_LINE_H = 16;

/** Every material swatch plus the extra "Wormy" swatch at the end (index ALL_MATERIAL_IDS.length). */
export const TOTAL_SWATCHES = ALL_MATERIAL_IDS.length + 1;
/** Index of the "Wormy" swatch in the grid (last cell). */
export const WORMY_SWATCH_INDEX = ALL_MATERIAL_IDS.length;

const ROWS = Math.ceil(TOTAL_SWATCHES / COLUMNS);
const GRID_W = COLUMNS * SWATCH_SIZE + (COLUMNS - 1) * SWATCH_GAP;
const GRID_LEFT_X = PANEL_RIGHT_X - GRID_W;

export const DEV_PICKER_LAYOUT = {
  wrenchX: SCREEN_W - 88,
  wrenchY: 46,
  panelTopY: PANEL_TOP_Y,
  swatchSize: SWATCH_SIZE,
  swatchGap: SWATCH_GAP,
  panelRightX: PANEL_RIGHT_X,
  columns: COLUMNS,
  rows: ROWS,
  gridW: GRID_W,
  gridH: ROWS * SWATCH_SIZE + (ROWS - 1) * SWATCH_GAP,
  propsLineH: PROPS_LINE_H,
  swatchCenterX: (i: number): number => {
    const col = i % COLUMNS;
    return GRID_LEFT_X + col * (SWATCH_SIZE + SWATCH_GAP) + SWATCH_SIZE / 2;
  },
  swatchCenterY: (i: number): number => {
    const row = Math.floor(i / COLUMNS);
    return PANEL_TOP_Y + row * (SWATCH_SIZE + SWATCH_GAP) + SWATCH_SIZE / 2;
  },
};
