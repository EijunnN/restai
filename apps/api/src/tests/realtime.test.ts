import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import {
  PusherProvider,
  roomToChannel,
} from "../infrastructure/realtime/pusher.adapter.js";
import { AblyProvider } from "../infrastructure/realtime/ably.adapter.js";
import { NoopRealtime } from "../infrastructure/realtime/noop.adapter.js";
import { WebSocketManager } from "../infrastructure/realtime/websocket.adapter.js";
import { LocalCoordinator } from "../infrastructure/realtime/coordinator.js";

describe("Pusher adapter", () => {
  const provider = new PusherProvider({
    appId: "123",
    key: "appkey",
    secret: "appsecret",
    cluster: "us2",
  });

  it("mapea salas internas a canales privados (sin ':')", () => {
    expect(roomToChannel("branch:abc-123")).toBe("private-branch-abc-123");
    expect(roomToChannel("branch:abc:kitchen")).toBe("private-branch-abc-kitchen");
  });

  it("expone config pública del cliente sin secretos", () => {
    const cfg = provider.clientConfig();
    expect(cfg.provider).toBe("pusher");
    expect(cfg.key).toBe("appkey");
    expect(cfg.cluster).toBe("us2");
    expect((cfg as any).secret).toBeUndefined();
  });

  it("autoriza un canal permitido con firma HMAC correcta", async () => {
    const channel = "private-branch-b1";
    const res = await provider.authorize({
      socketId: "123.456",
      channel,
      allowedRooms: ["branch:b1"],
    });
    const expectedSig = createHmac("sha256", "appsecret")
      .update(`123.456:${channel}`)
      .digest("hex");
    expect(res.auth).toBe(`appkey:${expectedSig}`);
  });

  it("rechaza un canal fuera de las salas permitidas (multi-tenant)", async () => {
    await expect(
      provider.authorize({
        socketId: "123.456",
        channel: "private-branch-OTRO",
        allowedRooms: ["branch:b1"],
      }),
    ).rejects.toThrow();
  });
});

describe("Ably adapter", () => {
  const provider = new AblyProvider({ apiKey: "app.key:secretpart" });

  it("genera un TokenRequest firmado y acotado por capacidades", async () => {
    const token: any = await provider.authorize({
      clientId: "u1",
      allowedRooms: ["branch:b1", "branch:b1:kitchen"],
    });
    expect(token.keyName).toBe("app.key");
    expect(token.clientId).toBe("u1");
    expect(token.nonce).toBeTruthy();

    const caps = JSON.parse(token.capability);
    expect(caps["branch:b1"]).toEqual(["subscribe"]);
    expect(caps["branch:b1:kitchen"]).toEqual(["subscribe"]);

    // El mac debe corresponder al HMAC del texto canónico.
    const signText = `${token.keyName}\n${token.ttl}\n${token.capability}\n${token.clientId}\n${token.timestamp}\n${token.nonce}\n`;
    const expectedMac = createHmac("sha256", "secretpart")
      .update(signText)
      .digest("base64");
    expect(token.mac).toBe(expectedMac);
  });

  it("usa capacidad comodín si no hay salas", async () => {
    const token: any = await provider.authorize({ clientId: "u1" });
    expect(JSON.parse(token.capability)).toEqual({ "*": ["subscribe"] });
  });
});

describe("WebSocket manager + LocalCoordinator (in-process, sin Redis)", () => {
  /** Socket falso que captura lo que se le envía. */
  function fakeSocket() {
    return {
      readyState: 1,
      sent: [] as string[],
      closed: false,
      send(m: string) {
        this.sent.push(m);
      },
      close() {
        this.closed = true;
      },
    };
  }

  it("entrega un publish a los clientes de la sala, en el mismo proceso", async () => {
    const mgr = new WebSocketManager(new LocalCoordinator());
    expect(mgr.coordinatorName).toBe("local");

    const staff = fakeSocket();
    await mgr.register("c1", staff, {
      sub: "u1",
      role: "org_admin",
      branches: ["b1"],
    });
    // El register envía auth:success.
    expect(staff.sent.some((m) => m.includes("auth:success"))).toBe(true);

    await mgr.publish("branch:b1", { type: "order:new", id: 7 });

    const got = staff.sent.find((m) => m.includes("order:new"));
    expect(got).toBeTruthy();
    expect(JSON.parse(got!)).toEqual({ type: "order:new", id: 7 });
  });

  it("no entrega a clientes que no están en la sala", async () => {
    const mgr = new WebSocketManager(new LocalCoordinator());
    const other = fakeSocket();
    await mgr.register("c2", other, {
      sub: "u2",
      role: "org_admin",
      branches: ["b2"],
    });

    await mgr.publish("branch:b1", { type: "order:new" });

    expect(other.sent.some((m) => m.includes("order:new"))).toBe(false);
  });

  it("deja de entregar tras removeClient", async () => {
    const mgr = new WebSocketManager(new LocalCoordinator());
    const ws = fakeSocket();
    await mgr.register("c3", ws, { sub: "u3", role: "org_admin", branches: ["b1"] });
    mgr.removeClient("c3");
    expect(mgr.clientCount).toBe(0);

    await mgr.publish("branch:b1", { type: "order:new" });
    expect(ws.sent.some((m) => m.includes("order:new"))).toBe(false);
  });
});

describe("Noop adapter", () => {
  it("publica sin efecto y reporta deshabilitado", () => {
    const noop = new NoopRealtime();
    expect(() => noop.publish("branch:x", { a: 1 })).not.toThrow();
    expect(noop.name).toBe("noop");
    expect(noop.clientConfig()).toEqual({ provider: "noop", enabled: false });
  });
});
