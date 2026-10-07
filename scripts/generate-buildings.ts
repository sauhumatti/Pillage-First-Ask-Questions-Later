// biome-ignore-all lint/suspicious/noConsole: This script intentionally logs progress.
// Procedurally draws isometric art for the village buildings the graphics pack
// has no images for. The output is deterministic.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createSceneKit, renderWebp, round } from './scene-kit.ts';

const OUTPUT_DIR = join(
  process.cwd(),
  'apps',
  'web',
  'public',
  'village-buildings',
);

const SIZE = 300;
const OUTPUT_SIZE = 384;

type P3 = { x: number; y: number; z: number };
type P2 = { x: number; y: number };

// Isometric projection: x runs to the lower right, y to the lower left, z up
const CX = 150;
const CY = 226;
const K = 2;

const project = ({ x, y, z }: P3): P2 => ({
  x: CX + (x - y) * K,
  y: CY + ((x + y) * K) / 2 - z * K,
});

const points = (list: P3[]) =>
  list
    .map(project)
    .map(({ x, y }) => `${round(x)},${round(y)}`)
    .join(' ');

const polygon = (list: P3[], fill: string, extra = '') =>
  `<polygon points="${points(list)}" fill="${fill}" stroke="#2b1d12" stroke-width="1.4" stroke-linejoin="round" ${extra}/>`;

// Draws 2D content onto a flat face in 3D. Local x runs along u, local y along v
const face = (origin: P3, u: P3, v: P3, content: string) => {
  const o = project(origin);
  const pu = project({
    x: origin.x + u.x,
    y: origin.y + u.y,
    z: origin.z + u.z,
  });
  const pv = project({
    x: origin.x + v.x,
    y: origin.y + v.y,
    z: origin.z + v.z,
  });
  return `<g transform="matrix(${round(pu.x - o.x)} ${round(pu.y - o.y)} ${round(pv.x - o.x)} ${round(pv.y - o.y)} ${round(o.x)} ${round(o.y)})">${content}</g>`;
};

const outline = (width: number, height: number) =>
  `<rect width="${width}" height="${height}" fill="none" stroke="#2b1d12" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`;

const shade = (width: number, height: number, opacity: number) =>
  `<rect width="${width}" height="${height}" fill="#000" opacity="${opacity}"/>`;

// Wall textures, in local face coordinates (y up)
type Texture = (width: number, height: number) => string;

const stone =
  (base: string, mortar: string): Texture =>
  (width, height) => {
    const { between, pick } = createSceneKit({
      seed: Math.round(width * 31 + height * 7),
      width,
      height,
    });
    let svg = `<rect width="${width}" height="${height}" fill="${mortar}"/>`;
    const rowHeight = 5;

    for (let row = 0; row * rowHeight < height; row++) {
      let x = row % 2 === 0 ? 0 : -3;

      while (x < width) {
        const stoneWidth = between(5, 9);
        svg += `<rect x="${round(Math.max(x, 0) + 0.4)}" y="${round(row * rowHeight + 0.4)}" width="${round(Math.min(stoneWidth, width - Math.max(x, 0)) - 0.8)}" height="${Math.min(rowHeight, height - row * rowHeight) - 0.8}" rx="0.8" fill="${pick([base, base, shadeColor(base, -14), shadeColor(base, 12)])}"/>`;
        x += stoneWidth;
      }
    }

    return svg;
  };

const plaster =
  (base: string, timber: string): Texture =>
  (width, height) => {
    let svg = `<rect width="${width}" height="${height}" fill="${base}"/>`;
    const beam = (x1: number, y1: number, x2: number, y2: number) =>
      `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" stroke="${timber}" stroke-width="2"/>`;
    svg += beam(0, 1, width, 1) + beam(0, height - 1, width, height - 1);
    svg += beam(0, height / 2, width, height / 2);
    const bays = Math.max(2, Math.round(width / 14));

    for (let i = 0; i <= bays; i++) {
      const x = (i / bays) * width;
      svg += beam(x, 0, x, height);

      if (i < bays && i % 2 === 0) {
        svg += beam(x, height / 2, x + width / bays, height);
      }
    }

    return svg;
  };

