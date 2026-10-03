import type { CourseDef, HoleDef } from './types';

// Legend: ' ' void (falls off: +1) · '#' wall · '.' green · ':' sand · '~' water · '_' ice · 'L' lava
// '^' 'v' '<' '>' slopes (the ball is pushed that way) · 'O' cup · 'T' tee · 'B' bumper · 'S' spinning beam centre
// Holes are drawn with the tee at the bottom and the cup at the top: the camera looks up the screen.

const h = (d: HoleDef) => d;

export const COURSES: CourseDef[] = [
  {
    id: 'garden',
    color: '#3cc46e',
    cup: { en: 'Garden Cup', es: 'Copa del Jardín' },
    num: 1,
    name: { es: 'El jardín', en: 'The Garden' },
    tip: { es: 'Tira hacia atrás para apuntar y suelta. Usa las paredes para rebotar.', en: 'Pull back to aim and let go. Bank off the walls.' },
    holes: [
      h({
        id: 'g1',
        name: { es: 'Primer golpe', en: 'First Putt' },
        par: 2,
        // (a gentle bowl round the cup: a first putt that is roughly right drops)
        map: ['#######', '#.>v<.#', '#.>O<.#', '#.>^<.#', '#.....#', '#.....#', '#.....#', '#.....#', '#..T..#', '#######'],
      }),
      h({
        id: 'g2',
        name: { es: 'La esquina', en: 'The Corner' },
        par: 3,
        map: [
          '###########',
          '#......O..#',
          '#.........#',
          '#..########',
          '#..#       ',
          '#..#       ',
          '#..#       ',
          '#..#       ',
          '#..#       ',
          '#.T#       ',
          '####       ',
        ],
      }),
      h({
        id: 'g3',
        name: { es: 'El seto', en: 'The Hedge' },
        par: 3,
        map: [
          '#########',
          '#::.O.::#',
          '#.......#',
          '#.......#',
          '#..###..#',
          '#..###..#',
          '#..###..#',
          '#.......#',
          '#.......#',
          '#.......#',
          '#...T...#',
          '#########',
        ],
      }),
    ],
  },
  {
    id: 'roofs',
    color: '#e2703f',
    cup: { en: 'Chimney Cup', es: 'Copa de la Chimenea' },
    num: 2,
    name: { es: 'Los tejados', en: 'The Rooftops' },
    tip: { es: 'Donde no hay pretil, la bola se cae a la calle (+1). Las flechas empujan la bola.', en: 'No railing means the ball drops to the street (+1). Arrows push the ball.' },
    holes: [
      h({
        id: 'r1',
        name: { es: 'La tabla', en: 'The Plank' },
        par: 2,
        map: ['#######', '#..O..#', '#.....#', '#.....#', '##...##', '  ...  ', '  ...  ', '  ...  ', '##...##', '#.....#', '#.....#', '#..T..#', '#######'],
      }),
      h({
        id: 'r2',
        name: { es: 'Tejas', en: 'Roof Tiles' },
        par: 3,
        map: ['#########', '#...O...#', '#.......#', '#.......#', '#>>>>>>> ', '#>>>>>>> ', '#>>>>>>> ', '#.......#', '#.......#', '#...T...#', '#########'],
      }),
      h({
        id: 'r3',
        name: { es: 'Chimeneas', en: 'Chimneys' },
        par: 3,
        map: [
          '###########',
          '#....O....#',
          '#.........#',
          '#vvvvvvvvv#',
          '#vv##vvvvv#',
          '#vv##vv##v#',
          '#vvvvvv##v#',
          '#vvvvvvvvv#',
          '#..  .....#',
          '#..  .....#',
          '#.........#',
          '#....T....#',
          '###########',
        ],
      }),
    ],
  },
  {
    id: 'ship',
    color: '#3a8fd6',
    cup: { en: 'Anchor Cup', es: 'Copa del Ancla' },
    num: 3,
    name: { es: 'El barco pirata', en: 'The Pirate Ship' },
    tip: { es: 'La cubierta se balancea: la bola se va hacia el lado que baja. Sin borda, al agua (+1).', en: 'The deck sways: the ball rolls to the low side. No rail means splash (+1).' },
    holes: [
      h({
        id: 's1',
        name: { es: 'Cubierta', en: 'The Deck' },
        par: 2,
        sway: { amp: 2.2, period: 4.2 },
        map: ['#########', '#...O...#', '#.......#', '#.......#', ' ....... ', ' ....... ', '#.......#', '#.......#', '#...T...#', '#########'],
      }),
      h({
        id: 's2',
        name: { es: 'Los mástiles', en: 'The Masts' },
        par: 3,
        sway: { amp: 2.4, period: 3.6 },
        map: ['###########', '#....O....#', '#.........#', '#..#...#..#', '#.........#', ' ......... ', ' ....#.... ', '#.........#', '#..#...#..#', '#.........#', '#....T....#', '###########'],
      }),
      h({
        id: 's3',
        name: { es: 'La pasarela', en: 'The Gangplank' },
        par: 3,
        sway: { amp: 2.6, period: 4.8 },
        map: ['#######', '#..O..#', '#.....#', '##...##', '  ...  ', '  ...  ', '  ...  ', '  ...  ', '##...##', '#.....#', '#..T..#', '#######'],
      }),
    ],
  },
  {
    id: 'fair',
    color: '#b45cf0',
    cup: { en: 'Carousel Cup', es: 'Copa del Carrusel' },
    num: 4,
    name: { es: 'La feria', en: 'The Funfair' },
    tip: { es: 'Las aspas giran sin parar: espera tu momento. Las setas rojas rebotan fuerte.', en: 'The paddles never stop turning: time your putt. Red mushrooms bounce hard.' },
    holes: [
      h({
        id: 'f1',
        name: { es: 'El molino', en: 'The Windmill' },
        par: 2,
        spinners: [{ len: 2.5, speed: 1.3 }],
        map: ['#########', '#...O...#', '#.......#', '#.......#', '#.......#', '#...S...#', '#.......#', '#.......#', '#.......#', '#...T...#', '#########'],
      }),
      h({
        id: 'f2',
        name: { es: 'Setas locas', en: 'Mushroom Mania' },
        par: 3,
        map: ['###########', '#....O....#', '#.........#', '#..B...B..#', '#....B....#', '#.B..#..B.#', '#....B....#', '#..B...B..#', '#.........#', '#.........#', '#....T....#', '###########'],
      }),
      h({
        id: 'f3',
        name: { es: 'Doble molino', en: 'Double Mill' },
        par: 3,
        spinners: [
          { len: 1.9, speed: 1.6 },
          { len: 1.9, speed: -1.6, phase: 0.8 },
        ],
        map: ['###########', '#....O....#', '#...B.B...#', '#.........#', '#..S...S..#', '#.........#', '###.....###', '  #.....#  ', '  #.....#  ', '  #.....#  ', '  #..T..#  ', '  #######  '],
      }),
    ],
  },
  {
    id: 'glacier',
    color: '#6fd0f5',
    cup: { en: 'Snowflake Cup', es: 'Copa del Copo de Nieve' },
    num: 5,
    name: { es: 'El glaciar', en: 'The Glacier' },
    tip: { es: 'En el hielo la bola casi no frena: golpea suave. Cuidado con los bloques que se deslizan.', en: 'Ice barely slows the ball: putt soft. Watch the sliding blocks.' },
    holes: [
      h({
        id: 'i1',
        name: { es: 'Pista de hielo', en: 'Ice Rink' },
        par: 2,
        map: ['#######', '#:::::#', '#__O__#', '#_____#', '#_____#', '#_____#', '#_____#', '#_____#', '#_____#', '#__T__#', '#######'],
      }),
      h({
        id: 'i2',
        name: { es: 'Bloques de hielo', en: 'Ice Blocks' },
        par: 3,
        movers: [
          { x0: 2.2, z0: 4.5, x1: 6.8, z1: 4.5, w: 2, h: 1, period: 3.4 },
          { x0: 6.8, z0: 6.5, x1: 2.2, z1: 6.5, w: 2, h: 1, period: 4.2, phase: 0.3 },
        ],
        map: ['#########', '#...O...#', '#.......#', '#.......#', '#_______#', '#_______#', '#_______#', '#_______#', '#.......#', '#.......#', '#...T...#', '#########'],
      }),
      h({
        id: 'i3',
        name: { es: 'Grietas', en: 'Crevasses' },
        par: 3,
        map: ['###########', '#....O....#', '#_________#', '#~~~__~~~~#', '#_________#', '#_________#', '#~~~~__~~~#', '#_________#', '#_________#', '#....T....#', '###########'],
      }),
    ],
  },
  {
    id: 'volcano',
    color: '#ff6a1a',
    cup: { en: 'Magma Cup', es: 'Copa del Magma' },
    num: 6,
    name: { es: 'El volcán', en: 'The Volcano' },
    tip: { es: 'La lava avanza con cada golpe. Si te alcanza, +1. ¡Métela antes!', en: 'The lava creeps forward after every putt. If it reaches you, +1. Sink it first!' },
    holes: [
      h({
        id: 'v1',
        name: { es: 'Río de lava', en: 'Lava Creek' },
        par: 2,
        lavaRise: 2,
        map: ['#########', '#...O...#', '#.......#', '#.......#', '#.......#', '#.......#', '#.......#', '#.......#', '#...T...#', '#LLLLLLL#', '#########'],
      }),
      h({
        id: 'v2',
        name: { es: 'Zigzag', en: 'Zigzag' },
        par: 3,
        lavaRise: 4,
        map: ['###########', '#O........#', '#.........#', '#######...#', '#.........#', '#.........#', '#...#######', '#.........#', '#.........#', '#LT.......#', '###########'],
      }),
      h({
        id: 'v3',
        name: { es: 'El cráter', en: 'The Crater' },
        par: 3,
        lavaRise: 2,
        map: ['###########', '#LL.....LL#', '#L.......L#', '#...###...#', '#..#...#..#', '#..#.O....#', '#..#####..#', '#.........#', '#.........#', '#L.......L#', '#LL..T..LL#', '###########'],
      }),
    ],
  },
];

export const ALL_HOLES: { course: CourseDef; hole: HoleDef; index: number }[] = COURSES.flatMap((c) => c.holes.map((hole, index) => ({ course: c, hole, index })));
