// "More games": the studio's other games, shown on the web and in the Android app (never on CrazyGames, where
// external links are not allowed). Data only: add or edit a game here and the menu follows (docs/negocio.md of the
// studio, "Promoción cruzada"). Links carry UTM tags so the other games' analytics can tell where players came from.
import type { Txt } from './sim/types';

export interface OtherGame {
  id: string;
  name: Txt;
  tag: Txt;
  /** public web version */
  url: string;
  /** Google Play package: used from the Android app once the game is live in production (`playLive`) */
  play?: string;
  playLive?: boolean;
  /** tile colours and a symbol for its card */
  color: string;
  color2: string;
  icon: string;
}

export const MORE_GAMES: OtherGame[] = [
  {
    id: 'apagalo',
    name: { en: 'Put It Out!', es: '¡Apágalo!' },
    tag: { en: 'Grab the hose and beat fires that spread with the wind.', es: 'Coge la manguera y apaga fuegos que se extienden con el viento.' },
    url: 'https://apagalo.vercel.app',
    play: 'com.nocodeboy.apagalo',
    playLive: false,
    color: '#e0402f',
    color2: '#ffc43d',
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-3-1-6 1-9z" fill="#ffc43d"/><path d="M12 11c.6 2 3 3 3 5.5a3 3 0 0 1-6 0c0-1.6 1-2.6 1.6-3.2.1 1 .6 1.6 1.2 1.6 0-1.4-.4-2.6.2-3.9z" fill="#fff4d6"/></svg>',
  },
  {
    id: 'trayrunner',
    name: { en: 'Tray Runner: Restaurant Rush', es: 'Tray Runner: Restaurant Rush' },
    tag: { en: 'Take the order, run and serve it hot, from Madrid to Tokyo.', es: 'Toma nota, corre y sirve antes de que se enfríe, de Madrid a Tokio.' },
    url: 'https://tray-runner.vercel.app',
    play: 'com.nocodeboy.trayrunner',
    playLive: false,
    color: '#1f7a8c',
    color2: '#f4f1e8',
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 16h18" stroke="#f4f1e8" stroke-width="2.4" stroke-linecap="round"/><path d="M5 16a7 7 0 0 1 14 0z" fill="#f4f1e8"/><path d="M12 7.5V6M10.4 6h3.2" stroke="#f4f1e8" stroke-width="2" stroke-linecap="round"/></svg>',
  },
  {
    id: 'roundemup',
    name: { en: 'Round ’Em Up!', es: '¡Pastoréalo!' },
    tag: { en: 'Two border collies on a world tour of sheepdog trials.', es: 'Dos border collies de gira por concursos de perros pastores.' },
    url: 'https://pastorealo.vercel.app',
    play: 'com.nocodeboy.roundemup',
    playLive: false,
    color: '#3f7a3a',
    color2: '#f4f1e8',
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="13" rx="7" ry="5" fill="#f4f1e8"/><circle cx="6.5" cy="11" r="2.4" fill="#2a2a2a"/><path d="M8 18v2.5M16 18v2.5" stroke="#2a2a2a" stroke-width="1.6" stroke-linecap="round"/></svg>',
  },
];

/** Where a game's card links to from this build (with UTM tags). `app`: running inside the Android app. */
export function gameLink(g: OtherGame, source: string, app: boolean): string {
  const utm = `utm_source=${encodeURIComponent(source)}&utm_medium=${app ? 'app' : 'web'}&utm_campaign=more_games`;
  if (app && g.play && g.playLive) return `https://play.google.com/store/apps/details?id=${g.play}&referrer=${encodeURIComponent(utm)}`;
  return `${g.url}/?${utm}`;
}