const planks =
  (base: string): Texture =>
  (width, height) => {
    let svg = `<rect width="${width}" height="${height}" fill="${base}"/>`;

    for (let x = 4; x < width; x += 4) {
      svg += `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="${shadeColor(base, -30)}" stroke-width="0.8"/>`;
    }

    return svg;
  };

const logs =
  (base: string): Texture =>
  (width, height) => {
    let svg = `<rect width="${width}" height="${height}" fill="${shadeColor(base, -25)}"/>`;

    for (let y = 0; y < height; y += 4.5) {
      svg += `<rect x="-1" y="${round(y + 0.3)}" width="${width + 2}" height="4" rx="2" fill="${base}"/><line x1="0" y1="${round(y + 1.5)}" x2="${width}" y2="${round(y + 1.5)}" stroke="${shadeColor(base, 18)}" stroke-width="0.6"/>`;
    }

    return svg;
  };

const marble: Texture = (width, height) =>
  `<rect width="${width}" height="${height}" fill="#ece6d8"/>${Array.from(
    { length: Math.floor(height / 6) },
    (_, i) =>
      `<line x1="0" y1="${(i + 1) * 6}" x2="${width}" y2="${(i + 1) * 6}" stroke="#c9bfab" stroke-width="0.6"/>`,
  ).join('')}`;

