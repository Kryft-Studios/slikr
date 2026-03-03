import { Bindings } from "./bindings.js"

export class Slikr {
    #url: string;
    #bindings: Bindings;
    #keepAlive: boolean = true;
    #katime: number = 5000;
    #kadata: { [key: string]: unknown } = {

    }
    async #ka() {
        const run = async () => {
            if (!this.#keepAlive) return;

            try {
                await this.send("keepalive", "Hello!");
            } catch (e) {
                console.log("[Slikr] Heartbeat failed.");
            }
            setTimeout(run, this.#katime);
        };

        run();
    }
    keepalive(boolean: boolean): this;
    keepalive(time: number): this;
    keepalive(arg1: number | boolean) {
        if (typeof arg1 === "boolean") {
            this.#keepAlive = arg1
        } else {
            this.#katime = arg1
        }
        return this;
    }
    constructor(url: string) {
        this.#url = url;
        this.#bindings = new Bindings(typeof WebTransport === "undefined" ? "s" : "t");
    }
    async #connect(retrylabel?: string) {
        console.log(`[Slikr] Connecting to ${this.#url}...${retrylabel ? `[${retrylabel}]` : ""}`);
        const conn = this.#bindings.createConnection(this.#url);
        return await this.#bindings.ready();
    }
    #connectPredefData: {
        onRetryTimeout?: (retryNum?: number) => any,
        onTotalTimeout?: Function,
        onRetry?: (retryNum?: number) => any,
        retryDelay?: number,
        retryDelayIncreaseFn?: (current: number) => number,
        retryTimeout?: number,
        retryNum?: number,
        totalTimeout?: number
    } = {};
    onRetryTimeout(fn: (retryNum?: number) => any): Slikr {
        this.#connectPredefData.onRetryTimeout = fn;
        return this;
    }
    onTotalTimeout(fn: Function) {
        this.#connectPredefData.onTotalTimeout = fn;
        return this;
    };
    onRetry(fn: (retryNum?: number) => any) {
        this.#connectPredefData.onRetry = fn;
        return this;
    }
    retryDelay(num: number) {
        this.#connectPredefData.retryDelay = num;
        return this;
    }
    retryDelayIncreaseFn(fn: (current: number) => number) {
        this.#connectPredefData.retryDelayIncreaseFn = fn;
        return this;
    }
    retryTimeout(num: number) {
        this.#connectPredefData.retryTimeout = num;
        return this;
    }
    retry(num: number) {
        this.#connectPredefData.retryNum = num
        return this;
    }
    totalTimeout(num: number) {
        this.#connectPredefData.totalTimeout = num;
        return this;
    }
    async connect(options?: {
        retry?: {
            number?: number,
            delay?: { number?: number, increaseFn?: (c: number) => number },
            onRetry?: (n: number) => any,
            timeout?: { time?: number, onTimeout?: (n: number) => any }
        },
        timeout?: { time?: number, onTimeout?: Function }
    }) {
        const maxRetries = options?.retry?.number ?? this.#connectPredefData?.retryNum ?? 0;
        let currentDelay = options?.retry?.delay?.number ?? this.#connectPredefData?.retryDelay ?? 1000;
        const totalTimeoutTime = options?.timeout?.time ?? this.#connectPredefData?.totalTimeout;
        let isTotalTimeout = false;
        let hasCompleted = false;
        const totalTimeoutPromise = totalTimeoutTime
            ? new Promise((_, reject) => {
                setTimeout(() => {
                    isTotalTimeout = true;
                    if (options?.timeout?.onTimeout) options.timeout.onTimeout();
                    else if (this.#connectPredefData?.onTotalTimeout) this.#connectPredefData.onTotalTimeout();
                    reject(new Slikr.Error("Total Connection Timeout"));
                }, totalTimeoutTime)
            })
            : null;

        const attemptConnection = async () => {
            for (let i = 0; i <= maxRetries; i++) {
                if (isTotalTimeout) break;

                try {
                    const retryTimeoutTime = options?.retry?.timeout?.time ?? this.#connectPredefData?.retryTimeout ?? 5000;
                    await Promise.race([
                        this.#connect(i > 0 ? `Retry ${i}` : ""),
                        new Promise((_, reject) => setTimeout(() => reject("retry_timeout"), retryTimeoutTime))
                    ]);
                    this.#ka()
                    return this;
                } catch (e) {
                    if (isTotalTimeout) throw e;
                    if (e === "retry_timeout") {
                        const onRetryTO = options?.retry?.timeout?.onTimeout ?? this.#connectPredefData?.onRetryTimeout;
                        if (onRetryTO) onRetryTO(i);
                    }
                    const onRet = options?.retry?.onRetry ?? this.#connectPredefData?.onRetry;
                    if (onRet) onRet(i);

                    if (i === maxRetries) throw new Slikr.Error("Max retries reached.");
                    const incFn = options?.retry?.delay?.increaseFn ?? this.#connectPredefData?.retryDelayIncreaseFn;
                    currentDelay = incFn ? incFn(currentDelay) : currentDelay;
                    await new Promise(res => setTimeout(res, currentDelay));
                }
            }
        };

        if (totalTimeoutPromise) {
            return await Promise.race([attemptConnection(), totalTimeoutPromise]);
        }
        return await attemptConnection();
    }
    /**
     * There is a special event: "any". Please don't use it normally, the "any" event watches for any message from the websocket/webtransport
     * 
     * If you want to use the "any" event but dont want to type the first parameter, pass the first parameter as a callback
     */
    on(name: string, callback: Function): Slikr;
    on(callback: Function): Slikr
    on(arg1: string | Function, arg2?: Function): Slikr {
        if (typeof arg1 === "string" && arg2) {
            this.#bindings.listen(arg1, arg2);
        } else if (typeof arg1 === "function") {
            this.#bindings.listen("any", arg1);
        } else {
            throw new Slikr.Error("Invalid 'on' arguments!");
        }
        return this;
    }
    listen = this.on
    async send(name: string, data: any) {
        const payload = JSON.stringify(data, (_, value) =>
            typeof value === 'bigint' ? value.toString() + 'n' : value
        ); await this.#bindings.send(name, payload);
        return this
    }

    async disconnect() {
        this.keepalive(false)
        await this.#bindings.closed();
        return this;
    }

    get status() {
        return {
            url: this.#url,
            type: this.#bindings.isWebSocket ? "WebSocket" : "WebTransport",
        };
    }
    async receive(name: string, timeout: number = 0) {
        if (timeout > 0) {
            return Promise.race([
                this.#bindings.receive(name),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Slikr.Error(`Receive timeout for: ${name}`)), timeout)
                )
            ]);
        }
        return await this.#bindings.receive(name);
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