# Diseño v2: la gira mundial de Wild Putt

Decidido el 3 oct 2026. Germán dio por buena la 0.2.0 («Este sí que pasa el corte») y pidió la versión de producción «siguiendo el patrón de la casa», es decir, lo que se hizo con *Round ’Em Up!*, *Tray Runner* y *Put It Out!* para pasar de la 0.x a la 1.0 ([diseño v2 de Round ’Em Up!](https://github.com/Nocodeboy/pastorealo/blob/main/docs/diseno-v2.md)). Sustituye a los 6 recorridos fijos de 3 hoyos de la 0.2.0.

Germán no entró en el detalle, así que las decisiones las tomó Claude siguiendo el patrón; están en el registro (§4) y se cambian aquí si alguna no vale.

## 1. De dónde sale

La 0.2.0 tiene 18 hoyos hechos a mano en 6 recorridos y un reto diario. Se juega en un cuarto de hora y no tiene nada que haga volver salvo el reto. Para producción hacen falta volumen, una meta a medio plazo, en qué gastar lo que se gana y los anuncios y las compras del estudio.

## 2. Qué se va a hacer (resumen)

- **Una gira por 12 recorridos**, cada uno con su **mecánica estrella**, su escenario y su luz. Los 6 de la 0.2.0 siguen; llegan 6 nuevos: la playa (marea), el templo del sol (túneles), el castillo (rastrillos), la ciudad de neón (aceleradores), el cañón (rampas de salto) y la base lunar (poca gravedad y pozos de gravedad).
- **120 hoyos en una ruta mezclada**: nunca dos seguidos en el mismo recorrido, y cada recorrido nuevo pronto. Cada hoyo sale de un **generador con validación**, salvo los 18 de la 0.2.0 y las 6 presentaciones nuevas, que están hechos a mano.
- **Par medido con el bot**: el par de cada hoyo sale de lo que hace el bot casual, no de una fórmula.
- **Estrellas por hoyo**: 3 bajo par, 2 en el par y 1 al terminarlo. Siempre se puede seguir: el hoyo siguiente se abre al terminar el anterior, aunque sea recogiendo la bola.
- **Torneo cada 10 hoyos**: un hoyo más largo con todas las mecánicas del recorrido. Si lo acabas en el par o mejor, ganas su **trofeo**. Los trofeos van a una **vitrina** y se comparten como imagen.
- **Monedas en el green**: algunos hoyos tienen monedas fuera de la línea fácil. Pasar por encima las recoge: arriesgar un golpe por ellas es decisión del jugador.
- **Monedas, tienda y mejoras**: bolas y estelas (cosméticas) y la mejora de la **línea de tiro**, que nunca cuenta en el reto diario.
- **«Mulligan»**: repetir el último golpe, con un anuncio o con 100 monedas, una vez por hoyo y nunca en el diario. Es el «+20 s» de *Round ’Em Up!*.
- **Anuncios como en *Put It Out!***: x2 monedas al acabar el hoyo, monedas gratis en la tienda, el mulligan y un intersticial solo al pulsar «Siguiente», con sus límites. En CrazyGames, apagados detrás de `CG_ADS` hasta el Full Launch.
- **Compras del estudio** (sin anuncios, pack de inicio y 3 packs de monedas), solo donde hay tienda (Android).
- **«More games»** en la web y en Android, nunca en CrazyGames.
- **Seis idiomas**: inglés (por defecto), español, portugués, francés, alemán e italiano, como *Round ’Em Up!* 1.0.
- **El primer medio minuto**, con lo aprendido de los rechazos de CrazyGames del 2 oct: el hoyo 1 es corto, recto y guiado (flecha y anillo), se emboca en segundos y entre el hoyo 1 y el 2 no hay pantallas de más.

## 3. Supuestos

Marcados como supuestos porque no se hablaron uno a uno. Si alguno no vale, se cambia aquí.

| Tema | Supuesto |
|---|---|
| Público | El de primer nivel de los otros juegos del estudio, con EE. UU. primero: inglés por defecto |
| Clasificación | **13+** con ficha de habilidad, como *Round ’Em Up!*. El minigolf no tiene nada que suba la edad, pero el low-poly de colores roza las apps infantiles: textos y capturas de habilidad, nada de «kids» |
| Rendimiento | 60 fps en un móvil de gama media. Los hoyos no pasan de 15 × 26 casillas y lo que se mueve se cuenta con los dedos |
| Escala | Todo en el dispositivo: guardado local (y en la nube de CrazyGames). El servidor solo se usa para la analítica y el ranking del reto diario |
| Fiabilidad | La simulación sigue siendo determinista: lo necesitan el reto diario, el bot y la tabla de pares |
| Mantenimiento | Sin editor de hoyos: el contenido sale del generador y lo comprueban el bot y las capturas |
| Partidas guardadas | La 0.x solo la ha jugado Germán: se empieza de cero con la clave `wildputt.v2` |
| Anuncios y compras | Nada que empuje a pagar para ganar: las monedas (ganadas o compradas en Android) compran bolas, estelas y la línea de tiro, que nunca está en el reto diario |

## 4. Registro de decisiones

| # | Decisión | Alternativas | Por qué |
|---|---|---|---|
| 1 | **12 recorridos**: los 6 de la 0.2.0 y 6 nuevos | Más hoyos en los 6 que hay | Es el patrón de la casa (12 regiones, 12 ciudades, 12 escenarios). Doce escenarios dan doce vídeos de publicidad y doce capturas distintas |
| 2 | **Una mecánica estrella por recorrido**, nueva de verdad (marea, túneles, rastrillos, aceleradores, rampas, gravedad) | Solo cambiar el decorado | Cada recorrido se recuerda por algo y enseña una sola cosa nueva. Funcionó en *Tray Runner* y *Round ’Em Up!* |
| 3 | Nada de animales grandes en los recorridos nuevos | Una selva con animales | Lo aprendido con *Dino Wrangler*: el motor luce con objetos y escenarios, no con animales orgánicos grandes |
| 4 | **Ruta mezclada de 120 hoyos**, recorrido nuevo en los hoyos 1, 2, 5, 9, 14, 21, 27, 35, 44, 55, 67 y 81 | Recorridos en bloques de 9 | Jugar 9 hoyos seguidos en el mismo sitio aburre (lección de *Tray Runner*). La novedad temprana engancha |
| 5 | **Generador por plantillas** (recta, codo, ese, U, isla y bifurcación con atajo) con validación y bot | Dibujar 120 hoyos a mano | A mano no es viable con calidad. Las plantillas dan formas de minigolf de verdad; el bot descarta las injugables |
| 6 | **Par medido con el bot casual** (§5.4) | Par por longitud | Dos hoyos igual de largos pueden costar el doble. Medirlo es lo único fiable |
| 7 | **Estrellas por hoyo** (3 bajo par, 2 en el par, 1 al acabar) y el siguiente hoyo siempre se abre | Hoyo perdido al recoger la bola | En minigolf nadie «pierde» un hoyo: se suma. Bloquear el avance por un mal hoyo frustra; las estrellas ya dan motivo para repetir |
| 8 | Máximo de golpes: **par + 3** | Par + 4 | Con 120 hoyos, recoger antes la bola acorta los malos ratos |
| 9 | **Torneo cada 10 hoyos**, con trofeo si se acaba en el par o mejor | Torneo de varios hoyos | Un hoyo grande se entiende y no alarga la sesión; pedir el par da motivo para repetirlo |
| 10 | **Monedas en el green** en lugar de power-ups | Power-ups como en *Round ’Em Up!* | El minigolf va por turnos: un power-up en el suelo no pega. Las monedas fuera de la línea fácil son riesgo y recompensa, el corazón del minigolf |
| 11 | Tienda de **bolas y estelas** (cosméticas) y **línea de tiro** (4 niveles) | Mejoras de potencia o efecto | Las mejoras de golpe romperían el par medido. La línea de tiro ayuda a apuntar sin cambiar la física, y lo cosmético es lo que mejor se vende en minigolf |
| 12 | **Mulligan**: repetir el último golpe con anuncio o 100 monedas, una vez por hoyo, nunca en el diario | Un +1 golpe extra | Es lo natural en golf, cumple la regla de CrazyGames de dar alternativa sin anuncio y es un destino más para las monedas |
| 13 | Monetización copiada de *Round ’Em Up!* (`src/monetize/`), con las mismas reglas y pruebas | Intersticial en cada hoyo | El intersticial agresivo hunde la retención. Mismo código, mismas reglas, mismas pruebas |
| 14 | El reto diario sigue siendo de **6 hoyos** sacados de la ruta, sin línea de tiro mejorada ni mulligan | Un solo hoyo, como *Round ’Em Up!* | Seis hoyos dan una tarjeta para compartir con un cuadro por hoyo, que es lo que hace viral el minigolf diario (*PUTTLE*) |
| 15 | **Seis idiomas** desde la 1.0 | Solo inglés y español | Es lo que lleva *Round ’Em Up!* 1.0. Los nombres de los hoyos generados se componen («Hoyo 37 · Templo del sol») para no traducir 102 nombres |
| 16 | Guardado nuevo `wildputt.v2` sin migración | Migrar la 0.x | Solo hay una partida de la 0.x: la de Germán |
| 17 | 4 entregas, cada una completa (compila, pasa el bot y se confirma) | Todo de una vez | Si algo no sale, lo hecho ya está entero |

## 5. Diseño

### 5.1 Los 12 recorridos

| # | Recorrido | Mecánica estrella | Escenario | Se estrena | Trofeo |
|---|---|---|---|---|---|
| 1 | The Garden · El jardín | Rebotar en las paredes; arena que frena | Jardín con valla de madera y árboles | 1 | Garden Cup |
| 2 | The Rooftops · Los tejados | Sin pretil la bola cae a la calle; tejas en pendiente | Tejados de una ciudad, calle abajo | 2 | Chimney Cup |
| 3 | The Pirate Ship · El barco pirata | La cubierta se inclina con el oleaje | Barco en mar abierto | 5 | Anchor Cup |
| 4 | The Night Fair · La feria | Molinos que giran y setas que rebotan | Feria de noche con bombillas y noria | 9 | Carousel Cup |
| 5 | The Glacier · El glaciar | Hielo que no frena; bloques que se deslizan | Glaciar con abetos nevados | 14 | Snowflake Cup |
| 6 | The Volcano · El volcán | La lava avanza con cada golpe | Volcán con ríos de lava | 21 | Magma Cup |
| 7 | The Beach · La playa | **Marea**: la arena mojada se cubre de agua y se descubre cada pocos segundos | Playa tropical con palmeras y chiringuito | 27 | Seashell Cup |
| 8 | The Sun Temple · El templo del sol | **Túneles**: la bola entra por uno y sale por su pareja con la misma velocidad | Templo de piedra en el desierto, columnas y dunas | 35 | Scarab Cup |
| 9 | The Castle · El castillo | **Rastrillos** que suben y bajan; puente levadizo sobre el foso | Patio de castillo, almenas y foso | 44 | Crown Cup |
| 10 | Neon City · La ciudad de neón | **Aceleradores** que lanzan la bola en su dirección | Azotea de noche con neones y rascacielos | 55 | Neon Cup |
| 11 | The Canyon · El cañón | **Rampas de salto** sobre el vacío: con fuerza pasas, sin ella caes | Cañón rojo del oeste, mesetas y cactus | 67 | Canyon Cup |
| 12 | Moon Base · La base lunar | **Poca gravedad** (la bola apenas frena) y **pozos de gravedad** que la atraen | Base lunar, la Tierra en el cielo | 81 | World Tour Trophy |

#### Mecánicas nuevas, en la simulación

Todas son funciones del reloj del hoyo, así que el bot las juega igual que el jugador.

| Mecánica | Cómo funciona |
|---|---|
| Marea (`~` con marea, letra `w`) | Casillas de arena mojada que pasan a agua con un ciclo propio del hoyo (de 7 a 10 s; 45 % del tiempo cubiertas). Cubiertas son agua (+1); descubiertas, arena. Avisa con un brillo antes de subir |
| Túneles (`P`) | En orden de lectura, cada dos `P` forman una pareja. La bola que entra por uno sale por el otro con la misma velocidad y dirección. No vuelve a entrar hasta que sale de la casilla |
| Rastrillos (`G`) | Casillas que son pared cuando el rastrillo baja y green cuando sube, con un ciclo del hoyo (de 4 a 6 s, la mitad del tiempo cerrados). Un rastrillo no baja encima de la bola: espera a que se aparte |
| Puente levadizo (`=`) | Casillas de foso que son green con el puente bajado y agua con el puente subido. Ciclo largo (8 s) |
| Aceleradores (`8` `2` `4` `6`, como el teclado numérico) | Al pasar, la velocidad en esa dirección sube al menos a 9 casillas/s |
| Rampas (`J`) | Una rampa mira hacia el vacío que tiene al lado. La bola que la cruza hacia el vacío a más de 3,2 casillas/s vuela una distancia que depende de su velocidad (sin rozamiento ni caídas mientras vuela) y aterriza; si aterriza en el vacío, cae (+1) |
| Poca gravedad (luna) | Rozamiento un 55 % más bajo en todo el hoyo y la bola sube algo más en los saltos |
| Pozos de gravedad (`M`) | Atraen la bola con una fuerza que crece al acercarse (radio 2,6). En el centro hay un agujero negro pequeño: si la bola cae dentro, +1 |

### 5.2 La ruta

- **120 hoyos** (`L1` a `L120`).
- **Recorrido nuevo** en los hoyos 1, 2, 5, 9, 14, 21, 27, 35, 44, 55, 67 y 81, con un **hoyo de presentación** hecho a mano: tranquilo y con la explicación de su mecánica en la tarjeta.
- **Nunca dos hoyos seguidos en el mismo recorrido.** En los huecos libres, el recorrido se sortea con semilla fija: pesan más el recién llegado y el menos visitado.
- **Los 18 hoyos de la 0.2.0** salen en las visitas 1 a 3 de su recorrido. El resto los hace el generador.
- **Torneo cada 10 hoyos** (10, 20… 120): el número k es el del recorrido k. Hoyo grande (tres tramos), monedas dobles y trofeo la primera vez que se acaba en el par o mejor.
- **Dificultad en diente de sierra**: sube rápido al principio y despacio al final, y baja en cada presentación, justo después de cada torneo y en las primeras visitas a un recorrido.
- **Pantalla de la ruta**: un camino vertical de nodos del color de su recorrido, con sus estrellas, sellos de pasaporte donde se estrena un recorrido y nodos grandes en los torneos.

### 5.3 Hoyos con generador

`src/sim/gen.ts` hace el plano de un hoyo a partir de una semilla, el recorrido y la dificultad:

1. **Plantilla**: recta, codo, ese, U, isla (el hoyo en una isla con dos entradas) o bifurcación (camino largo seguro y atajo arriesgado). Las difíciles salen más en los hoyos avanzados.
2. **Calle**: los tramos de la plantilla se excavan con un ancho de 3 a 5 casillas según la dificultad. Alrededor, pared o (en los tejados, el cañón y la luna) vacío sin pretil en algunos tramos.
3. **Obstáculos generales**: bloques de pared en los tramos anchos, setas, trampas de arena junto al hoyo, pendientes en un tramo.
4. **La mecánica del recorrido**, colocada donde tiene sentido: el charco y el hielo en el glaciar, los molinos en los tramos anchos de la feria, la marea cruzando la calle, la pareja de túneles entre el principio y un sitio cerca del hoyo, los rastrillos cerrando un tramo, los aceleradores a lo largo de la calle, el corte de vacío con su rampa delante y los pozos al lado de la línea recta.
5. **Monedas**: de 0 a 3, fuera de la línea fácil y siempre alcanzables.

**Validación**: del tee al hoyo se tiene que poder ir andando (contando los túneles y las rampas), el tee y el hoyo están lejos de cualquier peligro, ninguna casilla abierta queda encerrada y el hoyo no está en una pendiente. Después, `tools/route-table.ts` hace que el bot juegue cada hoyo con varias semillas y elige la primera que cumple (§5.4).

### 5.4 Par medido con el bot

Para cada hoyo, el bot casual lo juega 8 veces y el PRO 2.

- **Par** = la media del casual redondeada hacia arriba desde ,35 (2,35 → 3), entre 2 y 5, y nunca menos que lo del PRO más uno.
- Se **descarta** el plano si el casual recoge la bola (par + 3) en más de 1 de 8 partidas, si su media pasa de 4,6 o si el PRO no lo hace en 2 o menos (en los torneos, 3 o menos).
- Se descarta también si es demasiado fácil para su sitio en la ruta: en la segunda mitad, una media del casual por debajo de 1,7.

La tabla (`src/sim/routeTable.ts`) guarda la semilla elegida y el par de cada hoyo. Se regenera con `npm run route-table` cada vez que cambia la simulación o el generador.

### 5.5 Estrellas, monedas y trofeos

- **Estrellas**: ★★★ bajo par, ★★ en el par, ★ al acabar. Recoger la bola no da estrellas, pero deja seguir.
- **Monedas por hoyo**: 10 + 10 por estrella, +50 por hoyo en uno y las monedas recogidas en el green (5 cada una). En el torneo, el doble.
- **Reto diario**: el primer resultado del día da 100 + 10 por estrella (hasta 280), como mucho 3 veces en 24 horas.
- **Trofeos**: el primer torneo de cada recorrido acabado en el par o mejor da su trofeo, con los colores del recorrido, los golpes y la fecha. Se guardan en la **vitrina** (desde la pantalla de inicio y desde la ruta), con un hueco por recorrido, y se comparten como imagen de 1080 × 1080.

### 5.6 Tienda

Un solo monedero.

**Línea de tiro** (no cuenta en el reto diario):

| Nivel | Qué muestra | Precio |
|---|---|---|
| 0 | Hasta el primer rebote | — |
| 1 | Un 35 % más larga | 300 |
| 2 | Un 70 % más larga | 900 |
| 3 | Sigue después del primer rebote hasta el segundo | 2.000 |

**Bolas** (cosméticas, cada una con su estela): Classic (gratis), Tangerine, Mint, Grape y Striped (200), Tennis y Soccer (450), Pool 8 y Watermelon (700), Disco y Planet (1.200) y Comet (2.500, con estela de fuego).

**Monedas gratis**: 150 por anuncio, 3 al día.

### 5.7 Anuncios

El código es el de *Put It Out!* y *Round ’Em Up!*, en `src/monetize/`.

| Dónde | Qué | Límites |
|---|---|---|
| Fin de hoyo | Recompensado opcional: **x2 monedas** | Una vez por hoyo |
| Tienda | Recompensado opcional: **150 monedas gratis** | 3 al día y 3 en 24 horas |
| Después de un golpe | **Mulligan**: repetir el golpe, con anuncio o con 100 monedas | Una vez por hoyo (con anuncio o con monedas); nunca en el diario ni en el primer hoyo |
| «Siguiente» en el fin de hoyo | Intersticial, antes de la tarjeta del siguiente hoyo (nunca antes de jugar) | Nunca en la primera sesión; al menos 3 hoyos en total y 2 desde el último; 120 s desde cualquier anuncio a pantalla completa; nunca justo después de un recompensado |

Los botones de anuncio siempre dicen «Anuncio». Si un anuncio falla, el juego sigue sin premio y el botón vuelve a funcionar. Mientras dura, el juego se pausa y se silencia.

**Proveedores**: en local, `?fakeads=1` (todos dan premio en 1 s) o `?fakeads=fail`, y `?fakeiap=1` para una tienda de pruebas. En CrazyGames, el SDK del portal solo si se compila con `CG_ADS=1`. En la web propia, sin anuncios ni compras. En Android, AdMob (con consentimiento UMP) y Google Play Billing.

### 5.8 Compras

Catálogo del estudio (`src/monetize/types.ts`), solo donde hay tienda:

| Producto | Qué da | Precio sugerido |
|---|---|---|
| Sin anuncios | Quita los intersticiales (los recompensados siguen, opcionales) y 500 monedas | 2,99 $ |
| Pack de inicio | 3.000 monedas, una vez | 1,99 $ |
| Bolsa, saco y cofre de monedas | 1.000, 6.000 y 14.000 monedas | 0,99, 4,99 y 9,99 $ |

Cada compra se entrega una sola vez (se guarda su token antes de confirmarla a la tienda). Las no consumibles se restauran y sobreviven a «Borrar progreso».

### 5.9 Reto diario

Seis hoyos de la ruta (del 3 en adelante, sin presentaciones ni torneos), de seis recorridos distintos, los mismos para todos, con un modificador: clásico, greens helados, hierba alta, viento, espejo u hoyos pequeños. Sin línea de tiro mejorada ni mulligan, y lo dice su tarjeta. Las semillas comprobadas por el bot están en `src/sim/dailyTable.ts` (`npm run daily-table`).

### 5.10 El primer medio minuto

Lo que miran los revisores de CrazyGames (rechazos del 2 oct a *Tray Runner* y *Round ’Em Up!*):

- Un clic hasta jugar: «Play» lleva directo al hoyo 1, sin elegir recorrido.
- El hoyo 1 es recto y corto: un tiro con un 40-80 % de fuerza entra.
- Mientras no has golpeado, una flecha animada y un anillo en la bola dicen qué hacer (con el ratón y con el dedo).
- Después del hoyo 1, «Siguiente» lleva directo al hoyo 2; la ruta se ve la primera vez desde el hoyo 3.

### 5.11 Analítica

Según el esquema común del estudio:

- `first_open` y `session_start` llevan el idioma y la zona horaria del dispositivo (`localeProps()`) y la fuente (`utm_*`).
- `level_start`, `level_complete` y `level_quit` llevan `level` (`L1`…), `num`, `course`, `champ`, `intro` y `par`; los de fin, además, golpes, estrellas, monedas recogidas, si se recogió la bola y si se usó el mulligan.
- Nuevos: `trophy`, `shop_open`, `upgrade` (línea de tiro), `ball` (bola comprada), `coins_earn`, `coins_spend`, `mulligan`, los de anuncios (`ad_offer`, `ad_show`, `ad_reward`, `ad_fail` con su sitio: `double_coins`, `free_coins`, `mulligan`, `between_levels`) y `share` con `what: 'trophy'`.

### 5.12 Idiomas y nombre

Textos en inglés (por defecto), español, portugués, francés, alemán e italiano, con el sistema de *Round ’Em Up!* (`src/locales/*.json` para los cuatro últimos). En español se llama **¡Embócala!**; en el resto, **Wild Putt**. En las tiendas va con subtítulo: **Wild Putt: Mini Golf Tour** (25 de los 30 caracteres de Google Play).

Comprobación del 3 oct 2026: no hay ningún juego llamado *Wild Putt* en Google Play, App Store ni CrazyGames. Los competidores llevan *mini golf* en el título, así que va en el subtítulo.

### 5.13 Más juegos

En la pantalla de inicio de la web y de Android, «More games» abre la lista de los otros juegos del estudio (`src/crosspromo.ts`): *Put It Out!*, *Tray Runner* y *Round ’Em Up!*, con `utm_source=wildputt`. En CrazyGames no aparece.

### 5.14 El aspecto de cada recorrido

Que cualquiera distinga los 12 recorridos de un vistazo en una captura vertical, sin leer nada. Se comprueba con la hoja de contactos de `tools/shots.py`.

| Recorrido | El green y el suelo | Barandillas | Fuera |
|---|---|---|---|
| Playa | Green con arena mojada a franjas | Troncos claros | Arena, palmeras, mar turquesa y una sombrilla |
| Templo del sol | Losas de piedra arenisca con jeroglíficos | Bloques de arenisca | Dunas, columnas y un obelisco |
| Castillo | Césped del patio con losas | Almenas de piedra gris | Murallas, torres con banderas y el foso |
| Ciudad de neón | Moqueta oscura con líneas de neón | Tubos de neón | Rascacielos con ventanas encendidas, noche |
| Cañón | Tierra roja apisonada | Tablones del oeste | Mesetas rojas, cactus y el fondo del cañón |
| Base lunar | Placas metálicas gris claro | Raíles metálicos con luces | Polvo gris, cráteres, la Tierra y estrellas |

## 6. Plan de entregas

Cada entrega compila, pasa el bot y se confirma.

1. **La ruta con los 6 recorridos de la 0.2.0 (60 hoyos)**: ruta, generador, tabla de pares, estrellas por hoyo, pantalla de la ruta, reto diario sobre la ruta y el primer medio minuto.
2. **Los 6 recorridos nuevos (120 hoyos)**: mecánicas, escenarios, presentaciones y torneos, con la tabla de pares completa.
3. **Economía y monetización**: monedas en el green, tienda, mulligan, anuncios, compras, torneos con trofeo y vitrina, «More games».
4. **Producción (1.0.0)**: seis idiomas, app de Android, fichas, capturas, vídeos, portadas, privacidad, analítica y documentación.

## 7. Riesgos asumidos

| Riesgo | Cómo se controla |
|---|---|
| Hoyos generados sosos o injustos | Plantillas con forma de minigolf de verdad, validación, par medido con el bot y hoja de contactos con todos |
| El bot no es una persona | El par sale de un bot casual que falla unos 4° y un 15 % de fuerza. Se ajustará con las primeras partidas reales (`level_complete` con golpes y par) |
| Demasiadas mecánicas nuevas | Cada una se estrena en un hoyo de presentación tranquilo y su recorrido solo enseña esa |
| El juego parece infantil en Google Play | Textos y capturas de habilidad; público 13+ |
| Rendimiento en móvil | Mismo motor que la 0.2.0, sin nada pesado nuevo; calidad gráfica automática |
| Anuncios que molesten | Las reglas y las pruebas (`tools/test_monetize.py`) de *Put It Out!* |
