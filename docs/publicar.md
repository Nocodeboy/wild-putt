# Publicar en la web, CrazyGames y Google Play

Preparado el 3 oct 2026 para la **1.0.0**. Todo lo que hay que pegar en los formularios está aquí, **en inglés primero** (idioma principal del estudio) y después en español. **Nada está publicado todavía:** cada paso irreversible (desplegar, aceptar términos, enviar a revisión, crear productos) espera el OK de Germán. Estado: §6.

## 0. Público: 13+

Minigolf de habilidad sin personajes infantiles: va a **13+** como los otros juegos del estudio (13–15, 16–17 y 18+). AdMob normal con consentimiento UMP en el EEE. En la ficha se habla de hoyos, par, trofeos y reto diario; nunca «kids», «children» ni «for kids».

## 1. Nombre

| | |
|---|---|
| Inglés (principal) | **Wild Putt** — `gameName` en `src/i18n.ts` y `NAME`/`TITLE` en `build.mjs` |
| Español | **¡Embócala!** |
| Título de tienda | **Wild Putt: Mini Golf Tour** (25 de 30) · web y CrazyGames: *Wild Putt · Mini Golf World Tour* |
| Paquete de Android | `com.nocodeboy.wildputt` (no se puede cambiar tras la primera subida) |

Comprobado el 3 oct 2026: no hay ningún juego llamado *Wild Putt* en Google Play, App Store ni CrazyGames ([diseno-v2.md](diseno-v2.md) §5.12).

**Palabras clave (ASO):** *mini golf*, *minigolf*, *putt*, *golf*, *crazy golf*, *putt putt*. Van *mini golf* en el título y *golf*, *putt* y *holes* en la descripción breve.

## 2. Web propia (Vercel)

