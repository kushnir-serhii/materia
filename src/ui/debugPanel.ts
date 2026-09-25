// `?debug=1` DOM tuning overlay — plain HTML (not Phaser), sliders for the
// selected material's density/friction/restitution and glass crack/break/
// load values. Mutates the runtime materials object the scene already reads
// from (see materials.ts's cloneMaterialsForRuntime), so changes apply to
// newly spawned pieces without touching the canonical MATERIALS.

import type { Material, MaterialId } from '../game/materials';
import { MATERIAL_IDS } from '../game/materials';

interface SliderSpec {
  label: string;
  get: (m: Material) => number;
  set: (m: Material, v: number) => void;
  min: number;
  max: number;
  step: number;
}

const SLIDERS: SliderSpec[] = [
  { label: 'density', get: (m) => m.physics.density, set: (m, v) => (m.physics.density = v), min: 0.1, max: 6, step: 0.05 },
  { label: 'friction', get: (m) => m.physics.friction, set: (m, v) => (m.physics.friction = v), min: 0, max: 1.5, step: 0.02 },
  {
    label: 'restitution',
    get: (m) => m.physics.restitution,
    set: (m, v) => (m.physics.restitution = v),
    min: 0,
    max: 1,
    step: 0.02,
  },
  { label: 'glass.crackForce', get: (m) => m.glass.crackForce, set: (m, v) => (m.glass.crackForce = v), min: 10, max: 2000, step: 10 },
  { label: 'glass.breakForce', get: (m) => m.glass.breakForce, set: (m, v) => (m.glass.breakForce = v), min: 10, max: 4000, step: 10 },
  { label: 'glass.loadLimit', get: (m) => m.glass.loadLimit, set: (m, v) => (m.glass.loadLimit = v), min: 1, max: 500, step: 1 },
];

export class DebugPanel {
  private root: HTMLDivElement;
  private select: HTMLSelectElement;
  private rows: { input: HTMLInputElement; valueLabel: HTMLSpanElement; spec: SliderSpec }[] = [];
  private selectedId: MaterialId = MATERIAL_IDS[0];

  constructor(private materials: Record<MaterialId, Material>) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'fixed',
      top: '8px',
      right: '8px',
      width: '210px',
      background: 'rgba(18,18,24,0.92)',
      border: '1px solid #4a4f5c',
      borderRadius: '6px',
      padding: '8px',
      font: '11px monospace',
      color: '#eee',
      zIndex: '1000',
    });

    const title = document.createElement('div');
    title.textContent = 'debug tuning';
    title.style.opacity = '0.7';
    title.style.marginBottom = '4px';
    this.root.appendChild(title);

    this.select = document.createElement('select');
    this.select.style.width = '100%';
    this.select.style.marginBottom = '6px';
    MATERIAL_IDS.forEach((id) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = id;
      this.select.appendChild(opt);
    });
    this.select.addEventListener('change', () => {
      this.selectedId = this.select.value as MaterialId;
      this.refresh();
    });
    this.root.appendChild(this.select);

    for (const spec of SLIDERS) {
      const row = document.createElement('div');
      row.style.marginBottom = '4px';

      const labelRow = document.createElement('div');
      labelRow.textContent = `${spec.label} `;
      const valueLabel = document.createElement('span');
      labelRow.appendChild(valueLabel);
      row.appendChild(labelRow);

      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(spec.min);
      input.max = String(spec.max);
      input.step = String(spec.step);
      input.style.width = '100%';
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        spec.set(this.materials[this.selectedId], v);
        valueLabel.textContent = v.toFixed(2);
      });
      row.appendChild(input);

      this.root.appendChild(row);
      this.rows.push({ input, valueLabel, spec });
    }

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'copy values';
    copyBtn.style.width = '100%';
    copyBtn.style.marginTop = '2px';
    copyBtn.addEventListener('click', () => {
      const json = JSON.stringify(this.materials[this.selectedId], null, 2);
      navigator.clipboard?.writeText(json).catch(() => {
        // clipboard unavailable (permissions, insecure context) — nothing more we can do
      });
      const original = copyBtn.textContent;
      copyBtn.textContent = 'copied!';
      setTimeout(() => {
        copyBtn.textContent = original;
      }, 800);
    });
    this.root.appendChild(copyBtn);

    document.body.appendChild(this.root);
    this.refresh();
  }

  private refresh(): void {
    this.select.value = this.selectedId;
    const m = this.materials[this.selectedId];
    for (const { input, valueLabel, spec } of this.rows) {
      const v = spec.get(m);
      input.value = String(v);
      valueLabel.textContent = v.toFixed(2);
    }
  }

  destroy(): void {
    this.root.remove();
  }
}
