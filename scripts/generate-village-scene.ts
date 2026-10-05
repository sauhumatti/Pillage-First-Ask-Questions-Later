// biome-ignore-all lint/suspicious/noConsole: This script intentionally logs progress.
// Procedurally draws the village view: the ground, roads, building plots, scenery,
// the wall ring in each tribe's style and the empty building site marker.
// The output is deterministic, so re-running it produces the same images.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const OUTPUT_DIR = join(
  process.cwd(),
  'apps',
  'web',
  'public',
  'village-scene',
);
const BUILDING_FIELD_STYLES = join(
  process.cwd(),
  'apps',
  'web',
  'app',
  '(game)',
  '(village-slug)',
  '(village)',
  'components',
  'building-field.module.scss',
);

// The village view is a 16:10 box, building positions are percentages of it
const W = 1600;
const H = 1000;
const OUTPUT_WIDTH = 1920;

type Point = { x: number; y: number };

// Deterministic random numbers
const createRandom = (seed: number) => {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const random = createRandom(20_260_505);
const between = (min: number, max: number) => min + random() * (max - min);
const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)]!;
const round = (value: number) => Math.round(value * 10) / 10;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const readBuildingFieldPositions = (): Map<number, Point> => {
  const scss = readFileSync(BUILDING_FIELD_STYLES, 'utf8');
  const positions = new Map<number, Point>();

  for (const match of scss.matchAll(/(\d+): \((\d+)% (\d+)%\)/g)) {
    const [, id, top, left] = match;
    positions.set(Number(id), {
      x: (Number(left) / 100) * W,
      y: (Number(top) / 100) * H,
    });
  }

  return positions;
};

const fields = readBuildingFieldPositions();
const villageFieldIds = Array.from({ length: 21 }, (_, index) => 19 + index);
const villagePlots = villageFieldIds.map((id) => fields.get(id)!);
const wallField = fields.get(40)!;

// Village layout
const CENTER: Point = { x: 800, y: 545 };
const WELL: Point = { x: 820, y: 525 };
const RING_ROAD = { rx: 430, ry: 292 };
const WALL = { rx: 612, ry: 446 };

const ellipsePoint = (rx: number, ry: number, angle: number): Point => ({
  x: CENTER.x + rx * Math.cos(angle),
  y: CENTER.y + ry * Math.sin(angle),
});

const isInsideEllipse = ({ x, y }: Point, rx: number, ry: number) =>
  ((x - CENTER.x) / rx) ** 2 + ((y - CENTER.y) / ry) ** 2 <= 1;

// Smooth path through points (Catmull-Rom to cubic Bézier)
const smoothPath = (points: Point[], closed = false): string => {
  const p = closed
    ? [points.at(-1)!, ...points, points[0]!, points[1]!]
    : [points[0]!, ...points, points.at(-1)!];
  let d = `M${round(p[1]!.x)},${round(p[1]!.y)}`;

  for (let i = 1; i < p.length - 2; i++) {
    const [p0, p1, p2, p3] = [p[i - 1]!, p[i]!, p[i + 1]!, p[i + 2]!];
    d += ` C${round(p1.x + (p2.x - p0.x) / 6)},${round(p1.y + (p2.y - p0.y) / 6)} ${round(p2.x - (p3.x - p1.x) / 6)},${round(p2.y - (p3.y - p1.y) / 6)} ${round(p2.x)},${round(p2.y)}`;
  }

  return closed ? `${d} Z` : d;
};

// Irregular closed shape around a center
const blob = (
  center: Point,
  rx: number,
  ry: number,
  wobble: number,
  steps = 48,
) => {
  const harmonics = Array.from({ length: 5 }, (_, k) => ({
    k: k + 2,
    amplitude: (between(0.2, 1) * wobble) / (k + 1),
    phase: between(0, Math.PI * 2),
  }));

  const points: Point[] = [];

  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    let scale = 1;

    for (const { k, amplitude, phase } of harmonics) {
      scale += amplitude * Math.sin(k * angle + phase);
    }

    points.push({
      x: center.x + rx * scale * Math.cos(angle),
      y: center.y + ry * scale * Math.sin(angle),
    });
  }

  return smoothPath(points, true);
};

