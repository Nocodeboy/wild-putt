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
  {
    id: 'beach',
    color: '#2ec4b6',
    cup: { en: 'Seashell Cup', es: 'Copa de la Concha' },
    num: 7,
    name: { es: 'La playa', en: 'The Beach' },
    tip: { es: 'La marea sube y baja: la arena mojada se cubre de agua unos segundos. Elige el momento; una bola en el agua es +1.', en: 'The tide comes and goes: the wet sand floods for a few seconds. Pick your moment; a ball in the water is +1.' },
    holes: [
      h({
        id: 'b1',
        name: { es: 'Marea baja', en: 'Low Tide' },
        par: 2,
        tide: { period: 8, phase: 0.55, up: 0.42 },
        map: ['#########', '#...O...#', '#.......#', '#.......#', '#wwwwwww#', '#wwwwwww#', '#.......#', '#.......#', '#...T...#', '#########'],
      }),
    ],
  },
  {
    id: 'temple',
    color: '#e0a84b',
    cup: { en: 'Scarab Cup', es: 'Copa del Escarabajo' },
    num: 8,
    name: { es: 'El templo del sol', en: 'The Sun Temple' },
    tip: { es: 'Túneles: la bola entra por uno y sale por su pareja, con la misma velocidad y en la misma dirección.', en: 'Tunnels: in through one, out of its twin at the same speed and heading.' },
    holes: [
      h({
        id: 't1',
        name: { es: 'La puerta secreta', en: 'The Secret Door' },
        par: 2,
        map: ['#########', '#...O...#', '#.......#', '#...P...#', '#########', '#.......#', '#...P...#', '#.......#', '#.......#', '#...T...#', '#########'],
      }),
    ],
  },
  {
    id: 'castle',
    color: '#9aa7c7',
    cup: { en: 'Crown Cup', es: 'Copa de la Corona' },
    num: 9,
    name: { es: 'El castillo', en: 'The Castle' },
    tip: { es: 'Los rastrillos suben y bajan, y el puente levadizo se levanta sobre el foso. Espera tu momento.', en: 'Portcullises rise and fall, and the drawbridge lifts over the moat. Wait for your moment.' },
    holes: [
      h({
        id: 'c1',
        name: { es: 'El rastrillo', en: 'The Portcullis' },
        par: 2,
        gates: { period: 4, phase: 0.3 },
        map: ['#########', '#...O...#', '#.......#', '#.......#', '###GGG###', '#.......#', '#.......#', '#.......#', '#...T...#', '#########'],
      }),
    ],
  },
  {
    id: 'neon',
    color: '#ff3fb4',
    cup: { en: 'Neon Cup', es: 'Copa de Neón' },
    num: 10,
    name: { es: 'La ciudad de neón', en: 'Neon City' },
    tip: { es: 'Los aceleradores lanzan la bola hacia donde apuntan sus flechas. Sin pretil, la bola se cae a la calle.', en: 'Boost pads launch the ball the way their arrows point. No railing means a drop to the street.' },
    holes: [
      h({
        id: 'n1',
        name: { es: 'El carril rápido', en: 'Fast Lane' },
        par: 2,
        map: ['#######', '#..O..#', '#.....#', '#.....#', '#.....#', '#.....#', '#vvvvv#', '#vvvvv#', '#.....#', '#..8..#', '#.....#', '#..T..#', '#######'],
      }),
    ],
  },
  {
    id: 'canyon',
    color: '#d0603f',
    cup: { en: 'Canyon Cup', es: 'Copa del Cañón' },
    num: 11,
    name: { es: 'El cañón', en: 'The Canyon' },
    tip: { es: 'Sube las rampas con fuerza para saltar el cañón. Si vas flojo, la bola cae (+1).', en: 'Hit the ramps hard enough to clear the gap. Too soft and the ball drops (+1).' },
    holes: [
      h({
        id: 'y1',
        name: { es: 'El salto', en: 'The Gap' },
        par: 2,
        map: ['#######', '#..O..#', '#.....#', '#.....#', '#.....#', '       ', '       ', '#JJJJJ#', '#.....#', '#.....#', '#..T..#', '#######'],
      }),
    ],
  },
  {
    id: 'moon',
    color: '#b9c4dd',
    cup: { en: 'World Tour Trophy', es: 'Trofeo de la Gira Mundial' },
    num: 12,
    name: { es: 'La base lunar', en: 'Moon Base' },
    tip: { es: 'Poca gravedad: la bola casi no frena. Los pozos de gravedad la atraen, y su agujero negro se la traga (+1).', en: 'Low gravity: the ball barely slows down. Gravity wells pull it in, and their black hole swallows it (+1).' },
    holes: [
      h({
        id: 'm1',
        name: { es: 'Gravedad cero', en: 'Zero G' },
        par: 2,
        gravity: 0.45,
        map: ['#########', '#...O...#', '#.......#', '#.......#', '#.......#', '#.....M.#', '#.......#', '#.......#', '#...T...#', '#########'],
      }),
    ],
  },
];

export const ALL_HOLES: { course: CourseDef; hole: HoleDef; index: number }[] = COURSES.flatMap((c) => c.holes.map((hole, index) => ({ course: c, hole, index })));
