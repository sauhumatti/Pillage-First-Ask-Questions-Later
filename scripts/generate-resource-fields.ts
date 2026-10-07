// biome-ignore-all lint/suspicious/noConsole: This script intentionally logs progress.
// Procedurally draws the resource fields view: the farmland around the village,
// and the art for each kind of resource field, which grows with the field's level.
// The output is deterministic, so re-running it produces the same images.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createSceneKit,
  defs,
  distance,
  type Point,
  renderWebp,
  round,
  shadow,
  smoothPath,
} from './scene-kit.ts';

const OUTPUT_DIR = join(
  process.cwd(),
  'apps',
  'web',
  'public',
  'resource-fields',
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

// Same 16:10 box as the village view, field positions are percentages of it
const W = 1600;
const H = 1000;
const OUTPUT_WIDTH = 1920;

const readFieldPositions = (): Point[] => {
  const scss = readFileSync(BUILDING_FIELD_STYLES, 'utf8');
  const positions: Point[] = [];

  for (const match of scss.matchAll(/(\d+): \((\d+)% (\d+)%\)/g)) {
    const [, id, top, left] = match;

    if (Number(id) <= 18) {
      positions.push({
        x: (Number(left) / 100) * W,
        y: (Number(top) / 100) * H,
      });
    }
  }

  return positions;
};

const fields = readFieldPositions();
const CENTER: Point = { x: W / 2, y: H / 2 };
const VILLAGE = { rx: 132, ry: 100 };
const POND: Point = { x: 1400, y: 870 };

const angleFromCenter = ({ x, y }: Point) =>
  Math.atan2(y - CENTER.y, x - CENTER.x);

// The background
const drawBackground = () => {
  const {
    random,
    between,
    pick,
    blob,
    wobbleLine,
    deciduousTree,
    pineTree,
    bush,
    rock,
    grassTuft,
    flowerCluster,
    scatter,
  } = createSceneKit({ seed: 20_261_007, width: W, height: H });

  // Footpaths branch out from the village: each field links to its nearest
  // neighbour closer to the village, or to the village itself
  const villageEdge = (point: Point): Point => {
    const angle = angleFromCenter(point);
    return {
      x: CENTER.x + Math.cos(angle) * VILLAGE.rx * 0.9,
      y: CENTER.y + Math.sin(angle) * VILLAGE.ry * 0.9,
    };
  };

  const footpaths = fields.map((field) => {
    const ownDistance = distance(field, CENTER);
    let target = villageEdge(field);

    for (const other of fields) {
      if (
        distance(other, CENTER) < ownDistance - 60 &&
        distance(field, other) < distance(field, target)
      ) {
        target = other;
      }
    }

    return wobbleLine(field, target, 3, 10);
  });

  const fieldsByAngle = [...fields].sort(
    (a, b) => angleFromCenter(a) - angleFromCenter(b),
  );

  const gaps = fieldsByAngle
    .map((field, index) => {
      const next = fieldsByAngle[(index + 1) % fieldsByAngle.length]!;
      const start = angleFromCenter(field);
      let end = angleFromCenter(next);

      if (end <= start) {
        end += Math.PI * 2;
      }

      return { angle: (start + end) / 2, size: end - start };
    })
    .sort((a, b) => b.size - a.size)
    .slice(0, 4);

  const roads = gaps.map(({ angle }) =>
    wobbleLine(
      {
        x: CENTER.x + Math.cos(angle) * VILLAGE.rx,
        y: CENTER.y + Math.sin(angle) * VILLAGE.ry,
      },
      {
        x: CENTER.x + Math.cos(angle) * W * 0.75,
        y: CENTER.y + Math.sin(angle) * H * 0.75,
      },
      7,
      16,
    ),
  );

  const paths = [...roads, ...footpaths];

  const distanceToPath = (point: Point) => {
    let closest = Number.POSITIVE_INFINITY;

    for (const polyline of paths) {
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

  const distanceToField = (point: Point) =>
    Math.min(...fields.map((field) => distance(field, point)));

  const layers: string[] = [defs];

  // Meadow
  layers.push(`<rect width="${W}" height="${H}" fill="#5b8f3d"/>`);
  layers.push(
    `<rect width="${W}" height="${H}" filter="url(#patches)" opacity="0.55"/>`,
  );
  layers.push(
    `<rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.13" style="mix-blend-mode:multiply"/>`,
  );

  // Pond with reeds
  layers.push(
    `<path d="${blob(POND, 128, 80, 0.12)}" fill="#7a6a3e" opacity="0.6" filter="url(#shadow-blur)"/>`,
  );
  layers.push(
    `<path d="${blob(POND, 116, 70, 0.12)}" fill="url(#water)" stroke="#c9d6a0" stroke-width="3"/>`,
  );
  layers.push(
    `<ellipse cx="${POND.x - 30}" cy="${POND.y - 20}" rx="38" ry="9" fill="#ffffff" opacity="0.25"/>`,
  );

  for (let i = 0; i < 24; i++) {
    const angle = between(0, Math.PI * 2);
    const x = POND.x + Math.cos(angle) * 120;
    const y = POND.y + Math.sin(angle) * 76;
    layers.push(
      `<path d="M${round(x)},${round(y)} l${round(between(-3, 3))},-${round(between(12, 20))}" stroke="#4d7a2c" stroke-width="2.4" stroke-linecap="round"/>`,
    );
  }

  // Paths: a dark edge, then the sandy surface
  const pathData = paths.map((polyline) => smoothPath(polyline));
  const pathWidth = (index: number) => (index < roads.length ? 28 : 14);

  layers.push(
    `<g filter="url(#rough)" fill="none" stroke-linecap="round" stroke-linejoin="round">${pathData
      .map(
        (d, index) =>
          `<path d="${d}" stroke="#8a6c3d" stroke-width="${pathWidth(index) + 7}" opacity="0.75"/>`,
      )
      .join('')}${pathData
      .map(
        (d, index) =>
          `<path d="${d}" stroke="#d6b77a" stroke-width="${pathWidth(index)}"/>`,
      )
      .join('')}</g>`,
  );

  for (const polyline of roads) {
    for (let i = 0; i < polyline.length - 1; i++) {
      const a = polyline[i]!;
      const b = polyline[i + 1]!;
      const pebbles = Math.round(distance(a, b) / 7);

      for (let j = 0; j < pebbles; j++) {
        const t = random();
        layers.push(
          `<ellipse cx="${round(a.x + (b.x - a.x) * t + between(-10, 10))}" cy="${round(a.y + (b.y - a.y) * t + between(-10, 10))}" rx="${round(between(1.5, 3))}" ry="${round(between(1.2, 2.2))}" fill="${pick(['#b89a63', '#e5cd98', '#a8875a'])}" opacity="0.8"/>`,
        );
      }
    }
  }

  // Trodden ground where each field sits
  for (const field of fields) {
    layers.push(
      `<path d="${blob({ x: field.x, y: field.y + 8 }, 104, 56, 0.06, 24)}" fill="#4f7f33" opacity="0.55" filter="url(#soft)"/>`,
    );
  }

  layers.push(
    `<rect width="${W}" height="${H}" filter="url(#soil)" opacity="0.15" style="mix-blend-mode:multiply"/>`,
  );

  // Grass and flowers on open ground
  const isOpenGround = (point: Point) =>
    distanceToField(point) > 95 &&
    distanceToPath(point) > 20 &&
    distance(point, CENTER) > 170 &&
    distance(point, POND) > 135;

  for (const point of scatter(1800, isOpenGround, 9)) {
    layers.push(grassTuft(point, random() < 0.45));
  }

  for (const point of scatter(60, isOpenGround, 45)) {
    layers.push(flowerCluster(point));
  }

  // The village in the middle
  layers.push(drawVillage(between, pick));

  // Woods around the edge, drawn back to front
  const scenery: { point: Point; draw: () => string }[] = [];
  const isWoods = (point: Point) =>
    distanceToField(point) > 130 &&
    distanceToPath(point) > 34 &&
    distance(point, CENTER) > 220 &&
    distance(point, POND) > 160;

  for (const point of scatter(110, isWoods, 46)) {
    const size = between(26, 40);
    scenery.push({
      point,
      draw: () =>
        random() < 0.3
          ? pineTree(point, size * 1.1)
          : deciduousTree(point, size),
    });
  }

  for (const point of scatter(30, isOpenGround, 70)) {
    scenery.push({ point, draw: () => bush(point, between(9, 14)) });
  }

  for (const point of scatter(22, isOpenGround, 80)) {
    scenery.push({ point, draw: () => rock(point, between(5, 9)) });
  }

  scenery.sort((a, b) => a.point.y - b.point.y);
  layers.push(...scenery.map(({ draw }) => draw()));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${layers.join('')}</svg>`;
};

const house = (
  { x, y }: Point,
  width: number,
  roof: string,
  wall = '#e2cfa8',
) => {
  const height = width * 0.55;
  const roofHeight = width * 0.5;
  return `${shadow(x + width * 0.25, y + 4, width * 0.7, width * 0.25, 0.3)}<rect x="${round(x - width / 2)}" y="${round(y - height)}" width="${round(width)}" height="${round(height)}" fill="${wall}" stroke="#5a4630" stroke-width="1.5"/><rect x="${round(x - width * 0.1)}" y="${round(y - height * 0.6)}" width="${round(width * 0.2)}" height="${round(height * 0.6)}" fill="#5b3d22"/><path d="M${round(x - width / 2 - 4)},${round(y - height)} L${round(x)},${round(y - height - roofHeight)} L${round(x + width / 2 + 4)},${round(y - height)} Z" fill="${roof}" stroke="#4a2414" stroke-width="1.5" stroke-linejoin="round"/>`;
};

const drawVillage = (
  between: (min: number, max: number) => number,
  pick: <T>(items: T[]) => T,
) => {
  let svg = shadow(
    CENTER.x + 10,
    CENTER.y + 16,
    VILLAGE.rx + 10,
    VILLAGE.ry,
    0.3,
  );
  svg += `<ellipse cx="${CENTER.x}" cy="${CENTER.y}" rx="${VILLAGE.rx}" ry="${VILLAGE.ry}" fill="url(#pad)" stroke="#8f6e40" stroke-width="2" filter="url(#rough)"/>`;
  svg += `<ellipse cx="${CENTER.x}" cy="${CENTER.y + 4}" rx="${VILLAGE.rx * 0.82}" ry="${VILLAGE.ry * 0.78}" fill="#8fae58" opacity="0.6"/>`;

  // Back half of the palisade, then houses, then the front half
  const stakes = (from: number, to: number) => {
    let result = '';

    for (let angle = from; angle <= to; angle += 0.07) {
      const x = CENTER.x + Math.cos(angle) * (VILLAGE.rx - 8);
      const y = CENTER.y + Math.sin(angle) * (VILLAGE.ry - 8);
      const height = between(14, 18);
      result += `<path d="M${round(x - 3.5)},${round(y)} L${round(x - 3.5)},${round(y - height)} L${round(x)},${round(y - height - 5)} L${round(x + 3.5)},${round(y - height)} L${round(x + 3.5)},${round(y)} Z" fill="${pick(['#8a5a32', '#9b6a3c', '#7a4e2b'])}" stroke="#3d2614" stroke-width="1"/>`;
    }

    return result;
  };

  svg += stakes(-Math.PI, 0);

  const houses: { point: Point; width: number; roof: string }[] = [
    { point: { x: 740, y: 470 }, width: 34, roof: '#a3542e' },
    { point: { x: 860, y: 465 }, width: 30, roof: '#8f4a2a' },
    { point: { x: 705, y: 530 }, width: 30, roof: '#b0623a' },
    { point: { x: 905, y: 530 }, width: 34, roof: '#a3542e' },
    { point: { x: 770, y: 570 }, width: 28, roof: '#8f4a2a' },
    { point: { x: 845, y: 575 }, width: 30, roof: '#b0623a' },
  ];

  const buildings = [
    ...houses.map(({ point, width, roof }) => ({
      y: point.y,
      svg: house(point, width, roof),
    })),
    {
      // Main hall with a tower
      y: 520,
      svg: `${house({ x: 800, y: 520 }, 52, '#7d3b22', '#efe0bf')}<rect x="822" y="440" width="18" height="48" fill="#d9cdb0" stroke="#5a4630" stroke-width="1.5"/><path d="M818,440 L831,418 L844,440 Z" fill="#7d3b22" stroke="#4a2414" stroke-width="1.5"/><path d="M831,418 v-14 l12,4 l-12,4" fill="#c23b2b" stroke="#4a2414" stroke-width="1"/>`,
    },
  ].sort((a, b) => a.y - b.y);

  svg += buildings.map(({ svg: building }) => building).join('');
  svg += stakes(0, Math.PI);

  return svg;
};

// Field art: one image per kind of field and stage of development
type FieldType = 'wood' | 'clay' | 'iron' | 'wheat';
const STAGES = [0, 1, 2, 3] as const;
type Stage = (typeof STAGES)[number];

const FIELD_W = 240;
const FIELD_H = 160;
const FIELD_OUTPUT_WIDTH = 360;
const PLOT: Point = { x: 120, y: 96 };
const PLOT_RX = 104;
const PLOT_RY = 52;

const isInPlot = ({ x, y }: Point, margin = 1) =>
  ((x - PLOT.x) / (PLOT_RX * margin)) ** 2 +
    ((y - PLOT.y) / (PLOT_RY * margin)) ** 2 <=
  1;

const fieldTypeSeeds: Record<FieldType, number> = {
  wood: 11,
  clay: 23,
  iron: 37,
  wheat: 41,
};

const drawField = (type: FieldType, stage: Stage) => {
  const kit = createSceneKit({
    seed: fieldTypeSeeds[type] * 100 + stage,
    width: FIELD_W,
    height: FIELD_H,
  });
  const { between, pick, blob, deciduousTree, pineTree, rock, scatter } = kit;
  const plotPath = blob(PLOT, PLOT_RX, PLOT_RY, 0.05, 32);
  const layers: string[] = [
    defs,
    `<defs><clipPath id="plot"><path d="${plotPath}"/></clipPath></defs>`,
  ];

  const ground = (fill: string, edge: string) => {
    layers.push(shadow(PLOT.x + 6, PLOT.y + 10, PLOT_RX, PLOT_RY * 0.9, 0.3));
    layers.push(
      `<path d="${plotPath}" fill="${fill}" stroke="${edge}" stroke-width="3"/>`,
    );
    layers.push(
      `<rect width="${FIELD_W}" height="${FIELD_H}" filter="url(#grain)" opacity="0.14" clip-path="url(#plot)" style="mix-blend-mode:multiply"/>`,
    );
  };

  const sorted = (items: { y: number; svg: string }[]) =>
    items
      .sort((a, b) => a.y - b.y)
      .map(({ svg }) => svg)
      .join('');

  if (type === 'wheat') {
    const fills = ['#88ad4f', '#7a5a35', '#b6b44c', '#d9b54a'];
    const rows = ['', '#7fb047', '#c7c25a', '#f0cf5c'];
    ground(fills[stage]!, stage === 0 ? '#5d7f35' : '#5e4527');

    if (stage === 0) {
      for (const point of scatter(10, (p) => isInPlot(p, 0.8), 18)) {
        layers.push(
          `<ellipse cx="${round(point.x)}" cy="${round(point.y)}" rx="${round(between(6, 12))}" ry="${round(between(3, 6))}" fill="#9c7a48" opacity="0.6"/>`,
        );
      }
      for (const point of scatter(40, (p) => isInPlot(p, 0.9), 8)) {
        layers.push(kit.grassTuft(point, kit.random() < 0.5));
      }
    } else {
      // Furrows, then the crop in rows
      let furrows = '';

      for (let x = -80; x < FIELD_W + 80; x += 11) {
        furrows += `<line x1="${x}" y1="${FIELD_H}" x2="${x + 70}" y2="0" stroke="#5e4527" stroke-opacity="0.45" stroke-width="3"/>`;
      }

      layers.push(`<g clip-path="url(#plot)">${furrows}</g>`);

      let crop = '';
      const density = stage === 1 ? 26 : 16;

      for (let x = -80; x < FIELD_W + 80; x += 11) {
        for (let t = 0; t < 1; t += 1 / density) {
          const px = x + 5 + 70 * t;
          const py = FIELD_H * (1 - t);
          const height = stage === 1 ? 3 : stage === 2 ? 7 : 10;
          crop +=
            stage === 1
              ? `<circle cx="${round(px)}" cy="${round(py)}" r="1.8" fill="${rows[stage]}"/>`
              : `<path d="M${round(px)},${round(py)} l-1.5,-${height} M${round(px + 2)},${round(py)} l1.5,-${height}" stroke="${rows[stage]}" stroke-width="2.2" stroke-linecap="round"/>`;
        }
      }

      layers.push(`<g clip-path="url(#plot)">${crop}</g>`);

      if (stage === 3) {
        layers.push(
          `<rect width="${FIELD_W}" height="${FIELD_H}" fill="#fff3b0" opacity="0.12" clip-path="url(#plot)"/>`,
        );
      }
    }

    // A fence along the front edge once the field is worked
    if (stage >= 2) {
      let fence = '';
      const posts: Point[] = [];

      for (let angle = 0.25; angle <= Math.PI - 0.25; angle += 0.16) {
        posts.push({
          x: PLOT.x + Math.cos(angle) * (PLOT_RX + 2),
          y: PLOT.y + Math.sin(angle) * (PLOT_RY + 2),
        });
      }

      fence += `<path d="${smoothPath(posts)}" fill="none" stroke="#6b4423" stroke-width="2.5" transform="translate(0 -6)"/>`;
      fence += `<path d="${smoothPath(posts)}" fill="none" stroke="#6b4423" stroke-width="2.5" transform="translate(0 -12)"/>`;

      for (const { x, y } of posts) {
        fence += `<rect x="${round(x - 2)}" y="${round(y - 16)}" width="4" height="17" fill="#7a4e2b" stroke="#3d2614" stroke-width="1"/>`;
      }

      layers.push(fence);
    }

    // Haystacks and a scarecrow on a ripe field
    if (stage === 3) {
      const items = [
        { x: 72, y: 84 },
        { x: 162, y: 104 },
      ].map(({ x, y }) => ({
        y,
        svg: `${shadow(x + 8, y + 3, 20, 7, 0.35)}<path d="M${x - 17},${y} Q${x - 18},${y - 26} ${x},${y - 30} Q${x + 18},${y - 26} ${x + 17},${y} Z" fill="#e3b54a" stroke="#9a7128" stroke-width="1.5"/><path d="M${x - 10},${y - 12} q10,-4 20,0 M${x - 13},${y - 5} q13,-4 26,0" stroke="#b88a30" stroke-width="1.5" fill="none"/>`,
      }));

      items.push({
        y: 92,
        svg: `<line x1="122" y1="92" x2="122" y2="56" stroke="#5b3d22" stroke-width="3"/><line x1="108" y1="68" x2="136" y2="68" stroke="#5b3d22" stroke-width="3"/><circle cx="122" cy="56" r="6" fill="#e8d3a0" stroke="#5b3d22" stroke-width="1.5"/><path d="M114,52 L130,52 L122,44 Z" fill="#7a4e2b"/><path d="M114,66 L130,66 L127,82 L117,82 Z" fill="#a6463a" stroke="#5a2418" stroke-width="1"/>`,
      });
      layers.push(sorted(items));
    }
  }

  if (type === 'wood') {
    ground(stage === 0 ? '#6d9e45' : '#5f8a3c', '#3f6a2a');

    for (const point of scatter(30, (p) => isInPlot(p, 0.9), 9)) {
      layers.push(kit.grassTuft(point, kit.random() < 0.4));
    }

    const treeCount = [4, 7, 10, 13][stage]!;
    const items: { y: number; svg: string }[] = [];

    // Keep a clearing at the front for the woodcutters once there are any
    const isTreeSpot = (p: Point) =>
      isInPlot(p, 0.78) && (stage === 0 || p.y < PLOT.y + 8 || p.x < 70);

    for (const point of scatter(treeCount, isTreeSpot, stage === 0 ? 40 : 24)) {
      const size = between(18, 24) * (stage === 3 ? 1.05 : 1);
      items.push({
        y: point.y,
        svg:
          kit.random() < (stage >= 2 ? 0.45 : 0.2)
            ? pineTree(point, size * 1.15)
            : deciduousTree(point, size),
      });
    }

    const stump = ({ x, y }: Point) =>
      `<ellipse cx="${x}" cy="${y}" rx="7" ry="4" fill="#6e4a2a" stroke="#3d2614" stroke-width="1"/><ellipse cx="${x}" cy="${y - 3}" rx="7" ry="4" fill="#d9b483" stroke="#7a5432" stroke-width="1"/><path d="M${x - 7},${y - 3} v3 M${x + 7},${y - 3} v3" stroke="#3d2614"/>`;

    const logPile = ({ x, y }: Point, rows: number) => {
      let svg = shadow(x + 6, y + 2, 26, 7, 0.35);

      for (let row = 0; row < rows; row++) {
        for (let i = 0; i < rows - row + 1; i++) {
          const lx = x - (rows - row) * 6 + i * 12;
          const ly = y - row * 9;
          svg += `<rect x="${lx - 18}" y="${ly - 9}" width="30" height="9" rx="4" fill="#8a5a32" stroke="#3d2614" stroke-width="1"/><circle cx="${lx + 12}" cy="${ly - 4.5}" r="4.5" fill="#e0bd8c" stroke="#7a5432" stroke-width="1"/>`;
        }
      }

      return svg;
    };

    if (stage >= 1) {
      for (const point of [
        { x: 112, y: 128 },
        { x: 150, y: 120 },
        { x: 92, y: 114 },
      ].slice(0, stage + 1)) {
        items.push({ y: point.y, svg: stump(point) });
      }

      items.push({
        y: 132,
        svg: `${stump({ x: 132, y: 136 })}<path d="M130,128 l10,-14" stroke="#5b3d22" stroke-width="2.5"/><path d="M137,113 l8,2 l-3,6 z" fill="#9aa3a8" stroke="#4a4f52" stroke-width="1"/>`,
      });
    }

    if (stage >= 2) {
      items.push({ y: 126, svg: logPile({ x: 178, y: 126 }, stage) });
    }

    if (stage === 3) {
      items.push({
        y: 112,
        svg: `${shadow(76, 114, 26, 8, 0.35)}<rect x="56" y="88" width="38" height="24" fill="#9b6a3c" stroke="#3d2614" stroke-width="1.5"/><path d="M52,88 L75,70 L98,88 Z" fill="#7a4e2b" stroke="#3d2614" stroke-width="1.5"/><rect x="70" y="98" width="9" height="14" fill="#4a2f18"/>`,
      });
    }

    layers.push(sorted(items));
  }

  if (type === 'clay') {
    ground(stage === 0 ? '#9a7a4a' : '#8f6a40', '#6a4a28');

    layers.push(
      `<path d="${plotPath}" fill="none" stroke="#7aa04a" stroke-width="7" opacity="0.65"/>`,
    );

    if (stage === 0) {
      for (const point of scatter(14, (p) => isInPlot(p, 0.85), 18)) {
        layers.push(
          `<ellipse cx="${round(point.x)}" cy="${round(point.y)}" rx="${round(between(5, 11))}" ry="${round(between(3, 5))}" fill="#b5623a" opacity="0.55"/>`,
        );
      }
    } else {
      // Terraced pit: each stage digs one step deeper
      const colors = ['#c27448', '#a95b35', '#8e4628', '#6e3520'];

      for (let step = 0; step < stage + 1; step++) {
        const scale = 0.82 - step * 0.17;
        const center = { x: PLOT.x - 10, y: PLOT.y + 2 + step * 3 };
        layers.push(
          `<ellipse cx="${center.x}" cy="${center.y + 4}" rx="${round(PLOT_RX * scale * 0.72)}" ry="${round(PLOT_RY * scale * 0.72)}" fill="#4a2414" opacity="0.35"/>`,
        );
        layers.push(
          `<ellipse cx="${center.x}" cy="${center.y}" rx="${round(PLOT_RX * scale * 0.7)}" ry="${round(PLOT_RY * scale * 0.7)}" fill="${colors[step]}" stroke="#5a2a14" stroke-width="1.5"/>`,
        );
      }

      if (stage >= 2) {
        layers.push(
          `<ellipse cx="${PLOT.x - 10}" cy="${PLOT.y + 2 + stage * 3}" rx="${round(PLOT_RX * 0.1)}" ry="${round(PLOT_RY * 0.08)}" fill="#6a8a9a" opacity="0.8"/>`,
        );
      }
    }

    const items: { y: number; svg: string }[] = [];

    const bricks = ({ x, y }: Point, rows: number) => {
      let svg = shadow(x + 6, y + 2, 22, 6, 0.3);

      for (let row = 0; row < rows; row++) {
        for (let i = 0; i < 3; i++) {
          svg += `<rect x="${x - 16 + i * 11 + (row % 2) * 5}" y="${y - 6 - row * 6}" width="10" height="6" fill="${pick(['#b85a34', '#c46a3e', '#a84e2c'])}" stroke="#5a2414" stroke-width="0.8"/>`;
        }
      }

      return svg;
    };

    if (stage >= 1) {
      items.push({
        y: 120,
        svg: `<path d="M186,120 l-10,-26" stroke="#5b3d22" stroke-width="2.5"/><path d="M184,118 l7,-3 l3,9 l-6,3 z" fill="#9aa3a8" stroke="#4a4f52" stroke-width="1"/>`,
      });
    }

    if (stage >= 2) {
      items.push({ y: 132, svg: bricks({ x: 160, y: 136 }, stage) });
      items.push({ y: 66, svg: bricks({ x: 182, y: 72 }, stage - 1) });
    }

    if (stage === 3) {
      items.push({
        y: 76,
        svg: `${shadow(56, 80, 22, 7, 0.35)}<path d="M38,80 Q38,52 56,50 Q74,52 74,80 Z" fill="#b5795a" stroke="#5a2a14" stroke-width="1.5"/><path d="M50,80 Q50,68 56,67 Q62,68 62,80 Z" fill="#3a1a0c"/><ellipse cx="57" cy="70" rx="3" ry="2" fill="#f2a03a" opacity="0.9"/><path d="M60,50 q-6,-10 2,-18 q6,-8 -2,-16" fill="none" stroke="#d8d4cc" stroke-width="5" stroke-linecap="round" opacity="0.55"/>`,
      });
    }

    layers.push(sorted(items));
  }

  if (type === 'iron') {
    ground('#7f8c6a', '#525a46');

    const items: { y: number; svg: string }[] = [];
    const hill = (center: Point, width: number, height: number, fill: string) =>
      `${shadow(center.x + 10, center.y + 4, width * 0.6, height * 0.22, 0.35)}<path d="M${center.x - width / 2},${center.y} C${center.x - width * 0.32},${center.y - height * 0.7} ${center.x - width * 0.12},${center.y - height} ${center.x + width * 0.05},${center.y - height} C${center.x + width * 0.22},${center.y - height * 0.95} ${center.x + width * 0.36},${center.y - height * 0.55} ${center.x + width / 2},${center.y} Z" fill="${fill}" stroke="#4a4a44" stroke-width="2"/><path d="M${center.x - width * 0.05},${center.y - height * 0.92} C${center.x + width * 0.15},${center.y - height * 0.7} ${center.x + width * 0.25},${center.y - height * 0.35} ${center.x + width * 0.42},${center.y - height * 0.05}" fill="none" stroke="#5c5a54" stroke-width="2" opacity="0.6"/>`;

    const entrance = ({ x, y }: Point, size: number) =>
      `<path d="M${x - size},${y} L${x - size},${y - size * 1.3} Q${x},${y - size * 1.8} ${x + size},${y - size * 1.3} L${x + size},${y} Z" fill="#1d1a16"/><path d="M${x - size - 2},${y} L${x - size - 2},${y - size * 1.4} M${x + size + 2},${y} L${x + size + 2},${y - size * 1.4} M${x - size - 5},${y - size * 1.4} L${x + size + 5},${y - size * 1.4}" stroke="#7a4e2b" stroke-width="4" stroke-linecap="round"/>`;

    const orePile = ({ x, y }: Point) => {
      let svg = shadow(x + 4, y + 2, 16, 5, 0.3);

      for (let i = 0; i < 9; i++) {
        svg += `<circle cx="${round(x + between(-12, 12))}" cy="${round(y - between(0, 8) - (i > 5 ? 4 : 0))}" r="${round(between(2.5, 4.2))}" fill="${pick(['#5b5e66', '#7a6f6a', '#8a4f3a', '#6c7078'])}" stroke="#2d2d30" stroke-width="0.8"/>`;
      }

      return svg;
    };

    const cart = ({ x, y }: Point) =>
      `${shadow(x + 4, y + 3, 14, 4, 0.35)}<path d="M${x - 12},${y - 14} L${x + 12},${y - 14} L${x + 9},${y - 4} L${x - 9},${y - 4} Z" fill="#6b4423" stroke="#3d2614" stroke-width="1.2"/><circle cx="${x - 5}" cy="${y - 16}" r="3.5" fill="#5b5e66"/><circle cx="${x + 3}" cy="${y - 17}" r="3.8" fill="#8a4f3a"/><circle cx="${x - 6}" cy="${y - 2}" r="3" fill="#2d2d30"/><circle cx="${x + 6}" cy="${y - 2}" r="3" fill="#2d2d30"/>`;

    if (stage === 0) {
      for (const point of scatter(7, (p) => isInPlot(p, 0.75), 28)) {
        items.push({ y: point.y, svg: rock(point, between(8, 14)) });
      }
    } else {
      const hillWidth = [0, 130, 160, 180][stage]!;
      const hillHeight = [0, 52, 72, 92][stage]!;
      items.push({
        y: 0,
        svg: hill({ x: 120, y: 112 }, hillWidth, hillHeight, '#a39e92'),
      });

      if (stage === 3) {
        items.push({
          y: 1,
          svg: hill({ x: 70, y: 106 }, 100, 62, '#958f84'),
        });
      }

      items.push({ y: 2, svg: entrance({ x: 118, y: 112 }, 9 + stage) });

      if (stage === 3) {
        items.push({ y: 3, svg: entrance({ x: 66, y: 106 }, 8) });
      }

      // Rails out of the mine
      if (stage >= 2) {
        items.push({
          y: 4,
          svg: `<path d="M114,112 Q122,128 150,138 M122,112 Q130,124 156,132" fill="none" stroke="#5a4630" stroke-width="2"/><path d="M118,116 l6,-2 M123,122 l7,-3 M131,127 l7,-3 M140,132 l7,-3" stroke="#7a4e2b" stroke-width="2"/>`,
        });
        items.push({ y: 136, svg: cart({ x: 150, y: 138 }) });
      }

      for (const point of [
        { x: 178, y: 126 },
        { x: 52, y: 128 },
        { x: 196, y: 108 },
      ].slice(0, stage)) {
        items.push({ y: point.y, svg: orePile(point) });
      }

      for (const point of scatter(
        3 + stage,
        (p) => isInPlot(p, 0.85) && p.y > 118,
        26,
      )) {
        items.push({ y: point.y, svg: rock(point, between(4, 7)) });
      }
    }

    layers.push(sorted(items));
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${FIELD_W}" height="${FIELD_H}" viewBox="0 0 ${FIELD_W} ${FIELD_H}">${layers.join('')}</svg>`;
};

mkdirSync(OUTPUT_DIR, { recursive: true });

const backgroundPath = join(OUTPUT_DIR, 'background.webp');
await renderWebp(drawBackground(), backgroundPath, W, OUTPUT_WIDTH, 82);
console.log(`Wrote ${backgroundPath}`);

for (const type of ['wood', 'clay', 'iron', 'wheat'] as const) {
  for (const stage of STAGES) {
    const path = join(OUTPUT_DIR, `${type}-${stage}.webp`);
    await renderWebp(
      drawField(type, stage),
      path,
      FIELD_W,
      FIELD_OUTPUT_WIDTH,
      86,
    );
    console.log(`Wrote ${path}`);
  }
}