// Roads, as polylines with a little wobble
const wobbleLine = (
  from: Point,
  to: Point,
  segments: number,
  amount: number,
) => {
  const points: Point[] = [];
  const length = distance(from, to);
  const normal = { x: -(to.y - from.y) / length, y: (to.x - from.x) / length };

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const offset = i === 0 || i === segments ? 0 : between(-amount, amount);
    points.push({
      x: from.x + (to.x - from.x) * t + normal.x * offset,
      y: from.y + (to.y - from.y) * t + normal.y * offset,
    });
  }

  return points;
};

const ringRoad = Array.from({ length: 40 }, (_, i) => {
  const angle = (i / 40) * Math.PI * 2;
  const wobble = 1 + 0.03 * Math.sin(angle * 3 + 1);
  return ellipsePoint(RING_ROAD.rx * wobble, RING_ROAD.ry * wobble, angle);
});

const exitAngles = {
  north: -Math.PI / 2 + 0.12,
  east: 0,
  south: Math.PI / 2 + 0.15,
  west: Math.PI - 0.05,
};

const exitRoads = Object.values(exitAngles).map((angle) => {
  const start = ellipsePoint(RING_ROAD.rx, RING_ROAD.ry, angle);
  const end = ellipsePoint(RING_ROAD.rx * 2.2, RING_ROAD.ry * 2.2, angle);
  return wobbleLine(start, end, 6, 14);
});

const spokeRoads = [
  -Math.PI / 2 + 0.12,
  Math.PI / 2 + 0.15,
  Math.PI - 0.05,
  0,
].map((angle) =>
  wobbleLine(WELL, ellipsePoint(RING_ROAD.rx, RING_ROAD.ry, angle), 4, 10),
);

const roadPolylines = [ringRoad, ...exitRoads, ...spokeRoads];

const distanceToRoad = (point: Point) => {
  let closest = Number.POSITIVE_INFINITY;

  for (const polyline of roadPolylines) {
    for (let i = 0; i < polyline.length - 1; i++) {
      const a = polyline[i]!;
      const b = polyline[i + 1]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy),
        ),
      );
      closest = Math.min(
        closest,
        distance(point, { x: a.x + dx * t, y: a.y + dy * t }),
      );
    }
  }

  return closest;
};

// Shared definitions: gradients and texture filters
const defs = `
<defs>
  <filter id="grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4"/>
    <feColorMatrix type="saturate" values="0"/>
  </filter>
  <filter id="patches" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.005" numOctaves="3" seed="9"/>
    <feColorMatrix type="matrix" values="0 0 0 0 0.85  0 0 0 0 0.95  0 0 0 0 0.35  0 0 0 1.6 -0.55"/>
  </filter>
  <filter id="soil" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="3" seed="12"/>
    <feColorMatrix type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.24  0 0 0 0 0.12  0 0 0 1.2 -0.45"/>
  </filter>
  <filter id="rough" x="-5%" y="-5%" width="110%" height="110%">
    <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="21" result="noise"/>
    <feDisplacementMap in="SourceGraphic" in2="noise" scale="9" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
    <feGaussianBlur stdDeviation="22"/>
  </filter>
  <filter id="shadow-blur" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="4"/>
  </filter>
  <radialGradient id="leaf-a" cx="0.38" cy="0.32" r="0.75">
    <stop offset="0" stop-color="#9fd062"/><stop offset="0.55" stop-color="#4f9333"/><stop offset="1" stop-color="#2a5a1f"/>
  </radialGradient>
  <radialGradient id="leaf-b" cx="0.38" cy="0.32" r="0.75">
    <stop offset="0" stop-color="#b6cf5c"/><stop offset="0.55" stop-color="#6f9a35"/><stop offset="1" stop-color="#3a5b1d"/>
  </radialGradient>
  <radialGradient id="leaf-c" cx="0.38" cy="0.32" r="0.75">
    <stop offset="0" stop-color="#7fc46a"/><stop offset="0.55" stop-color="#3d8040"/><stop offset="1" stop-color="#1f4c26"/>
  </radialGradient>
  <linearGradient id="pine" x1="0.2" y1="0" x2="0.8" y2="1">
    <stop offset="0" stop-color="#5f9a45"/><stop offset="1" stop-color="#1f4a26"/>
  </linearGradient>
  <radialGradient id="rock" cx="0.35" cy="0.3" r="0.8">
    <stop offset="0" stop-color="#d4d0c6"/><stop offset="0.6" stop-color="#9c978c"/><stop offset="1" stop-color="#6c675e"/>
  </radialGradient>
  <radialGradient id="water" cx="0.45" cy="0.4" r="0.7">
    <stop offset="0" stop-color="#7cc3d8"/><stop offset="0.7" stop-color="#3f88a8"/><stop offset="1" stop-color="#2d6b86"/>
  </radialGradient>
  <radialGradient id="pad" cx="0.45" cy="0.4" r="0.65">
    <stop offset="0" stop-color="#d9bd86"/><stop offset="0.75" stop-color="#c3a067"/><stop offset="1" stop-color="#a98552"/>
  </radialGradient>
  <radialGradient id="stone-cap" cx="0.4" cy="0.35" r="0.7">
    <stop offset="0" stop-color="#e2dcd2"/><stop offset="1" stop-color="#8f877b"/>
  </radialGradient>
</defs>`;

