# Wild Putt: Mini Golf Tour (¡Embócala!)

Minigolf casual en 3D low-poly donde mini golf no debería haber: una gira mundial de **120 hoyos en 12 recorridos** (jardín, tejados, barco pirata, feria, glaciar, volcán, playa, templo del sol, castillo, ciudad de neón, cañón y base lunar), cada uno con su mecánica. Un hoyo de copa cada 10 con su trofeo, monedas, tienda de bolas y línea de tiro, mulligan, reto diario de 6 hoyos igual para todos y 6 idiomas. Web, CrazyGames y Android (Capacitor, con AdMob y compras).

Forma parte del estudio de juegos de @nocodeboy ([Nocodeboy/nocodeboy-games](https://github.com/Nocodeboy/nocodeboy-games)) y sale del mismo motor que *Put It Out!*, *Tray Runner* y *Round ’Em Up!* (Three.js + TypeScript + esbuild).

Estado y decisiones: [docs/README.md](docs/README.md). Diseño de la 1.0: [docs/diseno-v2.md](docs/diseno-v2.md). Dificultad: [docs/dificultad.md](docs/dificultad.md). Publicar: [docs/publicar.md](docs/publicar.md).

## Estructura

```
src/sim/        Simulación pura (sin 3D), determinista a 1/120 s
  world.ts        física de la bola sobre una rejilla: suelos, pendientes, paredes, setas, aspas, bloques móviles,
                  barco, lava, marea, rastrillos, puente levadizo, aceleradores, rampas, túneles, pozos de gravedad,
                  monedas, mulligan y vista previa del tiro
  courses.ts      los 12 recorridos y sus hoyos hechos a mano (mapas ASCII; la leyenda está arriba del archivo)
  gen.ts          generador de hoyos por plantillas y mecánicas de cada recorrido
  route.ts        la gira de 120 hoyos (orden, dificultad, hoyos de copa) · routeTable.ts: diseño y par medidos (generado)
  daily.ts        reto diario: 6 hoyos de la gira y un modificador · dailyTable.ts: semillas comprobadas (generado)
  bot.ts          bot que busca el mejor golpe simulando cientos de putts
src/render/     Three.js: placa del hoyo, entorno de cada recorrido, piezas animadas, bola, putter y línea de tiro
src/ui/         HUD, pantallas, tienda (shop.ts), trofeos y vitrina (trophy.ts), iconos
src/economy.ts  monedas, bolas, línea de tiro, mulligan y premios
src/monetize/   anuncios y compras: CrazyGames, AdMob + Play Billing en Android, y dobles de prueba
src/storage.ts  partida guardada (v2) · src/analytics.ts: Supabase del estudio · src/platform.ts: CrazyGames y Android
src/i18n.ts     inglés y español en el código; portugués, francés, alemán e italiano en src/locales/*.json
src/input.ts    tirachinas a un pulgar y teclado · src/audio.ts: efectos sintetizados y música
src/main.ts     flujo de la gira, hoyos, diario, tienda y anuncios; bucle principal
android/        proyecto de Capacitor (com.nocodeboy.wildputt)
tools/          bots, tablas generadas, imágenes, vídeos y pruebas (ver tools/README.md)
assets/         música (IA, Magnific), iconos, og.png, portadas de CrazyGames y gráficos de Play (assets/play)
```

## Comandos

Requisitos: Node 22 o superior. Para imágenes, vídeos y pruebas, Python 3 con Playwright. Para Android, el SDK de Android (plataforma 36) y JDK 21.

| Comando | Qué hace |
|---|---|
| `npm install` | Instala las dependencias |
| `npm run build` | Compila la web (`dist/web`), el zip de CrazyGames (`dist/wildputt-crazygames.zip`; `CG_ADS=1` para los anuncios del portal), los archivos de Android (`dist/android`) y la página para el artefacto de Claude (`dist/artifact.html`) |
| `npm run serve` | Sirve `dist/` en http://127.0.0.1:8765 (la web en `/web/`; `?fakeads=1&fakeiap=1` activa los dobles de anuncios y compras en local) |
| `npm run typecheck` | Comprueba los tipos |
| `npm run bot` | El bot juega cada hoyo de la gira y saca la media de golpes contra el par |
| `npm run route-table` | Elige el diseño y mide el par de los 120 hoyos (largo) |
| `npm run daily-table` | Regenera las semillas del reto diario (después de tocar la física o los hoyos) |
| `npm run deploy:web` | Publica la web en Vercel con la CLI (normalmente no hace falta: el proyecto `wild-putt` está conectado al repositorio y cada push a `main` se publica solo con `node build.mjs --web`) |
| `npm run android:sync` | Compila y copia la web al proyecto de Android |
| `npm run android:assets` | Icono, splash y gráficos de la ficha de Play |

## Android

`npm run android:sync` y, en `android/`, `./gradlew assembleDebug` (APK de prueba con anuncios de prueba) o `./gradlew bundleRelease` (AAB firmado). Para la release:
- `android/keystore.properties` y `android/keystore/wildputt-upload.jks` con la clave de subida (fuera de git; copia en `NO-COMPARTIR\wild-putt`, con instrucciones en su `LEEME.txt`).
- Ids reales de AdMob en `src/monetize/android.ts` (`REAL_AD_UNITS`, `USE_TEST_ADS = false`) y en el manifest (ya puestos desde la 1.0.0). `RELEASE=1 node build.mjs` se niega a compilar con los de prueba.
- `versionCode` = 10000 × mayor + 100 × menor + parche (1.0.0 → 10000).

## Controles

- **Móvil y ratón:** pon el dedo en cualquier sitio y tira hacia atrás (respecto a la cámara). Cuanto más tiras, más fuerte; suelta para golpear y vuelve al centro para cancelar. La línea de puntos enseña el recorrido hasta el primer rebote (más larga con las mejoras de la tienda).
- **Teclado:** flechas (o A/D) para girar, mantén Espacio para cargar la fuerza y suelta para golpear. C cambia la cámara; Esc pausa.

## Cómo se hace un hoyo

Los hoyos a mano son mapas ASCII en `src/sim/courses.ts` (la leyenda completa está arriba del archivo), con el tee abajo y la bandera arriba. Los generados salen de `src/sim/gen.ts`. Después de tocar la física, un hoyo o el generador: `npm run route-table`, `npm run daily-table` y comparar con [docs/dificultad.md](docs/dificultad.md).
