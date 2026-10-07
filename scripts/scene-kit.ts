// Shared drawing helpers for the generated village and resource field scenes.
// Everything random comes from a seeded generator, so the output is deterministic.
import sharp from 'sharp';

export type Point = { x: number; y: number };

export const round = (value: number) => Math.round(value * 10) / 10;
export const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y);

// Smooth path through points (Catmull-Rom to cubic Bézier)
export const smoothPath = (points: Point[], closed = false): string => {
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

// Shared definitions: gradients and texture filters
export const defs = `
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

export const shadow = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  opacity = 0.28,
) =>
  `<ellipse cx="${round(cx)}" cy="${round(cy)}" rx="${round(rx)}" ry="${round(ry)}" fill="#0c2408" opacity="${opacity}" filter="url(#shadow-blur)"/>`;

type SceneKitOptions = {
  seed: number;
  width: number;
  height: number;
};

export const createSceneKit = ({ seed, width, height }: SceneKitOptions) => {
  let state = seed >>> 0;

  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const between = (min: number, max: number) => min + random() * (max - min);
  const pick = <T>(items: T[]): T =>
    items[Math.floor(random() * items.length)]!;

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
    const normal = {
      x: -(to.y - from.y) / length,
      y: (to.x - from.x) / length,
    };

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

  const deciduousTree = ({ x, y }: Point, size: number) => {
    const leaf = pick(['leaf-a', 'leaf-b', 'leaf-c']);
    let svg = shadow(
      x + size * 0.45,
      y + size * 0.55,
      size * 0.95,
      size * 0.55,
    );
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
      const point = {
        x: between(-30, width + 30),
        y: between(-30, height + 30),
      };

      if (
        isAllowed(point) &&
        points.every((other) => distance(other, point) >= minDistance)
      ) {
        points.push(point);
      }
    }

    return points;
  };

  return {
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
  };
};

export const renderWebp = async (
  svg: string,
  path: string,
  sourceWidth: number,
  outputWidth: number,
  quality: number,
) => {
  await sharp(Buffer.from(svg), { density: 96 * (outputWidth / sourceWidth) })
    .resize({ width: outputWidth })
    .webp({ quality, alphaQuality: 90, effort: 6 })
    .toFile(path);
};
