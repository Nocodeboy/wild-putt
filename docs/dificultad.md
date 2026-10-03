# Dificultad medida con el bot

Versión 1.0.0 (3 oct 2026): 120 hoyos en 12 recorridos. Todo sale de `tools/route-table.ts` (el diseño y el par de cada hoyo). Si se toca la simulación, el bot, el generador o la ruta, se vuelve a medir y se compara con esta tabla. **Después hay que ejecutar `npm run daily-table`.**

## Los bots

El bot (`src/sim/bot.ts`) simula cientos de putts por golpe desde el instante exacto en que golpea (tiene en cuenta aspas, bloques, la marea, los rastrillos y el barco) y elige el que deja la bola más cerca del hoyo por el campo de distancias andando (`sim.pathField()`, que entiende túneles y saltos de rampa). Penaliza quedarse parado en una casilla que se inunda o se cierra.

| Bot | Qué hace | Qué representa |
|---|---|---|
| **PRO** | El mejor golpe, sin error | Alguien que domina el juego |
| **Casual** | El mismo golpe con un error de unos 4° de dirección y un 15 % de fuerza | Quien empieza. Ve el mejor golpe, así que una persona nueva jugará algo peor |

## Cómo se elige cada hoyo y su par

`npx tsx tools/route-table.ts --jobs=2`. Para cada hoyo generado prueba diseños (`salt`) hasta que uno pasa:

1. **Se rechaza** si el casual se queda sin golpes (recoge la bola, par + 3) más de una vez en 8 partidas, si su media pasa de 4,6, si el PRO necesita más de 2 golpes (3 en los hoyos de copa) o si es **demasiado fácil**: a partir del hoyo 8, la media del casual tiene que llegar a 1,5 + 1,1·d (+0,4 en los hoyos de copa), con d la dificultad de la ruta.
2. **El par** es la media del casual + 0,65 redondeado hacia abajo, entre 2 y 5, y siempre al menos el peor resultado del PRO + 1.

Los hoyos hechos a mano (la presentación de cada recorrido y alguna visita siguiente) solo se miden.

La dificultad `d` va en diente de sierra: sube con la ruta (curva cóncava), baja 0,14 en la presentación de un recorrido, baja 0,06 en el hoyo que sigue a una copa y sube 0,06 en los de copa.

## Resultados (8 partidas casual y 2 PRO por hoyo)

Pares: **2:25, 3:62, 4:30, 5:3**. Ningún hoyo fuera de los criterios. Diseño elegido: el primero en 81 hoyos, otro en 39.

| Hoyos | Par medio | Casual | PRO | Casual en par o mejor | Casual recoge | Par máximo |
|---|---|---|---|---|---|---|
| 1–10 | 2,3 | 2,10 | 1,10 | 81 % | 1 % | 3 |
| 11–20 | 2,9 | 2,79 | 1,30 | 79 % | 6 % | 4 |
| 21–30 | 2,9 | 2,80 | 1,40 | 71 % | 8 % | 4 |
| 31–40 | 2,9 | 2,71 | 1,60 | 78 % | 1 % | 4 |
| 41–50 | 2,7 | 2,41 | 1,50 | 81 % | 0 % | 3 |
| 51–60 | 3,0 | 2,64 | 1,60 | 88 % | 1 % | 4 |
| 61–70 | 2,8 | 2,69 | 1,45 | 76 % | 2 % | 4 |
| 71–80 | 3,5 | 3,41 | 1,70 | 74 % | 6 % | 5 |
| 81–90 | 3,5 | 3,13 | 1,45 | 81 % | 6 % | 5 |
| 91–100 | 3,4 | 3,08 | 1,55 | 81 % | 1 % | 4 |
| 101–110 | 3,7 | 3,35 | 1,70 | 78 % | 4 % | 4 |
| 111–120 | 3,5 | 3,38 | 1,35 | 76 % | 6 % | 4 |

«Casual en par o mejor» es la parte de partidas que gana el trofeo si es un hoyo de copa (2 estrellas o más).

### Hoyos de copa

| Hoyo | Recorrido | Par | Casual |
|---|---|---|---|
| 10 | Jardín | 3 | 2,63 |
| 20 | Tejados | 4 | 4,25 |
| 30 | Barco pirata | 4 | 3,63 |
| 40 | Feria | 3 | 3,25 |
| 50 | Glaciar | 3 | 2,75 |
| 60 | Volcán | 4 | 3,50 |
| 70 | Playa | 3 | 3,13 |
| 80 | Templo del sol | 3 | 3,00 |
| 90 | Castillo | 4 | 3,63 |
| 100 | Ciudad de neón | 3 | 3,13 |
| 110 | Cañón | 4 | 4,13 |
| 120 | Base lunar | 4 | 3,63 |

Las copas del Tejados (20) y el Cañón (110) son las más duras: el casual queda por encima del par, así que ganar el trofeo pide jugar mejor que él o usar el mulligan.

## Lectura

- La subida es suave: el par medio pasa de 2,3 a 3,5–3,7 y el casual siempre queda algo por debajo del par, que es lo buscado (una persona nueva juega peor que el bot).
- La primera decena es casi un regalo (81 % en par o mejor, 1 % recoge): es la que ve el revisor de CrazyGames.
- El hoyo 1 se cambió después de la medida por uno con embudo (pendientes alrededor del hoyo): es más fácil que lo medido, con par 2.
- Lo que falta: medir con personas (la línea de tiro mejorada y el mulligan ayudan; la cámara puede perjudicar) y comparar con la analítica de `level_complete` (`strokes` frente a `par` por hoyo).
