# Mesero por voz (tablets)

El comensal pide **hablando** con una tablet, y la pantalla le va enseñando
aquello de lo que el agente habla. Convive con la carta táctil: es una entrada
más al mismo flujo de pedido, no un sistema paralelo.

## Qué hace falta para encenderlo

```env
VOICE_AGENT_PROVIDER=openai   # o "gemini"
OPENAI_API_KEY=sk-...         # si provider=openai
GEMINI_API_KEY=...            # si provider=gemini
VOICE_AGENT_MAX_MINUTES_PER_SESSION=15
```

Sin ninguna clave la función queda apagada de forma limpia:
`GET /api/voice/config` responde `enabled:false`, el botón "Pide hablando" no se
pinta y todo lo demás sigue igual. **Requiere HTTPS** en producción: el navegador
no da acceso al micrófono sin él.

Si se omite `VOICE_AGENT_PROVIDER` se autodetecta por la clave disponible
(OpenAI primero). Un nombre mal escrito **apaga la voz** en lugar de caer en otro
proveedor: caer en silencio significaría otra voz, otro precio y otro modelo sin
que nadie note la errata.

> `VOICE_AGENT_MODEL` y `VOICE_AGENT_VOICE` son **del proveedor activo**. Al
> cambiar de proveedor hay que cambiarlos o borrarlos; un modelo de OpenAI
> declarado con `gemini` activo rompe la conexión.

## Los dos proveedores

|  | OpenAI | Gemini |
|---|---|---|
| Modelo por defecto | `gpt-realtime-2.1-mini` | `gemini-3.1-flash-live-preview` |
| Transporte | WebRTC | WebSocket + PCM crudo |
| Audio | lo maneja el navegador | lo manejamos nosotros (16 kHz in / 24 kHz out) |
| Credencial | `POST /v1/realtime/client_secrets` | `POST /v1beta/auth_tokens` |
| Voz por defecto | `marin` | `Puck` |

La diferencia de transporte **no se disimula**: son dos formas distintas de mover
audio y un denominador común sería peor que ambas. Lo que sí es común es el
puerto (`lib/voice-providers/`) y la interfaz del transporte en el cliente
(`lib/voice-transport/`); herramientas, prompt y pantalla son agnósticos.

Con Gemini hay trabajo que en OpenAI hace el navegador: capturar el micrófono,
remuestrear a 16 kHz, empaquetar a PCM16, y reproducir la respuesta encadenando
cada trozo donde acaba el anterior (si cada uno se reprodujera "cuando llega", la
voz sonaría entrecortada). El barge-in también es manual: al llegar
`serverContent.interrupted` hay que **abortar el audio ya programado**, o el
agente sigue hablando segundos después de que lo interrumpan.

### Dónde queda el prompt en cada uno

- **OpenAI**: instrucciones y herramientas van dentro de la credencial efímera.
  No pasan por el navegador en ningún momento.
- **Gemini**: van en `liveConnectConstraints` del token, que es lo que Google
  recomienda para "mantener las instrucciones del sistema en el servidor". El
  cliente abre la conexión contra el endpoint `...Constrained` y manda un setup
  **mínimo** (solo el modelo). La garantía depende de que Google aplique esas
  restricciones; con OpenAI la configuración viaja entera dentro del secreto.

## Por dónde entra el comensal

| Ruta | Caso | Cómo sabe la mesa |
|------|------|-------------------|
| `/{sede}/{mesa}/voz` | Tablet fija en la mesa, o el móvil del comensal desde la carta | Del QR, como siempre |
| `/{sede}/voz` | Tablet de pared | La teclea el comensal (5 caracteres) |

La tablet de pared **no pregunta la mesa hablando**, y es a propósito: la
credencial de voz se acuña contra una sesión de mesa y la sesión necesita la
mesa. Romper ese círculo obligaría a exponer un endpoint de voz sin autenticar,
o sea un botón público que gasta dinero de la cuenta del local. Se teclea una
vez y ya no se vuelve a tocar la pantalla.

