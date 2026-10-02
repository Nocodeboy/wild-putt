# Wild Putt (¡Embócala!)

Minigolf casual en 3D low-poly donde cada recorrido es un diorama con vida propia: tejados con huecos a la calle, un barco pirata que se balancea, una feria con aspas que giran, un glaciar que no frena y un volcán cuya lava avanza con cada golpe. 6 recorridos de 3 hoyos y un reto diario de 6 hoyos igual para todos. Web y móvil, en inglés (idioma principal) y español.

Forma parte del estudio de juegos de @nocodeboy ([Nocodeboy/nocodeboy-games](https://github.com/Nocodeboy/nocodeboy-games)) y sale del mismo motor que *¡Apágalo!*, *Tray Runner* y *¡Pastoréalo!* (Three.js + TypeScript + esbuild). Arrancó el 3 oct 2026 tras matar *Dino Wrangler*.

Estado, decisiones y siguientes pasos: [docs/README.md](docs/README.md). Concepto, competencia y criterios de muerte: [docs/concepto.md](docs/concepto.md).

## Estructura

```
src/sim/        Simulación pura (sin 3D)
  world.ts        física de la bola sobre una rejilla: fricción por suelo, pendientes, paredes, setas, aspas,
                  bloques móviles, barco que se balancea, lava que avanza, el hoyo y las penalizaciones
  courses.ts      los 6 recorridos y sus 18 hoyos (mapas ASCII; la leyenda está arriba del archivo)
  daily.ts        reto diario: un hoyo de cada recorrido y un modificador · dailyTable.ts: semillas comprobadas (generado)
  bot.ts          bot que busca el mejor golpe simulando cientos de putts (dificultad, demo del menú, reto diario)
src/render/     Three.js: la placa del hoyo, el entorno de cada recorrido, bola, bandera, línea de tiro, obstáculos
src/ui/         HUD, tarjeta de puntuación, pantallas y avisos
src/input.ts    tirachinas a un pulgar (arrastrar hacia atrás y soltar) y teclado
src/audio.ts    efectos sintetizados con WebAudio (golpe, rebotes, hoyo, público, agua, lava) y música
src/main.ts     flujo de recorridos y reto diario, bucle principal
tools/          bot de dificultad, tabla del reto diario, imágenes y pruebas del SDK de CrazyGames
assets/         música (generada con IA en Magnific), iconos, og.png y portadas de CrazyGames
```

## Comandos

Requisitos: Node 22 o superior. Para las imágenes, Python 3 con Playwright.

| Comando | Qué hace |
|---|---|
| `npm install` | Instala las dependencias |
| `npm run build` | Compila la web (`dist/web`), el zip de CrazyGames (`dist/wildputt-crazygames.zip`) y la página para el artefacto de Claude (`dist/artifact.html`) |
| `npm run serve` | Sirve `dist/` en http://127.0.0.1:8765 (la web en `/web/`) |
| `npm run typecheck` | Comprueba los tipos |
| `npm run bot` | El bot juega cada hoyo y saca la media de golpes contra el par |
| `npm run daily-table` | Regenera las semillas del reto diario (después de tocar la física o los hoyos) |
| `npm run deploy:web` | Publica la web en Vercel (proyecto `wild-putt`) |

## Controles

- **Móvil y ratón:** pon el dedo en cualquier sitio y tira hacia atrás. La bola sale en la dirección contraria; cuanto más tiras, más fuerte. La línea de puntos enseña el recorrido hasta el primer rebote. Suelta para golpear; si vuelves al punto de partida, se cancela.
- **Teclado:** flechas (o A/D) para girar, mantén Espacio para cargar la fuerza (sube y baja) y suelta para golpear. Esc cancela o pausa.

## Cómo se hace un hoyo

Los hoyos son mapas ASCII en `src/sim/courses.ts`, con el tee abajo y la bandera arriba: `#` pared, `.` green, `:` arena, `_` hielo, `~` agua, espacio = vacío, `L` lava, `^ v < >` pendientes, `O` hoyo, `T` tee, `B` seta, `S` centro de un aspa. Después de tocar un hoyo: `npm run bot` (la media del bot casual debería quedar cerca del par) y `npm run daily-table`.
