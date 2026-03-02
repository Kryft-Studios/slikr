import { Bindings } from "./bindings"

export class Slikr {
    #url: string;
    #bindings: Bindings;
    #keepAlive
    constructor(url: string) {
        this.#url = url;
        this.#bindings = new Bindings(!WebTransport ? "s" : "t");
    }
    async connect() {
        console.log(`[Slikr] Connecting to ${this.#url}...`);
        const conn = this.#bindings.createConnection(this.#url);
        await this.#bindings.ready();
        return conn;
    }
    on(name: string, callback: Function): void;
    on(callback: Function): void;
    on(arg1: string | Function, arg2?: Function): void {
        if (typeof arg1 === "string" && arg2) {
            this.#bindings.listen(arg1, arg2);
        } else if (typeof arg1 === "function") {
            this.#bindings.listen("any", arg1);
        } else {
            throw new Slikr.Error("Invalid 'on' arguments!");
        }
    }
    listen = this.on
    async send(name: string, data: any) {
        const payload = typeof data === "object" ? JSON.stringify(data) : String(data);
        return await this.#bindings.send(name, payload);
    }

    async disconnect() {
        return await this.#bindings.closed();
    }

    get status() {
        return {
            url: this.#url,
            type: this.#bindings.isWebSocket ? "WebSocket" : "WebTransport",
        };
    }
}
export default function slikr(url: string) {
    return new Slikr(url)
}
export namespace Slikr {
    export class Error extends globalThis.Error {
        constructor(message: any) {
            super(message)
            this.name = "Slikr"
        }
    }
}