const shadow = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  opacity = 0.28,
) =>
  `<ellipse cx="${round(cx)}" cy="${round(cy)}" rx="${round(rx)}" ry="${round(ry)}" fill="#0c2408" opacity="${opacity}" filter="url(#shadow-blur)"/>`;

const deciduousTree = ({ x, y }: Point, size: number) => {
  const leaf = pick(['leaf-a', 'leaf-b', 'leaf-c']);
  let svg = shadow(x + size * 0.45, y + size * 0.55, size * 0.95, size * 0.55);
  svg += `<rect x="${round(x - size * 0.09)}" y="${round(y)}" width="${round(size * 0.18)}" height="${round(size * 0.55)}" rx="${round(size * 0.05)}" fill="#5b3d22"/>`;

  const lobes = 5 + Math.floor(random() * 3);

  for (let i = 0; i < lobes; i++) {
    const angle = (i / lobes) * Math.PI * 2 + between(-0.3, 0.3);
    const r = size * between(0.45, 0.62);
    const cx = x + Math.cos(angle) * size * 0.32;
    const cy = y - size * 0.25 + Math.sin(angle) * size * 0.26;
    svg += `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="url(#${leaf})" stroke="#1d3d14" stroke-opacity="0.35" stroke-width="1.5"/>`;
  }

  svg += `<circle cx="${round(x - size * 0.05)}" cy="${round(y - size * 0.35)}" r="${round(size * 0.5)}" fill="url(#${leaf})"/>`;

  return svg;
};

const pineTree = ({ x, y }: Point, size: number) => {
  let svg = shadow(x + size * 0.4, y + size * 0.35, size * 0.6, size * 0.32);
  svg += `<rect x="${round(x - size * 0.06)}" y="${round(y - size * 0.1)}" width="${round(size * 0.12)}" height="${round(size * 0.32)}" fill="#4d331c"/>`;

  for (let i = 0; i < 3; i++) {
    const width = size * (0.62 - i * 0.14);
    const base = y - i * size * 0.32;
    const top = base - size * 0.55;
    svg += `<path d="M${round(x - width)},${round(base)} L${round(x)},${round(top)} L${round(x + width)},${round(base)} Z" fill="url(#pine)" stroke="#173a1c" stroke-width="1.5" stroke-linejoin="round"/>`;
  }

  return svg;
};

const bush = ({ x, y }: Point, size: number) => {
  const leaf = pick(['leaf-a', 'leaf-b', 'leaf-c']);
  let svg = shadow(
    x + size * 0.3,
    y + size * 0.35,
    size * 0.9,
    size * 0.45,
    0.22,
  );

  for (let i = 0; i < 3; i++) {
    svg += `<circle cx="${round(x + (i - 1) * size * 0.45)}" cy="${round(y - (i === 1 ? size * 0.2 : 0))}" r="${round(size * between(0.42, 0.55))}" fill="url(#${leaf})"/>`;
  }

  return svg;
};

