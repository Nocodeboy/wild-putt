# Herramientas

Scripts de apoyo: no forman parte del juego. Se ejecutan desde la raíz del proyecto.

Los de Python usan Playwright con Chromium (`pip install playwright` y `playwright install chromium`) y cargan el juego compilado. Antes: `npm run build` y, en otra terminal, `npm run serve`, que sirve `dist/` en http://127.0.0.1:8765. Abrirlo como archivo (`file://`) no sirve porque las fuentes no cargan.

## Simulación y dificultad (TypeScript, sin navegador)

| Script | Qué hace | Uso |
|---|---|---|
| `bot.ts` | El bot juega cada hoyo en modo PRO (perfecto) y casual (falla unos 4° y un 15 % de fuerza) y saca la media de golpes contra el par. Referencia en `docs/README.md` | `npm run bot` (o `npx tsx tools/bot.ts [partidas] [hoyo|recorrido|daily]`) |
| `daily-table.ts` | Regenera `src/sim/dailyTable.ts`, las semillas del reto diario en las que el bot PRO hace par o menos en los 6 hoyos. **Hay que ejecutarlo después de tocar la simulación** | `npm run daily-table` |

## Imágenes (Python + Playwright, con `dist/` servido)

| Script | Qué genera | Dónde |
|---|---|---|
| `assets.py` | Iconos de la web, imagen para redes (`og.png`) y las 3 portadas de CrazyGames, renderizados desde el juego real | `assets/` (`python3 tools/assets.py [all\|icons\|og\|covers]`) |

## Música

| Script | Qué genera | Uso |
|---|---|---|
| — | La música no se compone por código: se genera con IA en Magnific (Lyria 3 Pro) y se recorta y normaliza con ffmpeg. `assets/music-game.mp3`: lounge-funk con guitarra, contrabajo, Rhodes y vibráfono; `assets/music-menu.mp3`: bossa nova con guitarra de nailon y vibráfono | — |

## Pruebas del SDK de CrazyGames (Python + Playwright, con `dist/` servido)

| Script | Qué comprueba |
|---|---|
| `test_cg_sdk.py` | Con un SDK simulado: la secuencia de llamadas (`init`, `loadingStart/Stop`, `gameplayStart/Stop`, `happytime`), que no haya errores ni enlaces externos |
| `test_cg_data.py` | El guardado en la nube de CrazyGames: la partida del portal gana al cargar, la partida local se copia la primera vez y el progreso nuevo se guarda |

Los vídeos promocionales y las capturas de tienda de *¡Apágalo!* (`video.py`, `store_shots.py`) se pueden adaptar cuando el juego pase a la fase de tienda.