- Proyecto `wild-putt` en Vercel (equipo *nocodeboy's projects*), todavía **sin crear**. Se despliega desde `dist/web` con la CLI: `npm run build` y `cd dist/web && npx vercel@latest deploy --prod` (o `npm run deploy:web`). **Antes de desplegar, borra `dist/web/.env.local`** si `vercel link` lo ha creado (lleva un token). URL prevista: `https://wild-putt.vercel.app` (ya está puesta en `build.mjs`, el texto de compartir y la política de privacidad).
- `app-ads.txt` en la raíz (lo copia `build.mjs` desde `assets/`): AdMob lo busca en la web de desarrollador de la ficha de Play.
- Título: *Wild Putt · Mini Golf World Tour*. Descripción, Open Graph y Twitter en inglés con `og.png`.
- Sin anuncios y sin compras. Con **More games** (Put It Out!, Tray Runner y Round ’Em Up!, enlaces con `utm_source=wildputt`).
- Política de privacidad en `/privacidad` (inglés y español).

## 3. CrazyGames

### Archivos

| Qué | Dónde | Notas |
|---|---|---|
| Juego (zip) | `dist/wildputt-crazygames.zip` (`npm run build`) | Carpeta plana con `index.html` (fuentes dentro) y la música. SDK v3 |
| Portada 16:9 | `assets/cg-cover-1920x1080.png` | El salto del cañón (L67) con el título a la derecha, fuera de la esquina de las etiquetas |
| Portada 2:3 | `assets/cg-cover-800x1200.png` | El acelerador de la ciudad de neón (L55) |
| Portada 1:1 | `assets/cg-cover-800x800.png` | El molino de la feria de noche (L9) |
| Vídeos de vista previa | `build/video/wild-putt-crazygames-1920x1080.mp4` y `-1080x1620.mp4` | `PROFILE=cg169` y `PROFILE=cg23 python3 tools/video.py all`: golpes reales del bot en varios recorridos, sin sonido ni textos |

### Formulario

- **Nombre:** Wild Putt
- **Categoría:** Sports (o Arcade). **Etiquetas (máximo 5):** *Golf*, *Mini Golf*, *3D*, *Physics*, *Skill*.
- **Orientación:** las dos. Ratón y teclado; en móvil y tableta, con el dedo.
- **Descripción (en):**

> Mini golf where mini golf shouldn’t be! Putt across rooftops, the deck of a swaying pirate ship, a funfair at night, a glacier, the edge of a volcano and the surface of the Moon.
>
> Wild Putt is a world tour of 120 holes on 12 courses, each with its own twist: rails that end over the street, a deck that tilts with the waves, windmill paddles that never stop, ice that never slows down, lava that creeps forward after every putt, a tide that floods the sand, tunnels in a sun temple, a castle’s portcullises and drawbridge, neon boost pads, ramps over a canyon and low gravity with black holes on the Moon.
>
> Every tenth hole is a cup hole: finish it at par or better to take home the course’s trophy. Earn coins, unlock 12 balls with their own trails and a longer aim line, and play the daily round: six holes, the same for everyone, with a ranking.

- **Controles (en):**

> Mouse or touch: press anywhere and pull back, like a slingshot. The further you pull, the harder the putt. Let go to putt; move back to the start to cancel.
> Keyboard: arrow keys (or A/D) to aim · hold Space to charge the power and release to putt · C to switch camera · Esc to pause.
> The dotted line shows the path up to the first bounce. Sink it in as few strokes as you can: par or better wins the trophy.

- **SDK:** sí (v3): `loadingStart/Stop`, `gameplayStart/Stop`, `happytime` (tres estrellas: hoyo bajo par o ronda diaria bajo par) y el módulo Data para guardar en la nube (`tools/test_cg_sdk.py` y `tools/test_cg_data.py`, los dos pasan).
- **Anuncios.** En Basic Launch el zip normal sale **sin ellos** (CrazyGames no sirve anuncios ahí y rechaza botones que no hacen nada). En Full Launch, `CG_ADS=1 npm run build` y `tools/test_cg_sdk.py --ads`:
  - Con recompensa: x2 monedas al acabar el hoyo, monedas gratis en la tienda (3 al día) y el mulligan (repetir el último golpe, una vez por hoyo; también con 100 monedas).
  - Intersticial solo al pulsar *Siguiente*, nunca en la primera sesión, con al menos 3 hoyos acabados, 2 desde el último y 120 s desde cualquier anuncio.
- **Enlaces externos:** ninguno. Sin «More games» y el texto para compartir no lleva la web.

### El primer medio minuto (lo que aprendimos de los rechazos de octubre)

CrazyGames rechazó *Round ’Em Up!* y *Tray Runner* el 2 oct por «calidad»: los revisores se iban en el primer minuto. En *Wild Putt*:
- **Pulsar *Play* lleva directo al hoyo 1** (y al 2): sin carta del recorrido ni pantalla intermedia mientras no estén acabados.
- **Hoyo 1 con embudo:** pendientes alrededor del hoyo, se emboca casi seguro en 1–2 golpes. Un anillo en el green y una flecha enseñan dónde tirar hasta el primer golpe.
- **La primera victoria en menos de 20 s**, con monedas, estrellas y «¡Birdie!».
- Cada recorrido nuevo se presenta con un hoyo hecho a mano que enseña su mecánica sola.

## 4. Google Play

**Proyecto de Android** (Capacitor, `android/`): ver el [README](../README.md). Ya compila en debug. Para la release faltan los ids reales de AdMob: hasta entonces `USE_TEST_ADS` es `true` y el manifest lleva el id de pruebas de Google, y `build.mjs` **se niega** a hacer la build de Android en modo release con ellos.

### Lo que tiene que hacer Germán antes (cuentas y claves)

1. **AdMob:** crear la app *Wild Putt* (Android, sin publicar todavía) con dos bloques: `android_rewarded` (con recompensa) y `android_interstitial` (intersticial). Pegar el id de la app en `android/app/src/main/AndroidManifest.xml` y los dos bloques en `REAL_AD_UNITS` de `src/monetize/android.ts`, y poner `USE_TEST_ADS = false` (o pasarme los ids y lo hago yo). Añadir la app al mensaje de consentimiento europeo (UMP) con la política de privacidad.
2. **Clave de subida:** `keytool -genkeypair -v -keystore wildputt-upload.jks -alias wildputt -keyalg RSA -keysize 2048 -validity 10000`, guardada en `NO-COMPARTIR\wildputt` con su `keystore.properties`. Nunca en git (`.gitignore` ya la excluye).
3. **Play Console:** crear la app (pido permiso para cada casilla legal).

### Productos (los mismos que *Round ’Em Up!*)

| Producto | Tipo | Qué da | Precio |
|---|---|---|---|
| `remove_ads` | Una vez | Sin intersticiales (los de premio siguen) y 500 monedas | 2,99 $ |
| `starter_pack` | Una vez | 3.000 monedas | 1,99 $ |
| `coins_s` | Consumible | 1.000 monedas | 0,99 $ |
| `coins_m` | Consumible | 6.000 monedas | 4,99 $ |
| `coins_l` | Consumible | 14.000 monedas | 9,99 $ |

Las monedas solo compran bolas (aspecto) y la línea de tiro más larga, que no cuenta en el reto diario; el mulligan nunca está en el diario. Nada de pagar para ganar.

### Pasos en Play Console

1. **Crear la app:** nombre *Wild Putt: Mini Golf Tour*, idioma predeterminado inglés (EE. UU.), juego, gratis.
2. **Configurar la app:**
   - Política de privacidad: `https://wild-putt.vercel.app/privacidad`.
   - Acceso: todo sin restricciones.
   - Anuncios: **sí**.
   - Clasificación (IARC): sin violencia, sexo, lenguaje, drogas ni apuestas; «Incluye compras». Previsiblemente PEGI 3 / Everyone.
   - Público objetivo: 13–15, 16–17 y 18+.
   - Seguridad de los datos (coherente con los SDK, igual que *Round ’Em Up!*): ubicación aproximada (de AdMob), historial de compras, interacciones en la app, registros de fallos, diagnóstico e IDs de dispositivo; analítica opcional desde Ajustes; cifrado en tránsito; sin cuentas.
   - ID de publicidad: sí (analítica, publicidad y prevención de fraude). El manifest lleva `AD_ID`.
   - Apps gubernamentales, funciones financieras y salud: no.
3. **Ficha:** textos de abajo; categoría *Juegos → Deportes*; etiquetas *Deportes*, *Golf*, *Casual*, *Arcade*.
4. **Gráficos** (en `assets/play/`, `python3 tools/android_assets.py`): `icon-512.png`, `feature-1024x500.png` y seis capturas verticales 1080×1920 con la línea de tiro (L55 neón, L67 cañón, L44 castillo, L21 volcán, L35 templo, L81 luna).
5. **Versión de producción** 10000 (1.0.0): AAB firmado (`npm run android:sync` y `./gradlew bundleRelease` en `android/`), los 177 países, notas en inglés. **Guardar como borrador** y pedir el OK antes de enviar a revisión.

### Textos de la ficha (inglés, idioma principal)

- **Título (30 como máximo):** `Wild Putt: Mini Golf Tour` (25)
- **Descripción breve (80 como máximo):** `Mini golf on rooftops, pirate ships, volcanoes and the Moon. 120 wild holes!` (76)
- **Descripción completa:**

> Mini golf where mini golf shouldn’t be! Putt across rooftops, the deck of a swaying pirate ship, a funfair at night, a glacier, the edge of a volcano and the surface of the Moon.
>
> ⛳ A WORLD TOUR OF 120 HOLES
> 12 courses, each with its own twist: rails that end over the street, a deck that tilts with the waves, windmills that never stop, ice that never slows down, lava that creeps forward after every putt, a tide that floods the sand, tunnels in a sun temple, portcullises and a drawbridge, neon boost pads, ramps over a canyon and low gravity with black holes on the Moon.
>
> 🏆 CUP HOLES AND TROPHIES
> Every tenth hole is a cup hole, longer and with everything its course has. Finish it at par or better to take its trophy home, and fill your cabinet with all 12.
>
> 🎯 ONE THUMB, REAL PHYSICS
> Pull back and let go. The dotted line shows the first bounce; walls, slopes, sand and bumpers do the rest. Sink it under par for three stars, or go for the hole in one.
>
> 🎨 BALLS, COINS AND A DAILY ROUND
> Earn coins on every hole and unlock 12 balls with their own trails (tennis, disco, planet, comet…) and a longer aim line. Every day there is a new daily round: six holes, the same for everyone, with a ranking.
>
> Play in English, Spanish, Portuguese, French, German or Italian.

### Textos en español (traducción es-ES y es-419)

- **Título:** `¡Embócala! Minigolf mundial` (27)
- **Descripción breve:** `Minigolf en tejados, barcos pirata, volcanes y la Luna. ¡120 hoyos locos!` (73)
- **Descripción completa:**

> ¡Minigolf donde no debería haber minigolf! Juega en los tejados, en la cubierta de un barco pirata que se balancea, en una feria de noche, en un glaciar, al borde de un volcán y en la Luna.
>
> ⛳ UNA GIRA DE 120 HOYOS
> 12 recorridos, cada uno con su sorpresa: barandillas que acaban sobre la calle, una cubierta que se inclina con las olas, molinos que no paran, hielo que no frena, lava que avanza con cada golpe, una marea que inunda la arena, túneles en un templo del sol, rastrillos y un puente levadizo, aceleradores de neón, rampas sobre un cañón y gravedad baja con agujeros negros en la Luna.
>
> 🏆 HOYOS DE COPA Y TROFEOS
> Cada diez hoyos hay un hoyo de copa, más largo y con todo lo de su recorrido. Acábalo en el par o mejor y te llevas su trofeo: llena la vitrina con los 12.
>
> 🎯 UN PULGAR Y FÍSICA DE VERDAD
> Tira hacia atrás y suelta. La línea de puntos enseña el primer rebote; las paredes, las pendientes, la arena y las setas hacen el resto. Bajo par son tres estrellas, o ve a por el hoyo en uno.
>
> 🎨 BOLAS, MONEDAS Y RONDA DIARIA
> Gana monedas en cada hoyo y desbloquea 12 bolas con su estela (tenis, disco, planeta, cometa…) y una línea de tiro más larga. Cada día hay una ronda diaria nueva: seis hoyos, iguales para todos, con ranking.
>
> Juega en español, inglés, portugués, francés, alemán o italiano.

## 5. Después de publicar

- **Supabase:** la fila de `wildputt` en `games` ya está (migración `20261003131524_wildputt.sql` del repositorio del estudio): `level1 = 'L1'`, `result_prop = 'strokes'`, `max_score = 2000` (el diario envía 1000 + par − golpes).
- Añadir *Wild Putt* a los «More games» de *Put It Out!*, *Tray Runner* y *Round ’Em Up!* (sus `src/crosspromo.ts`) y a la página del estudio.
- Cuando cada juego esté en producción en Play, `playLive: true` en `src/crosspromo.ts`.
- Enlaces en redes siempre con `utm_*` (ver `docs/datos.md` del estudio).

## 6. Estado (3 oct 2026, 1.0.0)

| Sitio | Estado | Falta |
|---|---|---|
| Repositorio | Commits locales; `Nocodeboy/wild-putt` **no existe todavía** | Que Germán lo cree (privado, vacío) y hago el push |
| Web | Build lista (`dist/web`) | OK de Germán para crear el proyecto en Vercel y desplegar |
| CrazyGames | Zip, portadas y vídeos listos | OK para subirlo y aceptar los términos del portal |
| Google Play | Proyecto de Android listo, APK de debug compilado, gráficos de la ficha hechos | AdMob, clave de subida, crear la app en Play Console y OK para enviar a revisión |
| Analítica | Fila `wildputt` creada en Supabase | — |