const rock = ({ x, y }: Point, size: number) => {
  const points = Array.from({ length: 7 }, (_, i) => {
    const angle = (i / 7) * Math.PI * 2;
    const r = size * between(0.75, 1.05);
    return `${round(x + Math.cos(angle) * r)},${round(y + Math.sin(angle) * r * 0.7)}`;
  });

  return `${shadow(x + size * 0.3, y + size * 0.35, size, size * 0.55, 0.25)}<polygon points="${points.join(' ')}" fill="url(#rock)" stroke="#57524a" stroke-width="1.5" stroke-linejoin="round"/>`;
};

const grassTuft = ({ x, y }: Point, light: boolean) => {
  const color = light ? '#9ccc5c' : '#3f7428';
  let d = '';

  for (let i = 0; i < 3; i++) {
    const dx = (i - 1) * 3;
    d += `M${round(x + dx)},${round(y)} l${round(between(-3, 3))},${round(-between(5, 10))} `;
  }

  return `<path d="${d}" stroke="${color}" stroke-width="1.6" stroke-linecap="round" opacity="0.7"/>`;
};

const flowerCluster = ({ x, y }: Point) => {
  const color = pick(['#f4f1e8', '#f2d34b', '#e889b5', '#c9a0e8']);
  let svg = '';

  for (let i = 0; i < 6; i++) {
    svg += `<circle cx="${round(x + between(-12, 12))}" cy="${round(y + between(-8, 8))}" r="${round(between(1.4, 2.4))}" fill="${color}"/>`;
  }

  return svg;
};

// Poisson-like scatter
const scatter = (
  count: number,
  isAllowed: (point: Point) => boolean,
  minDistance: number,
) => {
  const points: Point[] = [];
  let attempts = 0;

  while (points.length < count && attempts < count * 60) {
    attempts++;
    const point = { x: between(-30, W + 30), y: between(-30, H + 30) };

    if (
      isAllowed(point) &&
      points.every((other) => distance(other, point) >= minDistance)
    ) {
      points.push(point);
    }
  }

  return points;
};

const isNearPlot = (point: Point, clearance: number) =>
  villagePlots.some((plot) => distance(plot, point) < clearance) ||
  distance(wallField, point) < clearance;

const POND: Point = { x: 175, y: 880 };
const FARM: Point = { x: 1460, y: 150 };

