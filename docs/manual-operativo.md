# RestAI — Manual operativo

Cómo se usa el sistema en un restaurante real, rol por rol. Está escrito para dos lectores: quien
va a vender el producto y quien va a formar al personal el primer día.

---

## Los cinco roles

| Rol | Dónde aterriza al entrar | Qué gestiona |
|---|---|---|
| **Cocina** | `/kitchen` | Comandas y disponibilidad de platos |
| **Mesero** | `/tables` | Sala: mesas, comensales, pedidos y cobro |
| **Cajero** | `/pos` | Mostrador, cobros, caja y comprobantes |
| **Gerente de sede** | `/` (Panel) | Todo lo operativo de su sede + reportes |
| **Administrador** | `/` (Panel) | Todas las sedes, configuración y auditoría |

Cada rol aterriza donde trabaja, no en una pantalla genérica. Si intenta abrir una sección que no le
corresponde, se le devuelve a su zona con una explicación en vez de una pantalla de error.

---

## Cocinero

**Su turno, paso a paso**

1. Abre la tablet en `/kitchen`. Ve un tablero de tres columnas: **Pendiente · Preparando · Listo**.
2. Entra una comanda: **suena un aviso**, la tarjeta destella y el contador arranca. El tablero
   mantiene la pantalla encendida durante el servicio.
3. Cada tarjeta muestra el número de pedido en grande, la **mesa**, el tiempo transcurrido con color
   de urgencia (ámbar a los 5 min, rojo a los 15) y todos los modificadores y notas del comensal.
4. Toca **Preparando** y luego **Listo**. Si otra pantalla se le adelantó, recibe un aviso claro y el
   tablero se actualiza; nunca se queda en silencio.