function shadeColor(hex: string, amount: number) {
  const value = Number.parseInt(hex.slice(1), 16);
  const clamp = (channel: number) => Math.max(0, Math.min(255, channel));
  const r = clamp((value >> 16) + amount);
  const g = clamp(((value >> 8) & 0xff) + amount);
  const b = clamp((value & 0xff) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// Openings, in local face coordinates (y up)
const window_ = (x: number, y: number, width = 4, height = 6) =>
  `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#3a2a1c" stroke="#5b3d22" stroke-width="1"/><line x1="${x + width / 2}" y1="${y}" x2="${x + width / 2}" y2="${y + height}" stroke="#7a5432" stroke-width="0.6"/><rect x="${x + 0.6}" y="${y + height - 2.2}" width="${width - 1.2}" height="1.6" fill="#f3c86b" opacity="0.55"/>`;

const door = (x: number, width = 7, height = 11, color = '#6b4423') =>
  `<path d="M${x},0 v${height - width / 2} a${width / 2},${width / 2} 0 0 0 ${width},0 v-${height - width / 2} z" fill="${color}" stroke="#2b1d12" stroke-width="0.8"/><line x1="${x + width / 2}" y1="0" x2="${x + width / 2}" y2="${height}" stroke="#3d2614" stroke-width="0.5"/>`;

// Faces are mirrored on the right side, so content is drawn upside down
// unless we flip it. These wrap content so y=0 is the ground.
const upright = (height: number, content: string) =>
  `<g transform="translate(0 ${height}) scale(1 -1)">${content}</g>`;

type BoxOptions = {
  x: number;
  y: number;
  z?: number;
  w: number;
  d: number;
  h: number;
  texture: Texture;
  leftDetails?: string;
  rightDetails?: string;
  top?: string;
};

// A box with its front corner at (x + w, y + d). Left face is lit, right face shaded
const box = ({
  x,
  y,
  z = 0,
  w,
  d,
  h,
  texture,
  leftDetails = '',
  rightDetails = '',
  top,
}: BoxOptions) => {
  // Local y points down the wall so details use y=0 for the top; flip to ground-up
  const left = face(
    { x, y: y + d, z: z + h },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 0, z: -1 },
    `${texture(w, h)}${upright(h, leftDetails)}${shade(w, h, 0.04)}${outline(w, h)}`,
  );
  const right = face(
    { x: x + w, y: y + d, z: z + h },
    { x: 0, y: -1, z: 0 },
    { x: 0, y: 0, z: -1 },
    `${texture(d, h)}${upright(h, rightDetails)}${shade(d, h, 0.22)}${outline(d, h)}`,
  );
  const topFace =
    top === undefined
      ? ''
      : polygon(
          [
            { x, y, z: z + h },
            { x: x + w, y, z: z + h },
            { x: x + w, y: y + d, z: z + h },
            { x, y: y + d, z: z + h },
          ],
          top,
        );

  return left + right + topFace;
};

type RoofStyle = { base: string; line: string; kind: 'tiles' | 'thatch' };

const roofPattern = (
  width: number,
  height: number,
  { base, line, kind }: RoofStyle,
) => {
  let svg = `<rect width="${width}" height="${height}" fill="${base}"/>`;

  if (kind === 'tiles') {
    for (let y = 3.5; y < height; y += 3.5) {
      svg += `<line x1="0" y1="${round(y)}" x2="${width}" y2="${round(y)}" stroke="${line}" stroke-width="0.9"/>`;

      for (let x = (y / 3.5) % 2 === 0 ? 0 : 2.5; x < width; x += 5) {
        svg += `<line x1="${round(x)}" y1="${round(y - 3.5)}" x2="${round(x)}" y2="${round(y)}" stroke="${line}" stroke-width="0.5"/>`;
      }
    }
  } else {
    const { between } = createSceneKit({
      seed: Math.round(width * 13 + height),
      width,
      height,
    });

    for (let i = 0; i < width * height * 0.35; i++) {
      const x = between(0, width);
      const y = between(0, height);
      svg += `<line x1="${round(x)}" y1="${round(y)}" x2="${round(x + between(-0.6, 0.6))}" y2="${round(y + between(2, 4))}" stroke="${line}" stroke-width="0.6" opacity="0.8"/>`;
    }

    for (let y = 4; y < height; y += 4.5) {
      svg += `<line x1="0" y1="${round(y)}" x2="${width}" y2="${round(y)}" stroke="${line}" stroke-width="0.7" opacity="0.6"/>`;
    }
  }

  return svg;
};

// Gable roof with the ridge running along x
const gableRoof = (
  x: number,
  y: number,
  z: number,
  w: number,
  d: number,
  rise: number,
  style: RoofStyle,
  gable: Texture,
) => {
  const o = 3;
  const ridgeY = y + d / 2;
  const slope = Math.hypot(d / 2 + o, rise);
  const back = polygon(
    [
      { x: x - o, y: y - o, z },
      { x: x + w + o, y: y - o, z },
      { x: x + w + o, y: ridgeY, z: z + rise },
      { x: x - o, y: ridgeY, z: z + rise },
    ],
    shadeColor(style.base, -45),
  );
  const gableEnd = face(
    { x: x + w, y: y + d, z },
    { x: 0, y: -1, z: 0 },
    { x: 0, y: 0, z: 1 },
    `<clipPath id="gable-${x}-${z}"><path d="M0,0 L${d},0 L${d / 2},${rise} Z"/></clipPath><g clip-path="url(#gable-${x}-${z})">${gable(d, rise)}${shade(d, rise, 0.22)}</g><path d="M0,0 L${d},0 L${d / 2},${rise} Z" fill="none" stroke="#2b1d12" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`,
  );
  const front = face(
    { x: x - o, y: y + d + o, z },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: -(d / 2 + o) / slope, z: rise / slope },
    `${roofPattern(w + 2 * o, slope, style)}<rect width="${w + 2 * o}" height="${round(slope)}" fill="none" stroke="#2b1d12" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`,
  );
  const ridge = `<line x1="${round(project({ x: x - o, y: ridgeY, z: z + rise }).x)}" y1="${round(project({ x: x - o, y: ridgeY, z: z + rise }).y)}" x2="${round(project({ x: x + w + o, y: ridgeY, z: z + rise }).x)}" y2="${round(project({ x: x + w + o, y: ridgeY, z: z + rise }).y)}" stroke="${shadeColor(style.base, -60)}" stroke-width="2.6" stroke-linecap="round"/>`;

  return back + gableEnd + front + ridge;
};