const drawScene = () => {
  const layers: string[] = [defs];

  // Meadow
  layers.push(`<rect width="${W}" height="${H}" fill="#5b8f3d"/>`);
  layers.push(
    `<rect width="${W}" height="${H}" filter="url(#patches)" opacity="0.55"/>`,
  );

  // Lighter, trimmed green inside the village
  layers.push(
    `<path d="${blob(CENTER, WALL.rx * 0.98, WALL.ry * 0.98, 0.05)}" fill="#7eaa4e" filter="url(#soft)" opacity="0.85"/>`,
  );

  layers.push(
    `<rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.13" style="mix-blend-mode:multiply"/>`,
  );

  // Farm plots on the outskirts
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 2; column++) {
      const x = FARM.x - 120 + column * 125;
      const y = FARM.y - 110 + row * 72;
      const fill = pick(['#a88a4c', '#c2a65a', '#8fa84a', '#b59a52']);
      let stripes = '';

      for (let i = 1; i < 8; i++) {
        stripes += `<line x1="${x + 4}" y1="${y + i * 8}" x2="${x + 112}" y2="${y + i * 8}" stroke="#6d5a30" stroke-opacity="0.45" stroke-width="2"/>`;
      }

      layers.push(
        `<g filter="url(#rough)"><rect x="${x}" y="${y}" width="116" height="64" rx="4" fill="${fill}" stroke="#6b5a32" stroke-width="2"/>${stripes}</g>`,
      );
    }
  }

  // Pond with reeds
  layers.push(
    `<path d="${blob(POND, 135, 88, 0.12)}" fill="#7a6a3e" opacity="0.6" filter="url(#shadow-blur)"/>`,
  );
  layers.push(
    `<path d="${blob(POND, 122, 78, 0.12)}" fill="url(#water)" stroke="#c9d6a0" stroke-width="3"/>`,
  );
  layers.push(
    `<ellipse cx="${POND.x - 30}" cy="${POND.y - 22}" rx="40" ry="10" fill="#ffffff" opacity="0.25"/>`,
  );

  for (let i = 0; i < 26; i++) {
    const angle = between(0, Math.PI * 2);
    const x = POND.x + Math.cos(angle) * 128;
    const y = POND.y + Math.sin(angle) * 84;
    layers.push(
      `<path d="M${round(x)},${round(y)} l${round(between(-3, 3))},-${round(between(12, 20))}" stroke="#4d7a2c" stroke-width="2.4" stroke-linecap="round"/>`,
    );
  }

  // Roads: a dark edge, sandy surface, then pebbles
  const roadPaths = roadPolylines.map((polyline, index) =>
    smoothPath(polyline, index === 0),
  );
  const roadWidth = (index: number) =>
    index === 0 ? 34 : index <= exitRoads.length ? 30 : 24;

  layers.push(
    `<g filter="url(#rough)" fill="none" stroke-linecap="round" stroke-linejoin="round">${roadPaths
      .map(
        (d, index) =>
          `<path d="${d}" stroke="#8a6c3d" stroke-width="${roadWidth(index) + 8}" opacity="0.8"/>`,
      )
      .join('')}${roadPaths
      .map(
        (d, index) =>
          `<path d="${d}" stroke="#d6b77a" stroke-width="${roadWidth(index)}"/>`,
      )
      .join('')}</g>`,
  );

  for (const polyline of roadPolylines) {
    for (let i = 0; i < polyline.length - 1; i++) {
      const a = polyline[i]!;
      const b = polyline[i + 1]!;
      const pebbles = Math.round(distance(a, b) / 6);

      for (let j = 0; j < pebbles; j++) {
        const t = random();
        layers.push(
          `<ellipse cx="${round(a.x + (b.x - a.x) * t + between(-11, 11))}" cy="${round(a.y + (b.y - a.y) * t + between(-11, 11))}" rx="${round(between(1.5, 3.2))}" ry="${round(between(1.2, 2.4))}" fill="${pick(['#b89a63', '#e5cd98', '#a8875a'])}" opacity="0.8"/>`,
        );
      }
    }
  }

  // Cobbled square with a well
  layers.push(
    `<circle cx="${WELL.x}" cy="${WELL.y}" r="74" fill="#8a6c3d" opacity="0.8" filter="url(#rough)"/>`,
  );
  layers.push(`<circle cx="${WELL.x}" cy="${WELL.y}" r="68" fill="#c9b48a"/>`);

  for (let ring = 1; ring <= 4; ring++) {
    const stones = ring * 9;

    for (let i = 0; i < stones; i++) {
      const angle = (i / stones) * Math.PI * 2 + ring;
      const r = ring * 15;
      layers.push(
        `<rect x="${round(WELL.x + Math.cos(angle) * r - 5)}" y="${round(WELL.y + Math.sin(angle) * r - 4)}" width="10" height="8" rx="2" fill="${pick(['#d9cdb0', '#bfb092', '#cfc1a2'])}" stroke="#8d7e62" stroke-width="1" transform="rotate(${round((angle * 180) / Math.PI)} ${round(WELL.x + Math.cos(angle) * r)} ${round(WELL.y + Math.sin(angle) * r)})"/>`,
      );
    }
  }

  layers.push(shadow(WELL.x + 10, WELL.y + 12, 26, 14, 0.35));
  layers.push(
    `<circle cx="${WELL.x}" cy="${WELL.y}" r="22" fill="url(#stone-cap)" stroke="#5f584e" stroke-width="2"/>`,
  );
  layers.push(
    `<circle cx="${WELL.x}" cy="${WELL.y}" r="13" fill="#2c5f78" stroke="#4a443c" stroke-width="2"/>`,
  );
  layers.push(
    `<path d="M${WELL.x - 24},${WELL.y - 4} L${WELL.x - 24},${WELL.y - 34} L${WELL.x + 24},${WELL.y - 34} L${WELL.x + 24},${WELL.y - 4}" fill="none" stroke="#5b3d22" stroke-width="4"/>`,
  );
  layers.push(
    `<path d="M${WELL.x - 32},${WELL.y - 30} L${WELL.x},${WELL.y - 46} L${WELL.x + 32},${WELL.y - 30} Z" fill="#9a4f2c" stroke="#5b2e18" stroke-width="2"/>`,
  );

  // Dirt pads under every building plot
  for (const plot of villagePlots) {
    layers.push(shadow(plot.x + 4, plot.y + 10, 60, 30, 0.2));
    layers.push(
      `<path d="${blob({ x: plot.x, y: plot.y + 6 }, 58, 33, 0.06, 24)}" fill="url(#pad)" stroke="#8f6e40" stroke-width="2" filter="url(#rough)"/>`,
    );
  }

  layers.push(
    `<rect width="${W}" height="${H}" filter="url(#soil)" opacity="0.18" style="mix-blend-mode:multiply"/>`,
  );

  // Grass tufts and flowers on open ground
  const isOpenGround = (point: Point) =>
    !isNearPlot(point, 70) &&
    distanceToRoad(point) > 26 &&
    distance(point, WELL) > 85 &&
    distance(point, POND) > 140;

  for (const point of scatter(2200, isOpenGround, 9)) {
    layers.push(grassTuft(point, random() < 0.45));
  }

  for (const point of scatter(
    70,
    (point) => isOpenGround(point) && !isInsideEllipse(point, WALL.rx, WALL.ry),
    40,
  )) {
    layers.push(flowerCluster(point));
  }

  for (const point of scatter(
    22,
    (point) =>
      isOpenGround(point) && isInsideEllipse(point, WALL.rx - 40, WALL.ry - 40),
    60,
  )) {
    layers.push(flowerCluster(point));
  }

  // Scenery, drawn back to front
  const scenery: { point: Point; draw: () => string }[] = [];

  const isForest = (point: Point) =>
    !isInsideEllipse(point, WALL.rx + 45, WALL.ry + 45) &&
    distanceToRoad(point) > 34 &&
    distance(point, wallField) > 110 &&
    distance(point, POND) > 160 &&
    distance(point, FARM) > 170;

  for (const point of scatter(170, isForest, 44)) {
    const size = between(26, 40);
    scenery.push({
      point,
      draw: () =>
        random() < 0.3
          ? pineTree(point, size * 1.1)
          : deciduousTree(point, size),
    });
  }

  const isVillageGap = (point: Point) =>
    isInsideEllipse(point, WALL.rx - 50, WALL.ry - 45) &&
    !isNearPlot(point, 95) &&
    distanceToRoad(point) > 32 &&
    distance(point, WELL) > 100;

  for (const point of scatter(16, isVillageGap, 55)) {
    scenery.push({ point, draw: () => bush(point, between(9, 13)) });
  }

  for (const point of scatter(
    30,
    (point) => isForest(point) || isVillageGap(point),
    70,
  )) {
    scenery.push({ point, draw: () => rock(point, between(5, 10)) });
  }

  for (const point of scatter(26, isForest, 60)) {
    scenery.push({ point, draw: () => bush(point, between(10, 15)) });
  }

  scenery.sort((a, b) => a.point.y - b.point.y);
  layers.push(...scenery.map(({ draw }) => draw()));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${layers.join('')}</svg>`;
};

// Wall ring, with gates where the roads leave the village
type WallStyle = 'stone' | 'palisade' | 'earth';

const gateAngles = Object.values(exitAngles);
const GATE_HALF_WIDTH = 0.075;

const isGate = (angle: number) =>
  gateAngles.some((gate) => {
    const difference = Math.atan2(
      Math.sin(angle - gate),
      Math.cos(angle - gate),
    );
    return Math.abs(difference) < GATE_HALF_WIDTH;
  });

const wallSegments = (step: number) => {
  const segments: Point[][] = [];
  let current: Point[] = [];

  for (let angle = -Math.PI; angle < Math.PI; angle += step) {
    if (isGate(angle)) {
      if (current.length > 1) {
        segments.push(current);
      }
      current = [];
      continue;
    }

    current.push(ellipsePoint(WALL.rx, WALL.ry, angle));
  }

  if (current.length > 1) {
    segments.push(current);
  }

  // Join the segment that wraps around -π/π
  if (segments.length > 1 && !isGate(-Math.PI)) {
    const first = segments.shift()!;
    segments[segments.length - 1]!.push(...first);
  }

  return segments;
};

const tower = ({ x, y }: Point, style: WallStyle) => {
  if (style === 'palisade') {
    return `${shadow(x + 10, y + 10, 18, 9, 0.3)}<rect x="${x - 13}" y="${y - 40}" width="26" height="42" fill="#7a5130" stroke="#3d2614" stroke-width="2"/><path d="M${x - 18},${y - 38} L${x},${y - 56} L${x + 18},${y - 38} Z" fill="#9b6b3d" stroke="#3d2614" stroke-width="2"/>`;
  }

  if (style === 'earth') {
    return `${shadow(x + 10, y + 8, 22, 10, 0.3)}<ellipse cx="${x}" cy="${y - 6}" rx="22" ry="14" fill="#7d6a3e" stroke="#4a3d22" stroke-width="2"/><rect x="${x - 10}" y="${y - 34}" width="20" height="26" fill="#6e4a2a" stroke="#3d2614" stroke-width="2"/>`;
  }

  return `${shadow(x + 10, y + 10, 24, 11, 0.32)}<rect x="${x - 17}" y="${y - 44}" width="34" height="46" fill="url(#stone-cap)" stroke="#4f4940" stroke-width="2"/><path d="M${x - 17},${y - 44} h7 v-7 h6 v7 h8 v-7 h6 v7 h7" fill="#c8c1b5" stroke="#4f4940" stroke-width="2"/>`;
};

const drawWall = (style: WallStyle) => {
  const layers: string[] = [defs];
  const segments = wallSegments(0.004);

  if (style === 'stone') {
    for (const segment of segments) {
      const d = smoothPath(segment);
      layers.push(
        `<path d="${d}" fill="none" stroke="#0c2408" stroke-opacity="0.3" stroke-width="30" transform="translate(6 9)" filter="url(#shadow-blur)"/>`,
      );
      layers.push(
        `<path d="${d}" fill="none" stroke="#4f4940" stroke-width="24" stroke-linecap="round"/>`,
      );
      layers.push(
        `<path d="${d}" fill="none" stroke="#a69e91" stroke-width="18" stroke-linecap="round"/>`,
      );
      layers.push(
        `<path d="${d}" fill="none" stroke="#7f776b" stroke-width="18" stroke-dasharray="2 14"/>`,
      );
      layers.push(
        `<path d="${d}" fill="none" stroke="#d3ccc0" stroke-width="7" stroke-dasharray="9 7" transform="translate(0 -8)"/>`,
      );
    }
  }

  if (style === 'earth') {
    for (const segment of segments) {
      const d = smoothPath(segment);
      layers.push(
        `<path d="${d}" fill="none" stroke="#0c2408" stroke-opacity="0.28" stroke-width="40" transform="translate(5 8)" filter="url(#shadow-blur)"/>`,
      );
      layers.push(
        `<path d="${d}" fill="none" stroke="#6b5732" stroke-width="34" stroke-linecap="round" filter="url(#rough)"/>`,
      );
      layers.push(
        `<path d="${d}" fill="none" stroke="#8a9a45" stroke-width="18" stroke-linecap="round" transform="translate(0 -5)" filter="url(#rough)"/>`,
      );
      layers.push(
        `<path d="${d}" fill="none" stroke="#5a3d22" stroke-width="5" stroke-dasharray="4 18" transform="translate(0 -12)"/>`,
      );
    }
  }

  if (style === 'palisade') {
    const stakes: Point[] = [];

    for (const segment of segments) {
      layers.push(
        `<path d="${smoothPath(segment)}" fill="none" stroke="#0c2408" stroke-opacity="0.3" stroke-width="16" transform="translate(6 8)" filter="url(#shadow-blur)"/>`,
      );

      for (let i = 0; i < segment.length; i += 2) {
        stakes.push(segment[i]!);
      }
    }

    stakes.sort((a, b) => a.y - b.y);

    for (const { x, y } of stakes) {
      const height = between(22, 28);
      const tone = pick(['#8a5a32', '#9b6a3c', '#7a4e2b']);
      layers.push(
        `<path d="M${round(x - 4)},${round(y)} L${round(x - 4)},${round(y - height)} L${round(x)},${round(y - height - 7)} L${round(x + 4)},${round(y - height)} L${round(x + 4)},${round(y)} Z" fill="${tone}" stroke="#3d2614" stroke-width="1.3"/>`,
      );
    }
  }

  // Towers either side of each gate, and a few along the wall
  const towerAngles = [
    ...gateAngles.flatMap((angle) => [
      angle - GATE_HALF_WIDTH - 0.01,
      angle + GATE_HALF_WIDTH + 0.01,
    ]),
    ...[-2.35, -0.8, 0.8, 2.35],
  ];

  const towers = towerAngles
    .map((angle) => ellipsePoint(WALL.rx, WALL.ry, angle))
    .sort((a, b) => a.y - b.y);
  layers.push(...towers.map((point) => tower(point, style)));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${layers.join('')}</svg>`;
};