5. **Se acaba un plato**: toca *86* en la línea, elige un motivo ("Se acabó", "Producto en mal
   estado", "Error de comanda") y confirma. El sistema recalcula el total del pedido con el IGV de la
   sede, avisa al comensal en su móvil, y si marca "Se acabó" retira el plato de la carta en el mismo
   gesto.
6. Desde el panel **Carta** puede marcar cualquier plato como agotado *antes* de que alguien lo pida.

**Lo que NO puede hacer:** cobrar, anular una venta, ver reportes ni tocar la caja.

---

## Mesero

**Su turno, paso a paso**

1. Abre `/tables` y ve el plano de la sala con el estado de cada mesa y su saldo.
2. **Llega un cliente que escanea el QR**: aparece en `/connections` y el mozo lo aprueba. Si la sede
   tiene la **auto-aprobación** activada, el comensal entra directo a la carta sin esperar.
3. **Llega un cliente que no puede escanear**: el mozo lo sienta él mismo con "Sentar cliente", o el
   comensal entra por el **código corto** impreso en la mesa (ver más abajo).
4. **Avisos**: cuando alguien pulsa "Llamar al mozo" o "Pedir la cuenta", el aviso entra en una
   bandeja **persistente** con el número de mesa y el tiempo esperando. Sobrevive a un refresco y a un
   cambio de turno. El mozo marca "Voy" y luego "Resuelto".
5. **Toma un pedido** desde el POS eligiendo la mesa: el pedido entra en la cuenta de esa mesa y
   cocina lo ve con su número.
6. **Cobra en la mesa**, incluida la **cuenta dividida por ítems**: selecciona qué platos paga cada
   comensal y el sistema reparte impuestos y descuentos de forma que la suma cuadra con el total.
7. **Junta o mueve mesas** cuando el grupo cambia de sitio: las cuentas se reasignan sin perder nada.
8. **Libera la mesa**. Si queda saldo pendiente, el sistema lo **impide** y muestra cuánto falta.
   Perdonar ese saldo exige permiso de caja y queda registrado con nombre y apellidos.

**Lo que NO puede hacer:** borrar mesas, reescribir el plano de la sala, abrir o cerrar caja, anular
cobros ni ver reportes.

---

## Cajero

**Su turno, paso a paso**

1. **Abre caja** en `/caja` con el fondo inicial. Solo puede haber una caja abierta por sede.
2. Trabaja en `/pos`: ve la carta completa con fotos, busca por nombre (ignora tildes y mayúsculas),
   arma el pedido y elige **Aquí / Llevar / Delivery**.
3. **Identifica al cliente** buscándolo por teléfono o nombre — funciona con el número tecleado con
   espacios o guiones. Esto es lo que hace que la venta de mostrador **sume puntos**.
4. Crea el pedido y **cobra desde el mismo diálogo**, sin saltar a otra pantalla. Acepta efectivo,
   tarjeta, Yape, Plin y transferencia; admite pagos parciales y propina, y calcula el vuelto.
5. **Se equivoca**: anula el cobro indicando el motivo. El importe sale del arqueo, las líneas
   cobradas se liberan, y si la venta ya tenía comprobante el sistema avisa de que hace falta una
   **nota de crédito**.
6. **Emite el comprobante** (boleta o factura) y lo declara a SUNAT desde `/invoices`, donde ve el
   estado real de cada uno: aceptado, observado, rechazado con motivo, o pendiente.
7. **Cierra caja**: cuenta el efectivo, lo ingresa y ve la diferencia **antes** de confirmar. El
   arqueo queda cerrado con su nombre.

**Lo que NO puede hacer:** ver reportes de negocio ni la auditoría.

---

## Gerente de sede

Abre el **Panel** y ve las ventas del día, el ticket promedio, las órdenes activas y las mesas
ocupadas. Los ingresos cuentan solo lo cobrado; el volumen de órdenes cuenta todo menos lo anulado —
son dos números distintos a propósito y la pantalla lo explica.

Desde ahí gestiona:

- **Reportes** con rango de fechas en horario de Lima, incluidas **ventas por mozo y cobros por
  cajero**. Todo exportable a CSV para el contador.
- **Carta**: productos, categorías, modificadores, fotos, alérgenos y tiempos de preparación.
- **Inventario** con descuento automático al completar un pedido y aviso de quiebre de stock.
- **Personal**: altas, roles, turnos y contraseñas — sin poder tocar a nadie de rango igual o
  superior al suyo.
- **Fidelización**: programa de puntos, niveles, recompensas, cupones, referidos y campañas.

---

## Administrador

Todo lo anterior, más:

- **Consolidado multi-sede**: ventas de todas las sedes en una sola pantalla, con totales.
- **Configuración fiscal**: RUC, razón social, credenciales SUNAT (cifradas), series de numeración y
  un botón para **probar la conexión** antes de emitir nada en serio.
- **Auditoría**: quién anuló qué, quién cambió el IGV, quién tocó una contraseña. Filtrable y
  exportable. Las entradas conservan el correo del empleado aunque después se le dé de baja.
- Gestión de sedes. Al cambiar el identificador de una sede, el sistema **avisa** de cuántos códigos
  QR impresos quedarán invalidados.

---

## El comensal

1. **Escanea el QR** de la mesa y ve el nombre del restaurante y el número real de su mesa.
2. Deja su nombre. Puede sumarse al programa de puntos dando su correo; la casilla de publicidad está
   **desmarcada** y es él quien decide.
3. Si hace falta aprobación, la pantalla de espera muestra **el tiempo transcurrido** y un botón para
   avisar al mozo — nunca una ruedita infinita.
4. **Ve la carta** con fotos, buscador, alérgenos, etiquetas dietéticas y tiempo de preparación. Los
   platos agotados aparecen marcados, no desaparecen.
5. **Arma su pedido** con modificadores y notas. El carrito **sobrevive a un refresco** y está atado a
   esa mesa concreta.
6. Aplica cupones y canjea recompensas, que se describen por lo que son ("Postre gratis"), no como
   "S/ 0.00 de descuento".
7. Confirma deslizando — o con el teclado, para quien no puede arrastrar.
8. **Sigue su pedido** en tiempo real, ve el total acumulado de la mesa, pide más, o pide la cuenta.

### Si no puede escanear el QR

Es el caso que deja a una mesa fuera del sistema: móvil sin cámara, sin datos, sticker despegado, o
sencillamente alguien que no usa QR.

El cartel de cada mesa —imprimible desde el panel— lleva, además del QR:

> **¿No puedes escanear?**
> Entra a `turestaurante.com/tusede/codigo`
> y escribe el código **NXNV2**

El código tiene 5 caracteres de un alfabeto **sin caracteres ambiguos** (sin I, L, O, U, 0 ni 1), así
que se puede dictar por teléfono sin confusiones. El sistema tolera minúsculas, espacios y guiones.

Y si aun así no funciona, **el mozo sienta al cliente desde su tablet** y el pedido entra igual.

---

## Notas para quien vende

- **Todo el dinero se maneja en céntimos enteros.** No hay errores de redondeo acumulados.
- **La caja y la sala están serializadas**: un cobro en vuelo no puede caer en una caja ya cerrada.
- **Multi-tenant real**: cada consulta filtra por organización y sede.
- **Multi-instancia**: con Redis configurado, la cocina ve los pedidos aunque entren por otra
  instancia detrás del balanceador.
- **Facturación electrónica peruana** completa: firma XML-DSig, envío SOAP, lectura del CDR, notas de
  crédito y comunicaciones de baja.
- **Ley 29733**: consentimiento explícito, exportación y anonimización de datos del cliente.
