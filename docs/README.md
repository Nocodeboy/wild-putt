# Documentación

| Documento | De qué va |
|---|---|
| [concepto.md](concepto.md) | Ficha de concepto: competencia (PUTTLE), diferencial y criterios para matar, iterar o seguir |
| [diseno-v2.md](diseno-v2.md) | Diseño de la 1.0 (la gira): 12 recorridos y sus mecánicas, ruta de 120 hoyos, generador, par, economía, tienda, anuncios, compras, diario, primer medio minuto, analítica, idiomas y nombre |
| [dificultad.md](dificultad.md) | Cómo se eligen los hoyos y su par con el bot, y la tabla de resultados |
| [publicar.md](publicar.md) | Textos y pasos para la web, CrazyGames y Google Play, y el estado de cada sitio |

Lo técnico (estructura, comandos, Android, controles, cómo se hace un hoyo) está en el [README principal](../README.md).

## Estado

**El estado actual (Google Play, CrazyGames, web y lo pendiente) está en [`nocodeboy-games/docs/versiones.md`](https://github.com/Nocodeboy/nocodeboy-games/blob/main/docs/versiones.md)**, la única fuente del estudio. Aquí queda la historia de cómo se hizo y las decisiones; los detalles de cada envío a las tiendas, en [publicar.md](publicar.md).

## 1.1.0: curvas y clásicos del minigolf (7 oct 2026)

Feedback de Germán con la 1.0.0 ya en Google Play: «está guay, pero que todos los escenarios sean tan cuadrados es raro en minigolf (no hay curvas); se echan en falta las típicas cosas de los campos de minigolf: rampas, túneles, molinos…».

- **Curvas en todo.** Los mapas siguen siendo ASCII, pero el juego los redondea (`src/sim/shape.ts`). Las esquinas llevan filetes: anchos por fuera de un giro, más cerrados por dentro y concéntricos cuando el giro tiene las dos esquinas, así que una curva de pasillo se ve como una curva de verdad. Las escaleras de casillas pasan a ser rampas rectas, los finales de pasillo son semicírculos y las paredes sueltas, postes redondos. No toca el hoyo, el tee, las monedas ni las piezas.
- **Física sobre las curvas.** La bola rebota en los segmentos y arcos de los contornos (normales exactas) y el suelo se mira en una rejilla fina de 1/8 de casilla, así que agua, arena, hielo y vacío coinciden con lo que se ve. Si un bloque móvil empuja la bola contra una pared, la pared manda y la bola sale por un lado.
- **Render nuevo.** Base extruida con el contorno, barandillas de sección redondeada a lo largo de las curvas, estanques, búnkeres y lava con forma de mancha, y el agujero del hoyo por fin hueco de verdad (antes se pintaba encima).
- **Los clásicos del minigolf en los 12 recorridos:**
  - **Molino:** casa con puerta y cuatro aspas que la tapan a ratos; aparece cruzando el pasillo o suelto en un green abierto.
  - **Rizo:** con fuerza da la vuelta y sigue; si no, vuelve rodando.
  - **Colinas**, y el hoyo en lo alto de un **volcán**.
  - **Tubos-túnel**, con un color por pareja.
  - **Puentes de madera con barandilla** sobre un arroyo.
  - **Saltos sobre el agua** con rampas.

  Cada recorrido tiene su reparto (tabla `CLASSIC` en `gen.ts`) y un hoyo lleva como mucho una pieza grande.
- **Trazados nuevos:** curva larga, ese, horquilla y green redondo. Los huecos sin nada que quedan encerrados entre paredes pasan a ser macizos.
- **El hoyo 6 (3.ª visita al jardín) es ahora «El molino»**, para que se vea pronto. Los molinetes de la feria (aspas horizontales) se renombran «El molinete» y «Doble molinete».
- **Pares medidos de nuevo:** 2:27, 3:66, 4:20, 5:7, ningún hoyo fuera de los criterios ([dificultad.md](dificultad.md)). El reto diario está regenerado.
- **Herramientas nuevas:** `tools/physcheck.ts`, `tools/shapes-svg.ts`, `tools/shots.py` y `tools/testshots.py` (con `tools/testholes/*.json`).
- **Tienda:** 6 capturas nuevas de Play (molino, rizo, cañón, volcán, neón y puente), gráfico, `og.png` y portadas de CrazyGames rehechos con el aspecto nuevo.

## Cómo se llegó a la 1.0.0

Germán aprobó la 0.2.0 («Este sí que pasa el corte») y pidió la versión de producción con el patrón de la casa. Envío a las tiendas, en [publicar.md](publicar.md) §4 y §6.

### 1.0.0: la gira
- **12 recorridos, 120 hoyos.** A los 6 del prototipo se suman playa (marea que inunda la arena), templo del sol (túneles), castillo (rastrillos y puente levadizo), ciudad de neón (aceleradores), cañón (rampas y saltos) y base lunar (gravedad baja y pozos de gravedad con agujero negro). Cada uno con su suelo, barandillas, entorno, ambiente y un hoyo de presentación hecho a mano que enseña la mecánica.
- **Ruta mezclada** con los recorridos abriéndose en los hoyos 1, 2, 5, 9, 14, 21, 27, 35, 44, 55, 67 y 81, dificultad en diente de sierra y un **hoyo de copa** cada 10 (en el par o mejor = trofeo del recorrido; el del 120 es el Trofeo de la Gira).
- **Generador** de hoyos por plantillas con las mecánicas de cada recorrido; el bot elige el diseño y mide el par de los 120 ([dificultad.md](dificultad.md)). Pares 2:25, 3:62, 4:30, 5:3.
- **Estrellas por hoyo:** 3 bajo par, 2 en el par, 1 acabado; se recoge la bola en par + 3.
- **Economía:** monedas por hoyo (más por estrellas, hoyo en uno y monedas del green; doble en los hoyos de copa), x2 con anuncio, monedas gratis (3 al día), tienda con 12 bolas con estela y la línea de tiro en 3 niveles (el último enseña el segundo rebote), **mulligan** (repetir el último golpe una vez por hoyo, por 100 monedas o un anuncio).
- **Anuncios y compras** con el módulo de *Put It Out!*: AdMob con UMP y Play Billing en Android (5 productos), anuncios de CrazyGames detrás de `CG_ADS`, intersticial solo en *Siguiente* con sus topes. La web va sin anuncios ni compras.
- **Trofeos** con vitrina e imagen para compartir; **More games** con los otros tres juegos.
- **Reto diario** de 6 hoyos de la gira, de recorridos distintos, con modificador y ranking.
- **Primer medio minuto** (lecciones de los rechazos de CrazyGames): *Play* lleva directo al hoyo 1, hoyo 1 con embudo, anillo y flecha de guía hasta el primer golpe.
- **6 idiomas** (inglés, español, portugués, francés, alemán e italiano).
- **Android** (Capacitor, `com.nocodeboy.wildputt`): compila en debug; la release espera los ids reales de AdMob y la clave de subida.
- **Tienda:** iconos, `og.png`, portadas de CrazyGames, gráficos y 6 capturas de Play, vídeos de vista previa y política de privacidad con AdMob y compras.
- **Analítica:** fila `wildputt` en la tabla `games` del Supabase del estudio (`level1 = 'L1'`, `result_prop = 'strokes'`).
- Pruebas: `tools/test_monetize.py`, `tools/test_cg_sdk.py` (con y sin `--ads`) y `tools/test_cg_data.py` pasan.

### Antes (prototipo)
- **0.2.0:** cámara de seguimiento con vuelo de presentación y vista general, tirachinas relativo a la cámara con barra de fuerza y zona de cancelar, barandillas finas, hoyo hundido, agua y lava animadas, putter animado, bandera y fundidos.
- **0.1.0:** física de la bola, hoyos vivos (barco que se inclina, lava que avanza), 6 recorridos de 3 hoyos, reto diario, bot, tarjeta de puntuación y compartir sin spoilers, música con IA y efectos sintetizados.