// Marker for an empty building plot: a staked out construction site
const drawBuildingSite = () => {
  const width = 160;
  const height = 96;
  const stakes: Point[] = [
    { x: 30, y: 38 },
    { x: 130, y: 38 },
    { x: 22, y: 70 },
    { x: 138, y: 70 },
  ];

  const rope = `M${stakes[0]!.x},${stakes[0]!.y - 14} L${stakes[1]!.x},${stakes[1]!.y - 14} L${stakes[3]!.x},${stakes[3]!.y - 14} L${stakes[2]!.x},${stakes[2]!.y - 14} Z`;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${defs}`;
  svg += `<ellipse cx="80" cy="58" rx="74" ry="32" fill="url(#pad)" stroke="#8f6e40" stroke-width="2"/>`;
  svg += `<ellipse cx="80" cy="58" rx="60" ry="23" fill="none" stroke="#a58350" stroke-width="2" stroke-dasharray="5 6" opacity="0.8"/>`;

  for (const stone of [
    { x: 52, y: 64 },
    { x: 98, y: 52 },
    { x: 110, y: 72 },
  ]) {
    svg += `<ellipse cx="${stone.x}" cy="${stone.y}" rx="5" ry="3.5" fill="url(#rock)" stroke="#5f584e" stroke-width="1"/>`;
  }

  svg += `<path d="${rope}" fill="none" stroke="#e8dcc0" stroke-width="2"/>`;

  for (const { x, y } of stakes) {
    svg += `<rect x="${x - 3}" y="${y - 20}" width="6" height="22" rx="1" fill="#8a5a32" stroke="#3d2614" stroke-width="1.2"/>`;
  }

  return `${svg}</svg>`;
};

const render = async (
  svg: string,
  path: string,
  outputWidth: number,
  quality: number,
) => {
  await sharp(Buffer.from(svg), { density: 96 * (outputWidth / W) })
    .resize({ width: outputWidth })
    .webp({ quality, alphaQuality: 90, effort: 6 })
    .toFile(path);
  console.log(`Wrote ${path}`);
};

mkdirSync(OUTPUT_DIR, { recursive: true });

await render(drawScene(), join(OUTPUT_DIR, 'village.webp'), OUTPUT_WIDTH, 82);

for (const style of ['stone', 'palisade', 'earth'] as const) {
  await render(
    drawWall(style),
    join(OUTPUT_DIR, `wall-${style}.webp`),
    OUTPUT_WIDTH,
    85,
  );
}

await sharp(Buffer.from(drawBuildingSite()), { density: 192 })
  .resize({ width: 240 })
  .webp({ quality: 88, alphaQuality: 90 })
  .toFile(join(OUTPUT_DIR, 'building-site.webp'));
console.log('Wrote building site');
