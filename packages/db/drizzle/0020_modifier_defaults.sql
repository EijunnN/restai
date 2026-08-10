-- Lo que el plato lleva "de toda la vida".
--
-- Un pollo a la brasa sale con papas, ají y huacatay salvo que el cliente diga
-- otra cosa. Hasta ahora el cajero tenía que marcar esas tres opciones a mano en
-- CADA pollo: tres toques por plato, cincuenta pollos por noche, y el error no
-- es que sea lento —es que el que se olvida de marcar el ají manda a cocina una
-- comanda que dice algo distinto de lo que va a salir del horno.
--
-- `is_default` invierte el trabajo: el diálogo abre con lo habitual ya marcado y
-- el cajero solo toca lo que se sale de la norma, que es la minoría de las
-- veces. Lo elegido sigue viajando línea a línea a `order_item_modifiers`, así
-- que la comanda y el recibo dicen exactamente lo mismo que antes; lo único que
-- cambia es quién lo teclea.
--
-- Por qué una columna en `modifiers` y no una lista en el grupo: el valor
-- pertenece a la OPCIÓN ("papas fritas es lo normal"), no al grupo, y así una
-- opción borrada se lleva su propio valor por delante sin dejar referencias
-- colgadas. Además el POS ya lee las opciones del grupo: no hace falta ni una
-- consulta más.
--
-- Ojo con el precio: una opción por defecto CON precio suma dinero sin que nadie
-- la haya tocado. Es legítimo (la presa "media" cuesta más), y por eso el diálogo
-- muestra el importe en la propia opción y el total de la línea se recalcula al
-- abrirlo. Lo que no puede pasar es que sume en silencio, y no lo hace.

ALTER TABLE "modifiers"
  ADD COLUMN IF NOT EXISTS "is_default" boolean DEFAULT false NOT NULL;