// Four-sided roof meeting at a point, for towers
const pyramidRoof = (
  x: number,
  y: number,
  z: number,
  w: number,
  d: number,
  rise: number,
  color: string,
) => {
  const o = 2;
  const apex = { x: x + w / 2, y: y + d / 2, z: z + rise };
  const a = { x: x - o, y: y + d + o, z };
  const b = { x: x + w + o, y: y + d + o, z };
  const c = { x: x + w + o, y: y - o, z };
  return (
    polygon([a, b, apex], color) + polygon([b, c, apex], shadeColor(color, -40))
  );
};

const shadow = (cx: number, cy: number, rx: number, ry: number) => {
  const p = project({ x: cx, y: cy, z: 0 });
  return `<ellipse cx="${round(p.x + 6)}" cy="${round(p.y + 4)}" rx="${rx}" ry="${ry}" fill="#0c2408" opacity="0.3" filter="url(#blur)"/>`;
};

// Props, placed on the ground in 3D
const at = (p: P3, content: string) => {
  const { x, y } = project(p);
  return `<g transform="translate(${round(x)} ${round(y)}) scale(${K})">${content}</g>`;
};

const barrel = `<ellipse cx="0" cy="0" rx="5" ry="2.5" fill="#5b3d22"/><rect x="-5" y="-11" width="10" height="11" fill="#8a5a32" stroke="#2b1d12" stroke-width="1"/><line x1="-5" y1="-3" x2="5" y2="-3" stroke="#4a4f52" stroke-width="1.2"/><line x1="-5" y1="-8" x2="5" y2="-8" stroke="#4a4f52" stroke-width="1.2"/><ellipse cx="0" cy="-11" rx="5" ry="2.5" fill="#a87442" stroke="#2b1d12" stroke-width="1"/>`;

const sack = `<path d="M-5,0 Q-7,-8 -3,-11 L3,-11 Q7,-8 5,0 Z" fill="#d8c08a" stroke="#6b5a32" stroke-width="1"/><path d="M-3,-11 L0,-14 L3,-11" fill="none" stroke="#6b5a32" stroke-width="1"/>`;

const crate = (x: number, y: number, size = 8) =>
  box({
    x,
    y,
    w: size,
    d: size,
    h: size,
    texture: planks('#a87442'),
    top: '#c08a52',
  });

const flag = (color: string, height = 30) =>
  `<line x1="0" y1="0" x2="0" y2="-${height}" stroke="#4a3622" stroke-width="1.6"/><path d="M0,-${height} q7,-3 14,0 q-3,4 0,8 q-7,-3 -14,0 z" fill="${color}" stroke="#2b1d12" stroke-width="0.8"/><circle cx="0" cy="-${height}" r="1.4" fill="#e3b54a"/>`;

const smoke = (height = 26) =>
  `<g opacity="0.6">${[0, 1, 2]
    .map(
      (i) =>
        `<circle cx="${round(Math.sin(i * 1.7) * 3 + i * 2)}" cy="${-i * (height / 3) - 6}" r="${3 + i * 1.6}" fill="#d8d4cc"/>`,
    )
    .join('')}</g>`;

const column = (height: number) =>
  `<rect x="-2.5" y="-${height}" width="5" height="${height}" fill="#f2ede1" stroke="#8f877b" stroke-width="0.8"/><line x1="-1" y1="-${height - 2}" x2="-1" y2="-2" stroke="#cfc7b6" stroke-width="0.6"/><line x1="1" y1="-${height - 2}" x2="1" y2="-2" stroke="#cfc7b6" stroke-width="0.6"/><rect x="-3.5" y="-${height + 1.5}" width="7" height="2" fill="#e2dccf" stroke="#8f877b" stroke-width="0.6"/><rect x="-3.5" y="-1" width="7" height="2" fill="#e2dccf" stroke="#8f877b" stroke-width="0.6"/>`;

const svgDocument = (content: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}"><defs><filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter></defs>${content}</svg>`;

const redTiles: RoofStyle = { base: '#b0533a', line: '#6e2e1e', kind: 'tiles' };
const slate: RoofStyle = { base: '#56606a', line: '#2e353b', kind: 'tiles' };
const blueTiles: RoofStyle = {
  base: '#4f6f96',
  line: '#2b3f58',
  kind: 'tiles',
};
const thatch: RoofStyle = { base: '#d6a94a', line: '#9a7128', kind: 'thatch' };

