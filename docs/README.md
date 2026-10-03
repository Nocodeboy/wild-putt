# Documentación

| Documento | De qué va |
|---|---|
| [concepto.md](concepto.md) | Ficha de concepto: competencia (PUTTLE), diferencial, recorridos y criterios para matar, iterar o seguir |

Lo técnico (estructura, comandos, controles, cómo se hace un hoyo) está en el [README principal](../README.md).

## Estado (3 oct 2026) · Fase 2: prototipo 0.2.0

### 0.2.0: gráficos, cámara, animaciones y control
- **Cámara de seguimiento** detrás de la bola, mirando hacia donde va el camino (no en línea recta al hoyo, porque usa el campo de distancias andando). Al empezar cada hoyo hay un vuelo de presentación desde la bandera hasta la bola; tocar la pantalla lo salta. Al embocar se acerca al hoyo. **Vista general** con el botón de cámara o la tecla C; se guarda en ajustes.
- **Control:** el tirachinas funciona respecto a la cámara (tirar hacia abajo = golpe hacia delante en pantalla). Tiene una barra de fuerza con porcentaje, una zona muerta que muestra ✕ y cancela si sueltas ahí, curva de fuerza más fina en golpes suaves y vibración cada 25 %. La cámara no gira mientras arrastras. Con teclado: flechas para apuntar y Espacio para cargar la fuerza.
- **Gráficos:** barandillas finas con postes y remates redondos (antes eran muros gruesos), hoyo real hundido con borde, agua hundida y animada, mar y lava con textura en movimiento, cielo con degradado, tone mapping neutro, sombras suaves, suelo pintado por recorrido (rayas de césped, tablones del barco, arena rastrillada, grietas del hielo, flechas en las pendientes) y oclusión junto a las barandillas.
- **Animaciones:** putter que se coloca detrás de la bola, retrocede según la fuerza y golpea; bola que se aplasta al chocar y cae al hoyo; bandera que ondea, sube y gira al embocar; puntos de la línea de tiro que avanzan; anillo de fuerza de verde a rojo; cartel con el nombre del hoyo y fundido entre hoyos.

### Base (0.1.0)

Hecho:
- **Física de la bola** (`src/sim/world.ts`): fricción según el suelo (green, arena, hielo), pendientes, rebotes en paredes con esquinas, setas que impulsan, aspas que giran y empujan, bloques que se deslizan, captura en el hoyo con «lip out» si llega rápida y +1 por agua, vacío o lava.
- **Hoyos vivos:** la cubierta del barco se inclina con el tiempo (la bola se va al lado que baja) y en el volcán la lava avanza con cada golpe, sin llegar nunca a tapar el hoyo.
- **6 recorridos × 3 hoyos** (jardín, tejados, barco pirata, feria, glaciar, volcán), cada uno con su regla, y **reto diario** de 6 hoyos (uno de cada recorrido) con un modificador: clásico, greens helados, hierba alta, viento, espejo u hoyos pequeños. Los 120 primeros retos están comprobados por el bot.
- **Bot** que simula cientos de putts por golpe desde el instante exacto en que golpea (tiene en cuenta lo que se mueve). Mide la dificultad, valida el diario y juega detrás del menú (repartiendo el cálculo entre fotogramas para no congelar el móvil).
- Tirachinas a un pulgar con línea de puntos hasta el primer rebote y color según la fuerza; teclado.
- Tarjeta de puntuación por hoyo (círculo bajo par, dorado si es hoyo en uno), «¡Birdie!», público que aplaude más cuanto mejor es el golpe, compartir sin spoilers con un cuadro por hoyo.
- Escenario de cada recorrido: jardín con valla, edificios alrededor del tejado (y la calle 9 m más abajo), mar con mástiles y velas, feria de noche con bombillas y noria, glaciar con abetos nevados, volcán con grietas de lava.
- Inglés por defecto y español. Música generada con IA en Magnific (Lyria 3 Pro): lounge-funk para jugar y bossa nova para el menú. Efectos y ambiente sintetizados por recorrido.
- Analítica en el Supabase del estudio con `game = 'wildputt'`: `level_start` / `level_complete` por hoyo (para el embudo), `course_complete`, `daily_*`, idioma y zona horaria.
- Iconos, `og.png` y portadas de CrazyGames generados desde el juego (`tools/assets.py`). Son mejorables: en las portadas el título tapa la bandera.

### Dificultad medida con el bot casual (6 partidas por hoyo, 3 oct 2026)

La 0.2.0 no toca la física: el bot da los mismos resultados. El bot casual falla unos 4° y un 15 % de fuerza. Una persona que juega por primera vez lo hará peor, así que una media algo por debajo del par es lo que buscamos.

| Recorrido | Hoyo 1 | Hoyo 2 | Hoyo 3 |
|---|---|---|---|
| Jardín | 1,67 (par 2) | 2,33 (par 3) | 2,33 (par 3) |
| Tejados | 1,83 (par 2) | 1,67 (par 3) | 2,33 (par 3) |
| Barco | 1,50 (par 2) | 2,17 (par 3) | 2,17 (par 3) |
| Feria | 2,00 (par 2) | 2,50 (par 3) | 3,67 (par 3) |
| Glaciar | 1,50 (par 2) | 2,83 (par 3) | 1,83 (par 3) |
| Volcán | 1,33 (par 2) | 3,33 (par 3) | 2,83 (par 3) |

Pendiente, en este orden:
1. **Jugarlo 5 minutos** (Germán) y decidir si se siente «otro minigolf más» o tiene chispa. Ojo con la cámara de seguimiento frente a la vista general, la fuerza del tirachinas y la sensación del barco.
2. Repo privado `Nocodeboy/wild-putt`, catálogo del estudio y fila en la tabla `games` del Supabase.
3. Web en Vercel (`wild-putt.vercel.app`, ya puesta en la build).
4. Más hoyos por recorrido (el objetivo es 9) si el test lo justifica; portadas, icono y `og.png` regenerados con el aspecto de la 0.2.0.
5. Prueba con 5 personas y CrazyGames Basic Launch con los criterios de `concepto.md`.
