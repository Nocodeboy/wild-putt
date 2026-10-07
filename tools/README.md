# Herramientas

Scripts de apoyo: no forman parte del juego. Se ejecutan desde la raíz del proyecto.

Los de Python usan Playwright con Chromium (`pip install playwright` y `playwright install chromium`) y cargan el juego compilado. Antes: `npm run build` y, en otra terminal, `npm run serve`, que sirve `dist/` en http://127.0.0.1:8765. Abrirlo como archivo (`file://`) no sirve porque las fuentes no cargan.

## Simulación y dificultad (TypeScript, sin navegador)

| Script | Qué hace | Uso |
|---|---|---|
| `route-table.ts` | Elige el diseño de cada hoyo generado y mide su par con el bot (criterios en `docs/dificultad.md`). Escribe `src/sim/routeTable.ts` | `npm run route-table` |
| `measure.ts` | La medida de un hoyo (8 partidas casual y 2 PRO) y el par que sale de ella. Lo usan `route-table.ts` y `bot.ts` | — |
| `bot.ts` | El bot juega cada hoyo de la gira en modo PRO y casual (falla unos 4° y un 15 % de fuerza) y saca la media de golpes contra el par; también 3 retos diarios | `npm run bot` (o `npx tsx tools/bot.ts [partidas] [L12 \| recorrido \| daily]`) |
| `daily-table.ts` | Regenera `src/sim/dailyTable.ts`, las semillas del reto diario en las que el bot PRO hace par o menos en los 6 hoyos. **Hay que ejecutarlo después de tocar la simulación o la ruta** | `npm run daily-table` |
| `strings.ts` | Lista los textos en inglés que faltan en `src/locales/<idioma>.json` | `npx tsx tools/strings.ts [pt\|fr\|de\|it]` |
| `physcheck.ts` | El bot casual juega toda la gira y avisa si una bola se para dentro de una pared o fuera del suelo, o si recoge la bola | `npx tsx tools/physcheck.ts [partidas] [desde] [hasta]` |
| `shapes-svg.ts` | Dibuja en SVG los contornos suaves (paredes, borde, estanques, búnkeres), el suelo fino, colinas, molinos, rizos y túneles de los hoyos a mano, de la gira o recién generados | `npx tsx tools/shapes-svg.ts carpeta [hand \| route \| L12 … \| gen:recorrido:n[:d]]` |

## Imágenes y vídeos (Python + Playwright, con `dist/` servido)

| Script | Qué genera | Dónde |
|---|---|---|
| `assets.py` | Iconos de la web, imagen para redes (`og.png`) y las 3 portadas de CrazyGames, renderizados desde el juego real | `assets/` (`python3 tools/assets.py [all\|icons\|og\|covers]`) |
| `android_assets.py` | Iconos adaptativos y splash de Android; icono 512, gráfico 1024×500 y 6 capturas para Play | `android/app/src/main/res/` y `assets/play/` (`npm run android:assets`) |
| `shots.py` | Capturas de control de hoyos de la gira (cámara de juego o `--over` para la vista general) | carpeta indicada (`python3 tools/shots.py carpeta L1 L6 … [--over]`) |
| `testshots.py` | Juega en el juego real hoyos de prueba escritos a mano (`tools/testholes/*.json`: molino, rizo, puente, volcán…) y los captura; `--bot=s` deja jugar al bot | carpeta indicada (`python3 tools/testshots.py carpeta tools/testholes/classics.json`) |
| `video.py` | Vídeos de vista previa de CrazyGames (1920×1080 y 1080×1620, ~15 s, sin sonido): golpes reales del bot fotograma a fotograma | `build/video/` (`PROFILE=cg169\|cg23 python3 tools/video.py all`) |

## Música

La música no se compone por código: se genera con IA en Magnific (Lyria 3 Pro) y se recorta y normaliza con ffmpeg. `assets/music-game.mp3`: lounge-funk con guitarra, contrabajo, Rhodes y vibráfono; `assets/music-menu.mp3`: bossa nova con guitarra de nailon y vibráfono. En Android van en Opus (`dist/android`).

## Pruebas (Python + Playwright, con `dist/` servido)

| Script | Qué comprueba |
|---|---|
| `test_monetize.py` | Con los dobles de anuncios y compras (`?fakeads=1&fakeiap=1`): monedas por hoyo, x2, tienda (línea de tiro, bolas, monedas gratis), mulligan, trofeo de copa, topes del intersticial, reglas del diario, compras y la web sin anuncios ni compras |
| `test_cg_sdk.py` | Con un SDK de CrazyGames simulado: la secuencia de llamadas (`init`, `loadingStart/Stop`, `gameplayStart/Stop`, `happytime`), sin errores ni enlaces externos. `--ads` para la build con `CG_ADS=1` |
| `test_cg_data.py` | El guardado en la nube de CrazyGames: la partida del portal gana al cargar, la local se copia la primera vez y el progreso nuevo se guarda |
