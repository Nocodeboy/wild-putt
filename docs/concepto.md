# Wild Putt — ficha de concepto

> Fase 1 del estudio. Escrita el 3 oct 2026, **antes** de probar con jugadores. Los criterios de muerte no se cambian después de probar.

**Qué es:** minigolf casual en 3D low-poly con cámara cenital inclinada. Cada recorrido es un diorama con vida propia: un barco que se balancea, una feria con aspas que giran, un glaciar que resbala, un volcán cuya lava sube con cada golpe. Móvil y web.

**Nombre en inglés (el principal):** **Wild Putt**. No aparece ningún videojuego con ese nombre (solo campos de minigolf reales, como «Putters Wild» en Anchorage). **Nombre en español:** **¡Embócala!** («embocar» es meter la bola en el hoyo; sigue la familia ¡Apágalo!, ¡Pastoréalo!).
**Descartados:** «Sink It!» (genérico: ya es un juego de baloncesto de feria y un entrenador de putt) y «Putt Panic» (ya existe *Barry Bradford's Putt Panic Party*).

**Competidor directo: PUTTLE** (puttle.golf). Es un «Wordle de minigolf»: 5 hoyos diarios iguales para todos, islas flotantes en 3D, +1 si te caes, retos a amigos. El gancho del reto diario ya está ocupado, así que **no competimos por ser «el minigolf diario»**. Lo que nos diferencia:
- **Hoyos vivos** (el sistema vivo del estudio): el hoyo cambia mientras juegas o con cada golpe. En Puttle el hoyo está quieto.
- **Escenarios reconocibles** con su propia regla (tejados, barco pirata, feria, glaciar, volcán) en vez de islas genéricas.
- **Campaña** de recorridos con estrellas (y, más adelante, bolas y palos para coleccionar), no solo el diario. Es lo que sostiene sesiones largas y monetización.
- **Distribución:** CrazyGames y Google Play, donde Puttle no está.

## Fantasía del jugador
"Soy el que la mete a la primera mientras el barco se tambalea."

## Bucle de 30 segundos
1. Miras el hoyo entero: dónde está la bandera, qué se mueve, qué peligros hay.
2. Pones el dedo, tiras hacia atrás como un tirachinas (la línea te enseña el primer rebote) y sueltas.
3. La bola rueda, rebota, el barco se inclina o la lava avanza.
4. «¡Birdie!»: la bandera salta, sonido de público y al siguiente hoyo. Un hoyo dura de 15 a 45 s.

## Controles (un pulgar)
- **Móvil y ratón:** pon el dedo en cualquier sitio y arrastra hacia atrás. La dirección contraria es el tiro; la distancia, la fuerza. Suelta para golpear. Si vuelves al punto de partida, se cancela.
- **Teclado:** flechas para girar, mantén Espacio para cargar la fuerza y suelta para golpear.

## Recorridos (un concepto nuevo por recorrido, 3 hoyos cada uno)
| # | Recorrido | Paleta | Concepto que enseña |
|---|---|---|---|
| 1 | El jardín | Mañana de primavera | Apuntar, la fuerza y el rebote en las paredes |
| 2 | Los tejados | Atardecer en la ciudad | Huecos al vacío (+1) y tejados en pendiente |
| 3 | El barco pirata | Mar a mediodía | La cubierta se balancea: la pendiente cambia con el tiempo |
| 4 | La feria | Noche con bombillas | Aspas que giran y setas que rebotan |
| 5 | El glaciar | Hielo azul | Hielo que no frena y bloques que se deslizan |
| 6 | El volcán | Roca y brasas | La lava avanza con cada golpe: métela antes de que te alcance |
| ★ | Reto diario | Varía | 6 hoyos, igual para todos, con un modificador |

## Estrellas
Por recorrido: 1 estrella al terminarlo, 2 si acabas en el par o menos, 3 si acabas 2 o más golpes bajo par. Un hoyo tiene un máximo de par + 4 golpes.

## Gancho para compartir
- Resultado sin spoilers: `Wild Putt Daily #12 ⛳ 17 (−2)` y una fila con un cuadro por hoyo: ⭐ hoyo en uno, 🟩 bajo par, 🟨 par, 🟧 +1, 🟥 +2 o peor.
- Momentos de clip: el hoyo en uno rebotando en tres paredes, la bola que entra justo cuando el barco se inclina y la lava rozando la bola.

## Criterios de muerte (escritos antes de probar)
Test web de 7–14 días en CrazyGames Basic Launch (manda su panel) y en la web propia (Supabase para el embudo por hoyo):
- **Matar** si menos del 70 % sigue jugando al minuto 1, o si menos del 40 % termina el primer recorrido.
- **Matar** si el tiempo medio de sesión es inferior a 4 minutos.
- **Iterar** si el D1 web está entre el 6 y el 10 %. **Seguir** (Full Launch y Play) si el D1 es ≥ 10 % y la sesión media ≥ 8 minutos.
- **Matar** si en 5 pruebas en persona 3 o más personas no entienden cómo golpear sin ayuda en 20 s.
- **Propio de este juego:** si Germán, tras 5 minutos, siente que es «otro minigolf más», se para antes del test. El diferencial son los hoyos vivos.

## Lección de Dino Wrangler aplicada
Dino Wrangler se mató el 3 oct 2026 en el primer juego de Germán: los dinosaurios hechos con primitivas y vistos desde arriba y por detrás no se reconocían. El motor del estudio luce con **objetos y escenarios** (camiones, mesas, tejados, barcos) y sufre con **animales grandes y orgánicos**. El minigolf es justo el caso fuerte: todo son piezas geométricas.

## Qué se reutiliza del motor y qué es nuevo
| Parte | Estado |
|---|---|
| Calidad automática, partículas, pantallas, guardado, SDK de CrazyGames, build, analítica en el Supabase del estudio | Igual |
| Controles | Nuevos: tirachinas a un pulgar |
| Simulación (`src/sim`) | Nueva: física de la bola en rejilla, peligros, obstáculos móviles, bot que busca el mejor golpe |
| Mundo 3D (`src/render`) | Nuevo: dioramas por recorrido, bola, bandera, línea de tiro |
| HUD, tarjeta de puntuación, sonidos, textos (EN/ES), música (IA) | Nuevos |
