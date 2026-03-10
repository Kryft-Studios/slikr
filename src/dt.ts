
export const DataTools = {
  idCounter: 0,
  _jsonReplacer(_: string, value: unknown) {
    if (typeof value === "bigint") return value.toString() + "n";
    return value;
  },
  _jsonReviver(_: string, value: unknown) {
    if (typeof value === "string" && /^-?\d+n$/.test(value))
      return BigInt(value.slice(0, -1));
    return value;
  },
  _bytesToBase64(bytes: Uint8Array) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  },
  _base64ToBytes(base64: string) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  },
  _decodeName(name: string) {
    try {
      return decodeURIComponent(name);
    } catch {
      return name;
    }
  },
  _decodePayload(payload: string, encoding: string = "raw") {
    if (encoding === "u8") {
      try {
        return this._base64ToBytes(payload);
      } catch {
        return payload;
      }
    }
    if (encoding === "json") {
      try {
        return JSON.parse(payload, this._jsonReviver);
      } catch {
        return payload;
      }
    }
    return payload;
  },
  clientCached: [] as number[],
  addToClientCached(num: number) {
    if (this.clientCached.length >= 10) this.clientCached.shift();
    this.clientCached.push(num);
  },
  average(arr: number[]) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  },
  create(name: string, data: any) {
    const payloadEncoding = data instanceof Uint8Array ? "u8" : "json";
    const payloadData =
      payloadEncoding === "u8"
        ? this._bytesToBase64(data)
        : JSON.stringify(data, this._jsonReplacer);

    this.addToClientCached(performance.now());

    // Header and Payload separated by ---
    return `FROM_SLIKR|v2
${encodeURIComponent(name)}
${Date.now()}
${++this.idCounter}
${payloadEncoding}
${this.average(this.clientCached)}
---
${payloadData}`;
  },

  get(str: string) {
    if (!str.startsWith("FROM_SLIKR")) return false;
    const [headerBlock, payloadRaw] = str.split("\n---\n");
    if (!payloadRaw) return false;

    const __spl = headerBlock.split("\n");
    const version = __spl[0].split("|")[1] || "v1";
    if (version === "v2" && __spl.length < 6) return false;

    const data = {
      version,
      name: version === "v2" ? this._decodeName(__spl[1]) : __spl[1],
      date: Number(__spl[2]),
      id: __spl[3],
      clientAveragePerformance: Number(__spl[5] || 0),
      payloadEncoding: __spl[4] || "json",
      payload: this._decodePayload(payloadRaw, __spl[4] || "json"),
    };

    if (!data.name || !data.date) return false;
    return data;
  },
};
