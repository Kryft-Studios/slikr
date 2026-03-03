import { Slikr } from "./index";
interface SlikrEvListener {
    name: string,
    fn: Function
}
export class Bindings {
    #type: "s" | "t";
    #c?: WebSocket | WebTransport;
    #u?: string;
    #rclisteners: { [key: string]: SlikrEvListener[] } = {}
    get url() {
        return this.#u || ""
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
        }
    };
    #wt = {
        async readDatagram(wt: WebTransport, handler: Function) {
            const reader = wt.datagrams.readable.getReader();
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    handler(new TextDecoder().decode(value));
                }
            } finally {
                reader.releaseLock();
            }
        }
    }
    constructor(type: "s" | "t") {
        this.#type = type;
    }
    receive(name: string): Promise<any> {
        return new Promise((resolve) => {
            if (!this.#rclisteners[name]) this.#rclisteners[name] = [];
            this.#rclisteners[name].push({
                name,
                fn: (payload: any) => resolve(payload)
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
    listenAny(callback: Function) {
        this.#listener.add("any", callback)
    }
    get isWebSocket() {
        return this.#type === "s";
    }

    async ready() {
        if (this.isWebSocket) return true;
        if (!this.#c) return false;
        let a;
        try {
            a = await (this.#c as WebTransport).ready;
        } catch (e) {
            throw new Slikr.Error(`WebTransport.ready failed with error ${e}`)
            return false;
        }
        return a;
    }
    async closed() {
        if (!this.#c) return false;
        if (this.isWebSocket) return (this.#c as WebSocket).close()
        let a;
        try {
            a = await (this.#c as WebTransport).closed;
        } catch (e) {
            throw new Slikr.Error(`WebTransport.closed failed with error ${e}`)
            return false;
        }
        return a;
    }
    async send(name: string, data: string) {
        if (!this.#c) throw new Slikr.Error("No connection to send data!");
        data = ___data.create(name, data)
        if (this.isWebSocket) {
            const ws = this.#c as WebSocket;
            if (ws.readyState !== WebSocket.OPEN) return false;
            ws.send(data);
            return true;
        }
        const wt = this.#c as WebTransport;
        try {
            const writer = wt.datagrams.writable.getWriter();
            const encodedData = new TextEncoder().encode(data)
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
        if (listeners) listeners.forEach(l => l.fn(...args));
    };

    const handleRaw = (raw: string) => {
        const packet = ___data.get(raw);
        if (!packet) return;
        this.#listener.any_listeners.forEach(fn => fn(packet.name, packet.payload, packet));
        const specifics = this.#listener.named_listeners[packet.name];
        
        let a = this.#rclisteners[packet.name];
        if(a) specifics ? specifics.push(...a) : (this.#listener.named_listeners[packet.name] = a);
        
        if (specifics) specifics.forEach(l => l.fn(packet.payload, packet));
        if(a) this.#rclisteners[packet.name] = [];
    };

    if (this.isWebSocket) {
        const ws = c as WebSocket;
        ws.onmessage = (e) => handleRaw(e.data);
        ws.onopen = () => emit("open");
        ws.onerror = (e) => emit("error", e);
        ws.onclose = () => emit("close");
    } else {
        const wt = c as WebTransport;
        wt.ready.then(() => emit("open")).catch(e => emit("error", e));
        wt.closed.then(() => emit("close")).catch(e => emit("error", e));
        this.#wt.readDatagram(wt, handleRaw);
    }
}
}



const ___data = {
    idCounter: 0,
    create(name: string, data: string) {
        return `FROM_SLIKR|v1\n${name}\n${new Date().toISOString()}\n${++this.idCounter}\n${data}`;
    },
    get(str: string) {
        if (!str.startsWith("FROM_SLIKR")) return false;

        const __spl = str.split("\n");
        if (__spl.length < 5) return false;

        const data = {
            version: __spl[0].split("|")[1] || "v1",
            name: __spl[1],
            date: __spl[2],
            id: __spl[3],
            payload: __spl.slice(4).join("\n")
        };
        if (!data.name || !data.date) return false;

        return data;
    }
}