const greyStone = stone('#9c978c', '#6f6a60');
const timberFrame = plaster('#efe2c4', '#5b3d22');

const buildings: Record<string, () => string> = {
  smithy: () =>
    svgDocument(
      shadow(0, 0, 64, 20) +
        box({
          x: -34,
          y: -26,
          w: 54,
          d: 36,
          h: 26,
          texture: greyStone,
          leftDetails: `${door(10, 12, 18, '#2a1a10')}<rect x="11.5" y="1" width="9" height="8" fill="#ff8a2a" opacity="0.85"/><rect x="13" y="2" width="6" height="5" fill="#ffd36a"/>${window_(34, 12)}`,
          rightDetails: window_(14, 12),
        }) +
        gableRoof(-34, -26, 26, 54, 36, 20, slate, greyStone) +
        box({
          x: 8,
          y: -24,
          w: 8,
          d: 8,
          h: 58,
          texture: greyStone,
          top: '#3a332c',
        }) +
        at({ x: 12, y: -20, z: 58 }, smoke(30)) +
        // Anvil and quenching barrel out front
        at(
          { x: 6, y: 22, z: 0 },
          `<rect x="-3" y="-8" width="6" height="8" fill="#4a3622"/><path d="M-9,-8 L9,-8 L7,-13 L-12,-13 Q-14,-11 -9,-8 Z" fill="#4a4f52" stroke="#1d1d1f" stroke-width="1"/>`,
        ) +
        at({ x: 26, y: 18, z: 0 }, barrel) +
        at(
          { x: -30, y: 18, z: 0 },
          `<line x1="-6" y1="0" x2="-6" y2="-16" stroke="#5b3d22" stroke-width="2"/><line x1="6" y1="0" x2="6" y2="-16" stroke="#5b3d22" stroke-width="2"/><line x1="-8" y1="-14" x2="8" y2="-14" stroke="#5b3d22" stroke-width="2"/><line x1="-3" y1="-14" x2="-3" y2="-2" stroke="#9aa3a8" stroke-width="1.6"/><line x1="0" y1="-14" x2="0" y2="-3" stroke="#9aa3a8" stroke-width="1.6"/><line x1="3" y1="-14" x2="3" y2="-2" stroke="#9aa3a8" stroke-width="1.6"/>`,
        ),
    ),

  embassy: () =>
    svgDocument(
      shadow(0, 0, 70, 22) +
        box({
          x: -36,
          y: -28,
          w: 66,
          d: 40,
          h: 36,
          texture: (w, h) =>
            `${marble(w, h)}${stone('#d8d0bf', '#b3a990')(w, 8)}`,
          leftDetails: `${door(28, 10, 16, '#7a4e2b')}${[6, 16, 44, 54].map((x) => window_(x, 20, 5, 8)).join('')}${[6, 16, 44, 54].map((x) => window_(x, 6, 5, 7)).join('')}`,
          rightDetails: `${window_(8, 20, 5, 8)}${window_(26, 20, 5, 8)}${window_(8, 6, 5, 7)}${window_(26, 6, 5, 7)}`,
        }) +
        gableRoof(-36, -28, 36, 66, 40, 18, redTiles, marble) +
        // Portico columns and steps
        [-24, -12, 0, 12]
          .map((x) => at({ x, y: 18, z: 0 }, column(30)))
          .join('') +
        box({
          x: -30,
          y: 12,
          w: 48,
          d: 10,
          h: 2,
          texture: marble,
          top: '#e2dccf',
        }) +
        // Flags of other peoples
        [
          ['#c23b2b', -38],
          ['#2f5fa8', -28],
          ['#3f8a3a', 30],
          ['#e3b54a', 42],
        ]
          .map(([color, x]) =>
            at({ x: Number(x), y: 26, z: 0 }, flag(String(color), 40)),
          )
          .join(''),
    ),

  'trade-office': () =>
    svgDocument(
      shadow(0, 0, 66, 20) +
        box({
          x: -34,
          y: -26,
          w: 56,
          d: 36,
          h: 30,
          texture: timberFrame,
          leftDetails: `${door(22, 10, 16)}${window_(6, 14, 6, 8)}${window_(42, 14, 6, 8)}`,
          rightDetails: `${window_(8, 14, 6, 8)}${window_(22, 14, 6, 8)}`,
        }) +
        gableRoof(-34, -26, 30, 56, 36, 18, blueTiles, timberFrame) +
        // Sign with scales
        at(
          { x: -8, y: 10, z: 26 },
          `<line x1="0" y1="0" x2="0" y2="8" stroke="#5b3d22" stroke-width="1.6"/><rect x="-7" y="8" width="14" height="10" rx="1" fill="#e3c88a" stroke="#5b3d22" stroke-width="1"/><path d="M0,10 v6 M-4,12 h8 M-4,12 l-2,3 h4 z M4,12 l-2,3 h4 z" stroke="#5b3d22" stroke-width="0.8" fill="#9aa3a8"/>`,
        ) +
        crate(26, 4) +
        crate(26, 13) +
        box({
          x: 27,
          y: 6,
          z: 8,
          w: 7,
          d: 7,
          h: 7,
          texture: planks('#a87442'),
          top: '#c08a52',
        }) +
        at({ x: 14, y: 26, z: 0 }, barrel) +
        at({ x: 4, y: 30, z: 0 }, barrel) +
        at({ x: -28, y: 22, z: 0 }, sack) +
        at({ x: -20, y: 26, z: 0 }, sack) +
        // Handcart
        at(
          { x: -40, y: 6, z: 0 },
          `<circle cx="0" cy="-4" r="5" fill="none" stroke="#3d2614" stroke-width="2"/><path d="M-12,-10 L10,-14 L12,-6 L-10,-2 Z" fill="#8a5a32" stroke="#2b1d12" stroke-width="1"/><path d="M-6,-12 q2,-6 6,-1 q3,-5 6,0" fill="#d8c08a" stroke="#6b5a32" stroke-width="0.8"/><line x1="10" y1="-14" x2="20" y2="-20" stroke="#5b3d22" stroke-width="1.6"/>`,
        ),
    ),

  'town-hall': () =>
    svgDocument(
      shadow(0, 0, 76, 24) +
        box({
          x: -40,
          y: -30,
          w: 72,
          d: 42,
          h: 34,
          texture: (w, h) => `${timberFrame(w, h)}${greyStone(w, 9)}`,
          leftDetails: `${door(31, 12, 18)}${[6, 18, 48, 60].map((x) => window_(x, 18, 5, 9)).join('')}`,
          rightDetails: `${window_(8, 18, 5, 9)}${window_(28, 18, 5, 9)}`,
        }) +
        gableRoof(-40, -30, 34, 72, 42, 20, redTiles, timberFrame) +
        // Clock tower
        box({
          x: -8,
          y: -8,
          z: 34,
          w: 14,
          d: 14,
          h: 30,
          texture: greyStone,
          leftDetails: `<circle cx="7" cy="20" r="4.5" fill="#f2ede1" stroke="#2b1d12" stroke-width="0.8"/><path d="M7,20 v3 M7,20 h-2.5" stroke="#2b1d12" stroke-width="0.8"/>`,
          rightDetails: `<circle cx="7" cy="20" r="4.5" fill="#f2ede1" stroke="#2b1d12" stroke-width="0.8"/>`,
        }) +
        pyramidRoof(-8, -8, 64, 14, 14, 22, '#b0533a') +
        at({ x: -1, y: -1, z: 86 }, flag('#c23b2b', 14)) +
        box({
          x: -14,
          y: 12,
          w: 26,
          d: 8,
          h: 2,
          texture: greyStone,
          top: '#bdb7aa',
        }) +
        at({ x: -30, y: 22, z: 0 }, flag('#2f5fa8', 34)) +
        at({ x: 26, y: 22, z: 0 }, flag('#2f5fa8', 34)),
    ),

  'great-warehouse': () =>
    svgDocument(
      shadow(0, 0, 80, 24) +
        box({
          x: -40,
          y: -34,
          w: 72,
          d: 44,
          h: 34,
          texture: greyStone,
          leftDetails: `${door(10, 14, 22, '#5b3d22')}${door(46, 14, 22, '#5b3d22')}${window_(32, 22, 5, 7)}${window_(64, 22, 5, 7)}`,
          rightDetails: `${door(14, 14, 22, '#5b3d22')}${window_(34, 22, 5, 7)}`,
        }) +
        gableRoof(-40, -34, 34, 72, 44, 22, slate, greyStone) +
        [
          [-38, 14],
          [-29, 14],
          [-38, 23],
          [20, 16],
          [29, 16],
        ]
          .map(([x, y]) => crate(Number(x), Number(y)))
          .join('') +
        box({
          x: -36,
          y: 15,
          z: 8,
          w: 7,
          d: 7,
          h: 7,
          texture: planks('#a87442'),
          top: '#c08a52',
        }) +
        at({ x: 10, y: 30, z: 0 }, barrel) +
        at({ x: 0, y: 34, z: 0 }, barrel) +
        at({ x: 32, y: 24, z: 0 }, barrel),
    ),

  'great-granary': () =>
    svgDocument(
      shadow(0, 0, 78, 24) +
        // Stilts
        [-40, -8, 24]
          .flatMap((x) =>
            [-30, 8].map((y) =>
              box({
                x,
                y,
                w: 4,
                d: 4,
                h: 10,
                texture: planks('#6b4423'),
              }),
            ),
          )
          .join('') +
        box({
          x: -42,
          y: -32,
          z: 10,
          w: 74,
          d: 44,
          h: 28,
          texture: planks('#a87442'),
          leftDetails: `${door(30, 14, 20, '#6b4423')}${window_(10, 14, 6, 6)}${window_(56, 14, 6, 6)}`,
          rightDetails: window_(18, 14, 6, 6),
          top: '#8a5a32',
        }) +
        gableRoof(-42, -32, 38, 74, 44, 26, thatch, planks('#a87442')) +
        // Ramp and sacks
        face(
          { x: -14, y: 30, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 0, y: -0.86, z: 0.5 },
          `${planks('#8a5a32')(16, 20)}${outline(16, 20)}`,
        ) +
        [
          [-34, 22],
          [-26, 26],
          [-30, 30],
          [16, 24],
          [24, 22],
          [20, 30],
        ]
          .map(([x, y]) => at({ x: Number(x), y: Number(y), z: 0 }, sack))
          .join(''),
    ),

  'gatherers-hut': () =>
    svgDocument(
      shadow(0, 0, 50, 16) +
        box({
          x: -22,
          y: -20,
          w: 36,
          d: 28,
          h: 20,
          texture: planks('#9b6a3c'),
          leftDetails: `${door(14, 8, 13)}${window_(4, 9, 5, 5)}`,
          rightDetails: window_(10, 9, 5, 5),
        }) +
        gableRoof(-22, -20, 20, 36, 28, 18, thatch, planks('#9b6a3c')) +
        // Baskets of berries and herbs
        [
          [-14, 18, '#7a2d4a'],
          [-4, 22, '#c23b2b'],
          [18, 14, '#3f6a2a'],
        ]
          .map(([x, y, color]) =>
            at(
              { x: Number(x), y: Number(y), z: 0 },
              `<path d="M-6,0 L-7,-7 L7,-7 L6,0 Z" fill="#c69a5a" stroke="#6b4423" stroke-width="1"/><path d="M-7,-7 h14" stroke="#6b4423" stroke-width="1"/>${[-4, -1, 2, 5].map((dx) => `<circle cx="${dx - 0.5}" cy="-8.5" r="2" fill="${color}"/>`).join('')}`,
            ),
          )
          .join('') +
        at(
          { x: 24, y: -4, z: 0 },
          `<line x1="-8" y1="0" x2="-8" y2="-20" stroke="#5b3d22" stroke-width="1.6"/><line x1="8" y1="0" x2="8" y2="-20" stroke="#5b3d22" stroke-width="1.6"/><line x1="-9" y1="-18" x2="9" y2="-18" stroke="#5b3d22" stroke-width="1.4"/>${[-5, -1, 3, 6].map((x) => `<path d="M${x},-18 l-1.5,7 h3 z" fill="#6f9a35"/>`).join('')}`,
        ),
    ),

  'hunters-lodge': () =>
    svgDocument(
      shadow(0, 0, 54, 18) +
        box({
          x: -24,
          y: -22,
          w: 40,
          d: 30,
          h: 22,
          texture: logs('#8a5a32'),
          leftDetails: `${door(16, 9, 14, '#4a2f18')}${window_(5, 10, 5, 5)}`,
          rightDetails: window_(11, 10, 5, 5),
        }) +
        gableRoof(-24, -22, 22, 40, 30, 18, slate, logs('#8a5a32')) +
        // Antlers over the door
        at(
          { x: -4, y: 8, z: 22 },
          `<path d="M0,0 q-6,-4 -8,-10 M-5,-3 l-4,-1 M-7,-7 l-3,-3 M0,0 q6,-4 8,-10 M5,-3 l4,-1 M7,-7 l3,-3" stroke="#efe2c4" stroke-width="1.4" fill="none" stroke-linecap="round"/>`,
        ) +
        // Hide drying rack and a woodpile
        at(
          { x: 26, y: 12, z: 0 },
          `<line x1="-10" y1="0" x2="-10" y2="-22" stroke="#5b3d22" stroke-width="1.8"/><line x1="10" y1="0" x2="10" y2="-22" stroke="#5b3d22" stroke-width="1.8"/><line x1="-12" y1="-20" x2="12" y2="-20" stroke="#5b3d22" stroke-width="1.6"/><path d="M-7,-20 q-2,8 1,15 q6,2 12,0 q3,-7 1,-15 z" fill="#b5835a" stroke="#6b4423" stroke-width="1"/>`,
        ) +
        at(
          { x: -26, y: 20, z: 0 },
          `${[0, 1, 2]
            .map(
              (row) =>
                `${[0, 1, 2 - row]
                  .slice(0, 3 - row)
                  .map(
                    (_, i) =>
                      `<circle cx="${i * 6 + row * 3 - 6}" cy="${-3 - row * 5}" r="3" fill="#d9b483" stroke="#6b4423" stroke-width="1"/>`,
                  )
                  .join('')}`,
            )
            .join('')}`,
        ),
    ),

  asclepeion: () =>
    svgDocument(
      shadow(0, 0, 72, 22) +
        // Stepped base
        box({
          x: -44,
          y: -32,
          w: 84,
          d: 54,
          h: 4,
          texture: marble,
          top: '#e2dccf',
        }) +
        box({
          x: -40,
          y: -28,
          z: 4,
          w: 76,
          d: 46,
          h: 3,
          texture: marble,
          top: '#ece6d8',
        }) +
        box({
          x: -32,
          y: -22,
          z: 7,
          w: 58,
          d: 30,
          h: 30,
          texture: marble,
          leftDetails: door(24, 10, 18, '#7a4e2b'),
        }) +
        gableRoof(-36, -26, 37, 66, 38, 14, redTiles, marble) +
        // Columns along the front and side
        [-34, -22, -10, 2, 14, 26]
          .map((x) => at({ x, y: 14, z: 7 }, column(30)))
          .join('') +
        [-12, 0].map((y) => at({ x: 32, y, z: 7 }, column(30))).join('') +
        // Bowl of healing herbs and a snake staff
        at(
          { x: -36, y: 28, z: 0 },
          `<path d="M-6,-4 h12 l-2,4 h-8 z" fill="#c9bfab" stroke="#8f877b" stroke-width="0.8"/>${[-3, 0, 3].map((x) => `<path d="M${x},-4 q-1,-6 1,-9" stroke="#4f9333" stroke-width="1.6" fill="none"/>`).join('')}`,
        ),
    ),
};

mkdirSync(OUTPUT_DIR, { recursive: true });

for (const [name, draw] of Object.entries(buildings)) {
  const path = join(OUTPUT_DIR, `${name}.webp`);
  await renderWebp(draw(), path, SIZE, OUTPUT_SIZE, 88);
  console.log(`Wrote ${path}`);
}