Tras teclear el código, el flujo es **exactamente** el del QR (misma pantalla de
sesión, misma aprobación del mozo si el local la exige). La intención de hablar
viaja en `sessionStorage` y la carta la consume una sola vez para saltar directo
a la conversación.

## Cómo está montado

```
Tablet ──POST /api/voice/session (token de sesión de mesa)──> API Hono
                                                               │
                     instrucciones + herramientas + carta      │
                     POST /v1/realtime/client_secrets ─────────┘
Tablet <──── credencial efímera (+ mapa ref→uuid) ────
Tablet ──WebRTC──> api.openai.com  (audio y canal "oai-events")
```

- **La clave de OpenAI nunca baja al navegador.** El backend acuña una
  credencial de vida corta por sesión (`lib/openai-realtime.ts`).
- **El audio no pasa por nuestra API**: va directo por WebRTC. Nuestro servidor
  solo interviene al abrir la conversación.
- **El agente no tiene atajos a la base de datos.** Las herramientas que tocan
  datos entran por los endpoints de comensal de siempre, con sus validaciones.
  `confirmar_pedido` acaba en el mismo `POST /api/customer/orders` que usa la
  carta táctil.

### Referencias cortas, no UUIDs

El agente nunca ve un uuid: cada plato lleva una referencia (`12`) y el servidor
manda el mapa `ref → uuid` junto con la credencial. Un uuid son ~15 tokens que se
pagan en cada turno, y los modelos copian mal cadenas largas sin significado —un
dígito cambiado es un plato que no existe—. El mapeo lo emite el servidor, así
que prompt y navegador no pueden divergir.

## La sincronía voz↔pantalla

Todo el efecto sale de dos decisiones:

1. **El prompt obliga a llamar a `mostrar_platos` ANTES de nombrar un plato.**
   El agente no ilustra lo que dijo: enseña y entonces habla.
2. **Las herramientas se despachan en `response.function_call_arguments.done`**,
   que llega antes que `response.done` — es decir, mientras el agente aún está
   hablando. Si se esperara a `response.done`, la imagen entraría siempre tarde.

En pantalla: el orbe late con la amplitud real de la voz (`AnalyserNode` sobre la
pista remota), los subtítulos entran palabra a palabra según llegan los deltas de
transcripción, y las tarjetas viajan de la fila al primer plano con
`layoutId` en vez de desaparecer y reaparecer.

## Qué puede y qué no

| Puede | Cómo |
|-------|------|
| Recomendar, buscar por antojo o restricción ("algo sin gluten") | `buscar_platos` |
| Agregar con cantidad, opciones y una indicación | `agregar_al_carrito` |
| Quitar, o quitar solo algunas unidades | `quitar_del_carrito` |
| Corregir un número ("que sean tres") | `cambiar_cantidad` — fija el total, no suma |
| Poner o cambiar una nota de algo ya pedido | `poner_nota` |
| Empezar de cero | `vaciar_carrito` |
| Pedir la cuenta o llamar a una persona | `llamar_mozo` |
| Aplicar un cupón que le den | `aplicar_cupon` / `quitar_cupon` |
| Consultar puntos y canjear una recompensa | `ver_mis_puntos` / `canjear_recompensa` |
| "¿Cuánto falta?" sobre lo ya enviado | `estado_del_pedido` |
| Enviar el pedido a cocina | `confirmar_pedido` |

**No puede** —y el prompt le obliga a decirlo y ofrecer `llamar_mozo`—: inventar
descuentos o cambiar precios, prometer tiempos de espera, tocar un pedido que ya
está en cocina, cobrar, o confirmar un alérgeno que no esté declarado en la carta.

Sobre dinero, tres reglas que evitan discusiones en caja:

- El importe de un descuento **nunca lo decide el agente**. Se estima con el
  mismo módulo que usa la pantalla del carrito (`lib/cart-discounts.ts`, calcado
  de `order.service.ts`) y el servidor recalcula al confirmar.
