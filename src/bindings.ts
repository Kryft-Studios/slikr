import { Slikr } from "./index.js";
import { DataTools } from "./dt.js";
interface SlikrEvListener {
  name: string;
  fn: Function;
}
export class Bindings {
  #type: "s" | "t";
  #c?: WebSocket | WebTransport;
  #u?: string;
  #rclisteners: { [key: string]: SlikrEvListener[] } = {};
  #textdecoder = new TextDecoder();
  #textencoder = new TextEncoder();
  get url() {
    return this.#u || "";
  }
  #listener = {
    named_listeners: {} as Record<string, SlikrEvListener[]>,
    any_listeners: [] as Function[],
    add(name: string, callback: Function) {
      if (name === "any") {
        this.any_listeners.push(callback);
      } else {
        if (!this.named_listeners[name]) this.named_listeners[name] = [];
        this.named_listeners[name].push({ name, fn: callback });
      }
    },
  };
  get textdecoder() {
    return this.#textdecoder;
  }

  async abort() {
    if (!this.#c) return;

    try {
      if (this.isWebSocket) {
        const ws = this.#c as WebSocket;
        // Close immediately and remove listeners to prevent them from firing
        for(const i of ["onmessage","onopen","onerror","onclose"]){
          (ws as any)[i] = null;
        }
        ws.close();
      } else {
        const wt = this.#c as WebTransport;
        // WebTransport needs to be closed explicitly
        await wt.close();
      }
    } catch (e) {
      // Silently handle if it's already closed
    } finally {
      // Crucial: Clear the reference so createConnection() can make a new one
      this.#c = undefined;
      this.#u = undefined;
    }
  }
  #wt = {
    textdecoder: this.textdecoder,
    async readDatagram(wt: WebTransport, handler: Function) {
      const reader = wt.datagrams.readable.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          handler(this.textdecoder.decode(value));
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
  constructor(type: "s" | "t") {
    this.#type = type;
  }
  receive(name: string): Promise<any> {
    return new Promise((resolve) => {
      if (!this.#rclisteners[name]) this.#rclisteners[name] = [];
      this.#rclisteners[name].push({
        name,
        fn: (payload: any) => resolve(payload),
      });
    });
  }
  get SocketCtor() {
    return this.#type === "s" ? WebSocket : WebTransport;
  }

  createConnection(url: string) {
    if (this.#c) return this.#c;
    const Connection = this.SocketCtor;
    const c = new Connection(url);
    this.#c = c;
    this.#u = url;
    this.#setupEventHandling(c);
    return c;
  }

  listen(name: string, callback: Function) {
    this.#listener.add(name, callback);
  }
  get isWebSocket() {
    return this.#type === "s";
  }
  async ready() {
    if (!this.#c) return false;

    if (this.isWebSocket) {
      const ws = this.#c as WebSocket;
      if (ws.readyState === WebSocket.OPEN) return true;

      return new Promise((resolve) => {
        const onOpen = () => {
          cleanup();
          resolve(true);
        };
        const onError = () => {
          cleanup();
          resolve(false);
        };
        const cleanup = () => {
          ws.removeEventListener("open", onOpen);
          ws.removeEventListener("error", onError);
        };

        ws.addEventListener("open", onOpen, { once: true });
        ws.addEventListener("error", onError, { once: true });
      });
    }

    try {
      await (this.#c as WebTransport).ready;
      return true;
    } catch (e) {
      return false;
    }
  }
  async closed() {
    if (!this.#c) return false;
    if (this.isWebSocket) {
      if ((this.#c as WebSocket).readyState === WebSocket.CLOSED) {
        return true;
      }
      return new Promise((res) => {
        const ws = this.#c as WebSocket;
        ws.addEventListener("close", () => res(true), { once: true });
      });
    }
    let a;
    try {
      a = await (this.#c as WebTransport).closed;
    } catch (e) {
      throw new Slikr.Error(`WebTransport.closed failed with error ${e}`);
      return false;
    }
    return a;
  }

  async send(name: string, data: unknown) {
    if (!this.#c) throw new Slikr.Error("No connection to send data!");
    const packet = DataTools.create(name, data);
    if (this.isWebSocket) {
      const ws = this.#c as WebSocket;
      if (ws.readyState !== WebSocket.OPEN) return false;
      ws.send(packet);
      return true;
    }
    const wt = this.#c as WebTransport;
    try {
      const writer = wt.datagrams.writable.getWriter();
      const encodedData = this.#textencoder.encode(packet);
      await writer.write(encodedData);
      writer.releaseLock();
      return true;
    } catch (e) {
      throw new Slikr.Error(`WebTransport.send failed: ${e}`);
      return false;
    }
  }
  #setupEventHandling(c: WebSocket | WebTransport) {
    const emit = (event: string, ...args: any[]) => {
      const listeners = this.#listener.named_listeners[event];
      if (listeners) listeners.forEach((l) => l.fn(...args));
    };

    const handleRaw = (raw: string) => {
      const packet: any = DataTools.get(raw);
      if (!packet) return;
      packet.timetaken = Date.now() - packet.date;
      this.#listener.any_listeners.forEach((fn) =>
        fn(packet.name, packet.payload, packet),
      );
      const specifics = this.#listener.named_listeners[packet.name];

      const a = this.#rclisteners[packet.name];
      if (a) {
        a.forEach((l) => l.fn(packet.payload, packet));
        delete this.#rclisteners[packet.name];
      }
      if (specifics) specifics.forEach((l) => l.fn(packet.payload, packet));
      if (a) this.#rclisteners[packet.name] = [];
    };

    if (this.isWebSocket) {
      const ws = c as WebSocket;
      ws.onmessage = (e) => handleRaw(e.data);
      ws.onopen = () => emit("open");
      ws.onerror = (e) => emit("error", e);
      ws.onclose = () => emit("close");
    } else {
      const wt = c as WebTransport;
      wt.ready.then(() => emit("open")).catch((e) => emit("error", e));
      wt.closed.then(() => emit("close")).catch((e) => emit("error", e));
      this.#wt.readDatagram(wt, handleRaw);
    }
  }
}
