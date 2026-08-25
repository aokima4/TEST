/** AutoCAD Color Index（ACI）と RGB の相互変換 */
const BASE: [number, string][] = [
  [1, '#ff0000'], [2, '#ffff00'], [3, '#00ff00'], [4, '#00ffff'], [5, '#0000ff'],
  [6, '#ff00ff'], [7, '#ffffff'], [8, '#808080'], [9, '#c0c0c0'],
  [10, '#ff0000'], [11, '#ffaaaa'], [12, '#bd0000'], [13, '#bd7e7e'], [14, '#810000'],
  [20, '#ff3f00'], [30, '#ff7f00'], [40, '#ffbf00'], [50, '#ffff00'], [60, '#bfff00'],
  [70, '#7fff00'], [80, '#3fff00'], [90, '#00ff00'], [100, '#00ff3f'], [110, '#00ff7f'],
  [120, '#00ffbf'], [130, '#00ffff'], [140, '#00bfff'], [150, '#007fff'], [160, '#003fff'],
  [170, '#0000ff'], [180, '#3f00ff'], [190, '#7f00ff'], [200, '#bf00ff'], [210, '#ff00ff'],
  [220, '#ff00bf'], [230, '#ff007f'], [240, '#ff003f'],
  [250, '#333333'], [251, '#5b5b5b'], [252, '#848484'], [253, '#adadad'], [254, '#d6d6d6'], [255, '#ffffff'],
];

export function aciToHex(i: number): string {
  const hit = BASE.find(([k]) => k === i);
  if (hit) return hit[1];
  // 近いインデックスの色で代用
  let best = BASE[6];
  let bd = Infinity;
  for (const b of BASE) { const d = Math.abs(b[0] - i); if (d < bd) { bd = d; best = b; } }
  return best[1];
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3
    ? h.split('').map((c) => parseInt(c + c, 16))
    : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  return [v[0] || 0, v[1] || 0, v[2] || 0];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

export function hexToAci(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  let best = 7, bd = Infinity;
  for (const [i, h] of BASE) {
    const [r2, g2, b2] = hexToRgb(h);
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export function trueColorToHex(tc: number): string {
  return rgbToHex((tc >> 16) & 255, (tc >> 8) & 255, tc & 255);
}
export function hexToTrueColor(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (r << 16) | (g << 8) | b;
}
