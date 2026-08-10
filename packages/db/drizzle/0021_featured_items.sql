-- Los platos que se cantan cada noche, anclados arriba de la caja.
--
-- El 80 % de las comandas de un local sale del 20 % de la carta: pollo a la
-- brasa, lomo saltado, la gaseosa. Hasta ahora esos platos vivían mezclados con
-- los otros cincuenta y había que buscarlos igual que a un postre que se pide
-- dos veces por semana.
--
-- Por qué una columna que marca un HUMANO y no un ranking calculado al vuelo:
-- lo que hace rápida una caja no es tener el plato cerca, es que la mano vaya
-- sola. El cajero aprende "lomo saltado, arriba a la izquierda" y a la tercera
-- noche ya no lee la pantalla. Un ranking automático reordena esa fila cada
-- semana, y cada reordenación obliga a todo el mundo a volver a leer: se paga
-- una mejora el primer día con una peor todos los demás.
--
-- El ranking NO desaparece —el dueño no sabe de memoria qué se vende más, y se
-- equivoca siempre en la misma dirección: sobrevalora el plato del que está
-- orgulloso e ignora el aburrido que se vende solo—. Pero vive donde sirve: en
-- la pantalla de carta, como sugerencia con los números delante. El sistema
-- propone QUÉ entra; una persona decide CUÁNDO cambia. Así un catering puntual
-- de doscientas empanadas no le reconfigura la caja a nadie a mitad de servicio.
--
-- El orden DENTRO de los destacados es el `sort_order` que ya existe, así que el
-- dueño puede colocarlos arrastrando con lo que ya hay construido.

ALTER TABLE "menu_items"
  ADD COLUMN IF NOT EXISTS "is_featured" boolean DEFAULT false NOT NULL;

-- El punto de venta pregunta "los destacados de esta sede" en cada carga. El
-- índice es parcial: los destacados son un puñado sobre una carta entera, así
-- que indexar solo las filas en `true` deja un índice diminuto que no hay que
-- mantener cuando se edita cualquier otro plato.
CREATE INDEX IF NOT EXISTS "idx_menu_items_featured"
  ON "menu_items" ("branch_id")
  WHERE "is_featured";

-- El ranking de más vendidos agrupa por PLATO y no por el texto del nombre.
--
-- El informe que ya existía (`GET /reports/top-items`) agrupa por
-- `order_items.name`, que es una copia congelada del nombre en el momento del
-- pedido: un plato renombrado a mitad de mes sale partido en dos filas que no
-- suman, y no hay id con el que casar la ficha de la carta. Con este índice la
-- agregación por `menu_item_id` no tiene que recorrer la tabla entera.
CREATE INDEX IF NOT EXISTS "idx_order_items_menu_item"
  ON "order_items" ("menu_item_id");