- Los cupones **2x1 y por categoría** no se pueden estimar en el navegador. En
  ese caso el agente tiene prohibido dar el total como definitivo: dice el total
  sin ese descuento, avisa de que se aplica al enviar, y si el servidor devuelve
  otro importe lo corrige en voz alta.
- **Canjear puntos los gasta** aunque el pedido no llegue a enviarse, así que
  debe preguntar antes.

Dos detalles que evitan errores caros: una indicación como "sin cebolla" se
transmite como **petición** a cocina y el agente tiene prohibido prometer que se
cumplirá; y si el mismo plato está pedido dos veces con opciones distintas, las
herramientas devuelven las variantes y le obligan a **preguntar** a cuál se
refiere en vez de elegir por su cuenta.

## El pedido se cierra por voz

Decisión explícita del producto. Las salvaguardas:

- `confirmar_pedido` exige `total_esperado_centimos` y el cliente **rechaza la
  llamada si no coincide** con el carrito real, devolviendo el error al modelo
  para que relea el resumen. El agente no puede confirmar algo distinto de lo
  que acaba de decir en voz alta.
- El prompt prohíbe confirmar sin resumen leído ítem por ítem y un sí
  inequívoco; ante ruido o ambigüedad, repregunta.
- Tras enviar, la pantalla da **20 segundos con un botón grande de anular**,
  cableado a `POST /api/customer/orders/:id/cancel` (que ya existía). Devuelve
  409 en cuanto la cocina toca la comanda, que es la respuesta correcta.

## Coste y frenos

`gpt-realtime-2.1-mini` cobra por tokens de audio (entrada $10/M, salida $20/M).
Un pedido conversado ronda **$0.05–0.15**, pero hay que **medirlo** en el local
antes de darlo por bueno.

Dos frenos, porque el caso que quema dinero es real —el comensal se va y el micro
sigue captando el ruido del comedor—:

- **Tope por sesión de mesa** (`VOICE_AGENT_MAX_MINUTES_PER_SESSION`), contado en
  Redis. Al superarlo, la tablet cae a la carta táctil sin romperse.
- **Cuelgue por inactividad** a los 3 minutos sin habla ni toques, en el cliente.

Si Redis no está disponible el tope se salta y se registra: acota gasto, no es un
control de seguridad, y quedarse sin voz porque Redis reinicia sería peor.

## Locales con varias tablets de pared

`POST /{sede}/{mesa}/session` y `GET /{sede}/tables/by-code/{código}` son
públicos, así que su rate-limit se cuenta **por IP** — y todo el local sale por
la misma IP pública. Los topes por defecto (5 y 20 por 10 min) se agotan enseguida
con varias tablets abriendo sesiones. Se ajustan sin tocar código:

```env
RATE_LIMIT_SESSION_CREATE_ANON_MAX=40
RATE_LIMIT_TABLE_BY_CODE_ANON_MAX=120
```

## Añadir un proveedor nuevo

Dos archivos, uno a cada lado:

1. `apps/api/src/lib/voice-providers/<nombre>.ts` — implementa `VoiceProvider`:
   dice si está configurado, cuál es su modelo y voz, y acuña la credencial
   traduciendo las herramientas a su dialecto. Se registra en `index.ts`.
2. `apps/web/src/lib/voice-transport/<nombre>.ts` — implementa
   `VoiceTransportConnect`: abre la conexión y traduce los eventos del proveedor
   a las devoluciones de llamada comunes (`onState`, `onTranscriptDelta`,
   `onToolCall`…). Se elige en `use-voice-agent.ts` por `grant.transport`.

Nada más se toca: el prompt (`services/voice-agent.service.ts`), las
herramientas (`lib/voice-tools.ts`) y toda la pantalla son agnósticos.

Al traducir las herramientas, cuidado con el esquema: OpenAI acepta JSON Schema
tal cual, pero Gemini exige un subconjunto de OpenAPI con los tipos en
**mayúsculas** y **sin** `minimum`/`maximum`, y rechaza `parameters` cuando el
objeto va vacío. Un campo de más no da error visible: deja al agente sin esa
herramienta, y el modelo improvisa en su lugar.
