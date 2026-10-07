# Dificultad medida con el bot

Versión 1.1.0 (7 oct 2026): 120 hoyos en 12 recorridos, ya con paredes curvas y los clásicos del minigolf (molinos, rizos, colinas y hoyos-volcán, tubos, puentes y saltos sobre el agua). Todo sale de `tools/route-table.ts` (el diseño y el par de cada hoyo). Si se toca la simulación, el bot, el generador o la ruta, se vuelve a medir y se compara con esta tabla. **Después hay que ejecutar `npm run daily-table`** y `npx tsx tools/physcheck.ts` (avisa si alguna bola se queda dentro de una pared).

## Los bots

El bot (`src/sim/bot.ts`) simula cientos de putts por golpe desde el instante exacto en que golpea (tiene en cuenta aspas, molinos, bloques, la marea, los rastrillos y el barco) y elige el que deja la bola más cerca del hoyo por el campo de distancias andando (`sim.pathField()`, que entiende túneles y saltos de rampa). Penaliza quedarse parado en una casilla que se inunda o se cierra.

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

Pares: **2:27, 3:66, 4:20, 5:7** (en la 1.0.0: 2:25, 3:62, 4:30, 5:3). Ningún hoyo fuera de los criterios. Diseño elegido: el primero en 51 hoyos generados, otro en 45.

| Hoyos | Par medio | Casual | PRO | Casual en par o mejor | Casual recoge | Par máximo |
|---|---|---|---|---|---|---|
| 1–10 | 2,3 | 2,09 | 1,10 | 81 % | 2 % | 3 |
| 11–20 | 2,6 | 2,38 | 1,10 | 81 % | 4 % | 4 |
| 21–30 | 2,7 | 2,40 | 1,45 | 79 % | 2 % | 4 |
| 31–40 | 2,5 | 2,40 | 1,20 | 75 % | 2 % | 4 |
| 41–50 | 3,3 | 3,08 | 1,40 | 76 % | 4 % | 5 |
| 51–60 | 2,9 | 2,75 | 1,70 | 75 % | 4 % | 4 |
| 61–70 | 3,2 | 3,00 | 1,40 | 79 % | 4 % | 4 |
| 71–80 | 3,3 | 2,86 | 1,40 | 85 % | 2 % | 5 |
| 81–90 | 3,4 | 3,06 | 1,55 | 81 % | 2 % | 5 |
| 91–100 | 3,6 | 3,29 | 1,65 | 80 % | 4 % | 4 |
| 101–110 | 3,5 | 3,19 | 1,40 | 72 % | 4 % | 5 |
| 111–120 | 3,4 | 3,08 | 1,45 | 78 % | 1 % | 5 |

Clásicos en los 96 hoyos generados (67 llevan al menos uno): 12 molinos (más el del hoyo 6, hecho a mano), 15 rizos, 39 con colinas (18 con el hoyo en lo alto, el «volcán»), 16 con tubos, 5 saltos sobre el agua, 2 puentes y las rampas del cañón.

«Casual en par o mejor» es la parte de partidas que gana el trofeo si es un hoyo de copa (2 estrellas o más).

### Hoyos de copa

| Hoyo | Recorrido | Par | Casual |
|---|---|---|---|
| 10 | Jardín | 3 | 2,63 |
| 20 | Tejados | 3 | 2,88 |
| 30 | Barco pirata | 4 | 3,38 |
| 40 | Feria | 4 | 3,38 |
| 50 | Glaciar | 4 | 4,00 |
| 60 | Volcán | 3 | 3,25 |
| 70 | Playa | 4 | 3,50 |
| 80 | Templo del sol | 3 | 3,00 |
| 90 | Castillo | 3 | 3,25 |
| 100 | Ciudad de neón | 3 | 3,13 |
| 110 | Cañón | 5 | 4,50 |
| 120 | Base lunar | 5 | 4,38 |

Las copas del Volcán (60), el Castillo (90) y la Ciudad de neón (100) son las más duras para el casual: queda por encima del par, así que ganar el trofeo pide jugar mejor que él o usar el mulligan.

## Lectura

- La subida es suave: el par medio pasa de 2,3 a 3,4–3,6 y el casual siempre queda algo por debajo del par, que es lo buscado (una persona nueva juega peor que el bot). Con las curvas hay menos pares de 4 y más de 2 y 3: los rebotes en curva llevan la bola más a menudo hacia el hoyo.
- La primera decena es casi un regalo (81 % en par o mejor, 2 % recoge): es la que ve el revisor de CrazyGames.
- El hoyo 1 se cambió después de la medida por uno con embudo (pendientes alrededor del hoyo): es más fácil que lo medido, con par 2.
- Lo que falta: medir con personas (la línea de tiro mejorada y el mulligan ayudan; la cámara puede perjudicar) y comparar con la analítica de `level_complete` (`strokes` frente a `par` por hoyo).
