import { Bindings } from "./bindings.js";

export class Slikr {
  #url: string;
  #bindings: Bindings;
  #keepAlive: boolean = true;
  #katime: number = 5000;
  #kadata: { [key: string]: unknown } = {};
  /**
   * Starts an internal keepalive loop that periodically sends heartbeat packets.
   * The loop continues until keepalive is disabled.
   *
   * @returns A promise that resolves once the loop is scheduled.
   */
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
  /**
   * Enables/disables automatic keepalive pings.
   *
   * @param boolean `true` to enable keepalive, `false` to disable it.
   * @returns The current `Slikr` instance for chaining.
   */
  keepalive(boolean: boolean): this;
  /**
   * Sets the keepalive interval in milliseconds.
   *
   * @param time Interval between keepalive pings in milliseconds.
   * @returns The current `Slikr` instance for chaining.
   */
  keepalive(time: number): this;
  /**
   * Configures keepalive behavior.
   *
   * @param arg1 Either a boolean toggle or the keepalive interval (ms).
   * @returns The current `Slikr` instance for chaining.
   */
  keepalive(arg1: number | boolean) {
    if (typeof arg1 === "boolean") {
      this.#keepAlive = arg1;
    } else {
      this.#katime = arg1;
    }
    return this;
  }
  /**
   * Creates a new `Slikr` client bound to the given endpoint URL.
   *
   * @param url Target WebSocket/WebTransport URL.
   */
  constructor(url: string) {
    this.#url = url;
    const isSupported =
      typeof WebTransport !== "undefined" &&
      "datagrams" in WebTransport.prototype &&
      "ready" in WebTransport.prototype;
    this.#bindings = new Bindings(isSupported ? "t" : "s");
  }
  /**
   * Performs a single low-level connection attempt and waits for transport readiness.
   *
   * @param retrylabel Optional retry label used in connection logs.
   * @returns A promise resolving when the underlying transport is ready.
   */
  async #connect(retrylabel?: string) {
    console.log(
      `[Slikr] Connecting to ${this.#url}...${retrylabel ? `[${retrylabel}]` : ""}`,
    );
    const conn = this.#bindings.createConnection(this.#url);
    return await this.#bindings.ready();
  }
  #connectPredefData: {
    onRetryTimeout?: (retryNum?: number) => any;
    onTotalTimeout?: Function;
    onRetry?: (retryNum?: number) => any;
    retryDelay?: number;
    retryDelayIncreaseFn?: (current: number) => number;
    retryTimeout?: number;
    retryNum?: number;
    totalTimeout?: number;
  } = {};
  /**
   * Registers a callback fired when an individual retry attempt times out.
   *
   * @param fn Callback receiving the retry index.
   * @returns The current `Slikr` instance for chaining.
   */
  onRetryTimeout(fn: (retryNum?: number) => any): Slikr {
    this.#connectPredefData.onRetryTimeout = fn;
    return this;
  }
  /**
   * Registers a callback fired when total connection timeout is reached.
   *
   * @param fn Callback invoked on total timeout.
   * @returns The current `Slikr` instance for chaining.
   */
  onTotalTimeout(fn: Function) {
    this.#connectPredefData.onTotalTimeout = fn;
    return this;
  }
  /**
   * Registers a callback fired before each retry delay.
   *
   * @param fn Callback receiving the retry index.
   * @returns The current `Slikr` instance for chaining.
   */
  onRetry(fn: (retryNum?: number) => any) {
    this.#connectPredefData.onRetry = fn;
    return this;
  }
  /**
   * Sets the base delay between retries in milliseconds.
   *
   * @param num Retry delay in milliseconds.
   * @returns The current `Slikr` instance for chaining.
   */
  retryDelay(num: number) {
    this.#connectPredefData.retryDelay = num;
    return this;
  }
  /**
   * Sets a function used to compute the next retry delay.
   *
   * @param fn Function receiving current delay and returning the next delay.
   * @returns The current `Slikr` instance for chaining.
   */
  retryDelayIncreaseFn(fn: (current: number) => number) {
    this.#connectPredefData.retryDelayIncreaseFn = fn;
    return this;
  }
  /**
   * Sets the timeout for each individual retry attempt.
   *
   * @param num Retry timeout in milliseconds.
   * @returns The current `Slikr` instance for chaining.
   */
  retryTimeout(num: number) {
    this.#connectPredefData.retryTimeout = num;
    return this;
  }
  /**
   * Sets the maximum number of retries after the initial connection attempt.
   *
   * @param num Maximum retry count.
   * @returns The current `Slikr` instance for chaining.
   */
  retry(num: number) {
    this.#connectPredefData.retryNum = num;
    return this;
  }

  /**
   * Sets the global timeout budget for the entire connection process.
   *
   * @param num Total timeout in milliseconds.
   * @returns The current `Slikr` instance for chaining.
   */
  totalTimeout(num: number) {
    this.#connectPredefData.totalTimeout = num;
    return this;
  }
  /**
   * connect to the specified url
   */
  async connect(options?: {
    retry?: {
      number?: number;
      delay?: { number?: number; increaseFn?: (c: number) => number };
      onRetry?: (n: number) => any;
      timeout?: { time?: number; onTimeout?: (n: number) => any };
    };
    timeout?: { time?: number; onTimeout?: Function };
  }) {
    const maxRetries =
      options?.retry?.number ?? this.#connectPredefData?.retryNum ?? 0;
    let currentDelay =
      options?.retry?.delay?.number ??
      this.#connectPredefData?.retryDelay ??
      1000;
    const totalTimeoutTime =
      options?.timeout?.time ?? this.#connectPredefData?.totalTimeout;
    let isTotalTimeout = false;
    let hasCompleted = false;
    const totalTimeoutPromise = totalTimeoutTime
      ? new Promise((_, reject) => {
          setTimeout(() => {
            isTotalTimeout = true;
            if (options?.timeout?.onTimeout) options.timeout.onTimeout();
            else if (this.#connectPredefData?.onTotalTimeout)
              this.#connectPredefData.onTotalTimeout();
            reject(new Slikr.Error("Total Connection Timeout"));
          }, totalTimeoutTime);
        })
      : null;

    const attemptConnection = async () => {
      for (let i = 0; i <= maxRetries; i++) {
        if (isTotalTimeout) break;

        try {
          const retryTimeoutTime =
            options?.retry?.timeout?.time ??
            this.#connectPredefData?.retryTimeout ??
            5000;
          await Promise.race([
            this.#connect(i > 0 ? `Retry ${i}` : ""),
            new Promise((_, reject) =>
              setTimeout(() => reject("retry_timeout"), retryTimeoutTime),
            ),
          ]);
          this.#ka();
          return this;
        } catch (e) {
          if (isTotalTimeout) throw e;
          if (e === "retry_timeout") {
            const onRetryTO =
              options?.retry?.timeout?.onTimeout ??
              this.#connectPredefData?.onRetryTimeout;
            if (onRetryTO) onRetryTO(i);
          }
          const onRet =
            options?.retry?.onRetry ?? this.#connectPredefData?.onRetry;
          if (onRet) onRet(i);

          if (i === maxRetries) throw new Slikr.Error("Max retries reached.");
          const incFn =
            options?.retry?.delay?.increaseFn ??
            this.#connectPredefData?.retryDelayIncreaseFn;
          currentDelay = incFn ? incFn(currentDelay) : currentDelay;
          await new Promise((res) => setTimeout(res, currentDelay));
        }
      }
    };

    if (totalTimeoutPromise) {
      return await Promise.race([attemptConnection(), totalTimeoutPromise]);
    }
    return await attemptConnection();
  }
  /**
   * Subscribes to a named event.
   *
   * @param name Event name to subscribe to.
   * @param callback Handler invoked for matching event payloads.
   * @returns The current `Slikr` instance for chaining.
   */
  /**
   * There is 4 special event: "any","close","on","open". Please don't use it normally.
   *
   * If you want to use the "any" event but dont want to type the first parameter, pass the first parameter as a callback
   */
  on(name: string, callback: Function): Slikr;
  /**
   * Subscribes to every incoming event (`any`).
   *
   * @param callback Handler invoked with `(eventName, payload, packet)`.
   * @returns The current `Slikr` instance for chaining.
   */
  on(callback: Function): Slikr;
  /**
   * Subscribes to event callbacks.
   *
   * @param arg1 Event name or callback for `any` events.
   * @param arg2 Callback for named events.
   * @returns The current `Slikr` instance for chaining.
   * @throws {Slikr.Error} When arguments are invalid.
   */
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
  /**
   * Alias of {@link on}.
   */
  listen = this.on;
  /**
   * Sends a named event with either JSON payload data or binary bytes.
   * BigInt values are stringified with an `n` suffix when JSON is used.
   *
   * @param name Event name to send.
   * @param data Payload data to serialize and send.
   * @returns The current `Slikr` instance for chaining.
   */
  async send(name: string, data: any) {
    await this.#bindings.send(name, data);
    return this;
  }

  /**
   * Stops keepalive and closes the underlying transport connection.
   *
   * @returns The current `Slikr` instance for chaining.
   */
  async disconnect() {
    this.keepalive(false);
    await this.#bindings.closed();
    return this;
  }

  /**
   * Current connection metadata.
   *
   * @returns The target URL and detected transport type.
   */
  get status() {
    return {
      url: this.#url,
      type: this.#bindings.isWebSocket ? "WebSocket" : "WebTransport",
    };
  }
  /**
   * Waits for the next payload of a given event name.
   *
   * @param name Event name to receive.
   * @param timeout Optional timeout in milliseconds. `0` disables timeout.
   * @returns A promise resolving with the next event payload.
   * @throws {Slikr.Error} When the timeout is reached.
   */
  async receive(name: string, timeout: number = 0) {
    if (timeout > 0) {
      return Promise.race([
        this.#bindings.receive(name),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Slikr.Error(`Receive timeout for: ${name}`)),
            timeout,
          ),
        ),
      ]);
    }
    return await this.#bindings.receive(name);
  }
}
export default function slikr(url: string) {
  return new Slikr(url);
}
export namespace Slikr {
  export class Error extends globalThis.Error {
    constructor(message: any) {
      super(message);
      this.name = "Slikr";
    }
  }
}
