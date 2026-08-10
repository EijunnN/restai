import { redis, createSubscriber, intentarRedis } from "../../lib/redis.js";
import { logger } from "../../lib/logger.js";
import type {
  CoordinatorMessageHandler,
  RealtimeCoordinator,
} from "./coordinator.js";

/**
 * Coordinador multi-instancia vía Redis pub/sub (ioredis).
 *
 * Usa una conexión dedicada como subscriber y la conexión principal para
 * publicar. Es el patrón estándar para escalar el servidor WebSocket nativo
 * horizontalmente (contenedor con réplicas, o Vercel Functions con Fluid compute,
 * donde cada conexión queda fijada a una instancia distinta).
 */
export class RedisCoordinator implements RealtimeCoordinator {
  readonly name = "redis";
  private subscriber = createSubscriber();
  private handler: CoordinatorMessageHandler = () => {};

  constructor() {
    this.subscriber.on("message", (room: string, payload: string) => {
      this.handler(room, payload);
    });
  }

  onMessage(handler: CoordinatorMessageHandler): void {
    this.handler = handler;
  }

  async subscribe(room: string): Promise<void> {
    await this.subscriber.subscribe(room);
  }

  async unsubscribe(room: string): Promise<void> {
    await this.subscriber.unsubscribe(room);
  }

  async publish(room: string, payload: string): Promise<void> {
    /*
      Publicar NO puede bloquear la peticion que lo dispara.

      Cada comanda que sale del punto de venta pasa por aqui. Antes, con Redis
      caido, la peticion esperaba los reintentos de ioredis antes de rendirse:
      el cajero veia su toque tardar segundos por culpa de una entrega entre
      instancias que ni siquiera es imprescindible en un local de una sola.

      `intentarRedis` devuelve null enseguida cuando Redis no responde y el
      evento se entrega igual a los clientes de ESTA instancia.
    */
    const publicado = await intentarRedis(() => redis.publish(room, payload));
    if (publicado === null) {
      // Entrega best-effort a los clientes de ESTA instancia aunque Redis falle.
      this.handler(room, payload);
    }
  }

  async close(): Promise<void> {
    try {
      await this.subscriber.quit();
    } catch {
      // ya desconectado
    }
  }
}
