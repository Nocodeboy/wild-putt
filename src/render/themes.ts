import type { ThemeId } from '../sim/types';

/** What lies around (and under) the hole: grass, a street far below, the sea, a fairground, ice, rock. */
export type Surround = 'lawn' | 'street' | 'sea' | 'fairground' | 'ice' | 'magma';

export interface Theme {
  sky: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  sun: number;
  sunI: number;
  sunDir: [number, number, number];
  hemiSky: number;
  hemiGround: number;
  hemiI: number;
  surround: Surround;
  outside: number; // ground colour around the hole
  outsideY: number; // how far below the green it is (rooftops: the street is far down)
  green: [string, string]; // mowing stripes
  rough: [string, string]; // the ground around the rails (inside the hole's plate, where the ball never goes)
  sand: string;
  ice: string;
  water: string;
  lava: string;
  wall: number; // the rail / parapet
  wallTop: number;
  base: [number, number]; // the side of the plate under the green (top layer, lower layer)
  flag: number;
  props: number[]; // palette for the decoration around the hole
  night: boolean;
}

const DAY: Theme = {
  sky: 0x9fd8f2,
  fog: 0xbfe6f4,
  fogNear: 45,
  fogFar: 120,
  sun: 0xfff1d6,
  sunI: 2.2,
  sunDir: [-0.45, 1, 0.55],
  hemiSky: 0xd6efff,
  hemiGround: 0x6a7d48,
  hemiI: 1.1,
  surround: 'lawn',
  outside: 0x78ad4a,
  outsideY: -0.55,
  green: ['#5cbf55', '#52b24c'],
  rough: ['#3f8f3c', '#367f34'],
  sand: '#ead9a4',
  ice: '#cfeefa',
  water: '#3ea6d9',
  lava: '#ff6a1a',
  wall: 0xd9b98a,
  wallTop: 0x8a6440,
  base: [0x8a6a44, 0x6f5435],
  flag: 0xe8483a,
  props: [0x4f9a43, 0x3f8a3a, 0xf2d24a, 0xe86a8a, 0xffffff],
  night: false,
};

export const THEMES: Record<ThemeId, Theme> = {
  garden: { ...DAY },
  roofs: {
    ...DAY,
    sky: 0xf6b48a,
    fog: 0xf0bfa0,
    fogNear: 40,
    fogFar: 110,
    sun: 0xffc890,
    sunI: 2.0,
    sunDir: [0.8, 0.65, 0.3],
    hemiSky: 0xffd2b8,
    hemiGround: 0x5a4a52,
    surround: 'street',
    outside: 0x5d5a66,
    outsideY: -9,
    green: ['#5aa86a', '#4f9a60'],
    rough: ['#b8583a', '#9a4a30'],
    wall: 0xb85a3c,
    wallTop: 0x7a3a26,
    base: [0x9a5a3c, 0x7a4430],
    flag: 0x3a7ad8,
    props: [0xa84a32, 0x8a3a28, 0x5a5050, 0xd8c4a8, 0xffd27a],
  },
  ship: {
    ...DAY,
    sky: 0x8fd6f6,
    fog: 0xaee2f6,
    sun: 0xfff6e0,
    sunI: 2.1,
    sunDir: [-0.3, 1, 0.4],
    hemiGround: 0x3a7090,
    surround: 'sea',
    outside: 0x14598a,
    outsideY: -1.2,
    green: ['#c8955a', '#bb894f'], // a felt-free deck: the "green" is the planking
    rough: ['#7a4f2a', '#6a4424'],
    wall: 0x8a5a30,
    wallTop: 0x4a2a14,
    base: [0x6a3e1e, 0x4a2a14],
    flag: 0x1a1a1a,
    props: [0x8a5a30, 0x6a4020, 0xe8e0d0, 0xc83a2e, 0x2a2a2a],
  },
  fair: {
    ...DAY,
    sky: 0x2a2450,
    fog: 0x2e2a58,
    fogNear: 35,
    fogFar: 95,
    sun: 0xc8c0ff,
    sunI: 1.1,
    sunDir: [0.3, 1, 0.5],
    hemiSky: 0x8a7ad8,
    hemiGround: 0x3a2a4a,
    hemiI: 1.0,
    surround: 'fairground',
    outside: 0x3a3048,
    outsideY: -0.55,
    green: ['#3fae6a', '#36a060'],
    rough: ['#e8e2d8', '#d84a3c'],
    wall: 0xf2f0ea,
    wallTop: 0xe8483a,
    base: [0x4a3a5a, 0x382c46],
    flag: 0xffd23a,
    props: [0xe8483a, 0xffd23a, 0x4ab8ff, 0xff7ad8, 0xffffff],
    night: true,
  },
  glacier: {
    ...DAY,
    sky: 0xc8e8f8,
    fog: 0xdaf0fa,
    sun: 0xffffff,
    sunI: 2.3,
    sunDir: [-0.6, 0.9, 0.4],
    hemiSky: 0xe8f6ff,
    hemiGround: 0x7aa0b8,
    surround: 'ice',
    outside: 0xe8f4fa,
    outsideY: -0.7,
    green: ['#6cc49a', '#62b88e'],
    rough: ['#f4f9fc', '#dceef8'],
    wall: 0xe8f6fc,
    wallTop: 0x8ac4e0,
    base: [0x8ac4e0, 0x6aa8cc],
    flag: 0xe8483a,
    props: [0xffffff, 0xd8eef8, 0x9ad0ea, 0x3a6a4a, 0x2f5a3e],
  },
  volcano: {
    ...DAY,
    sky: 0x3a2228,
    fog: 0x4a2a28,
    fogNear: 30,
    fogFar: 90,
    sun: 0xffa060,
    sunI: 1.4,
    sunDir: [0.3, 1, -0.2],
    hemiSky: 0x8a5a5a,
    hemiGround: 0x3a1a12,
    hemiI: 0.9,
    surround: 'magma',
    outside: 0x2c2422,
    outsideY: -0.8,
    green: ['#6a7d4a', '#5f7243'],
    rough: ['#3a3236', '#2e282c'],
    sand: '#8a7a6a',
    wall: 0x5a5054,
    wallTop: 0xff6a1a,
    base: [0x3a3236, 0x2a2426],
    flag: 0xffd23a,
    props: [0x3a3236, 0x2e282c, 0xff6a1a, 0xffa040, 0x4a4044],
    night: true,
  },
  // (the six new courses get their own look in delivery 2)
  beach: { ...DAY },
  temple: { ...DAY },
  castle: { ...DAY },
  neon: { ...DAY },
  canyon: { ...DAY },
  moon: { ...DAY },
};

/** Night version of a theme (daily modifier). */
export function nightOf(t: Theme): Theme {
  if (t.night) return t;
  return { ...t, sky: 0x1a2440, fog: 0x1e2a44, fogNear: 30, fogFar: 90, sun: 0x9ab4ff, sunI: 0.9, hemiSky: 0x4a5a8a, hemiGround: 0x1e2430, hemiI: 0.8, night: true };
}

export const hexStr = (n: number) => '#' + n.toString(16).padStart(6, '0');
