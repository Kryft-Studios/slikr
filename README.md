[Read Docs](https://briklab-docs.pages.dev/packages/silkr/introduction)
[Github Repository](https://github.com/Kryft-Studios/slikr)

# @briklab/slikr

@briklab/slikr is a WebTransport(with WebSocket fallback) Wrapper

## Installation

Follow the [common installation tutorial](https://briklab-docs.pages.dev/packages/common-installation-tutorial)

## Quick Start

```ts
import slikr from "@briklab/slikr";

const client = slikr("wss://echo.websocket.org");

await client.connect();

client.on("message", (data) => {
  console.log("Received:", data);
});

await client.send("hello", "world");
```

## API

### Exported:
#### Functions:
- [slikr](https://briklab-docs.pages.dev/packages/silkr/functions/slikr)

#### Classes:
- [Slikr](https://briklab-docs.pages.dev/packages/silkr/classes/slikr)

#### Namespaces:
- [Slikr](https://briklab-docs.pages.dev/packages/silkr/namespaces/slikr)


## Tutorials

- [Installation](https://briklab-docs.pages.dev/packages/silkr/tutorial/installation)
- [Getting Started](https://briklab-docs.pages.dev/packages/silkr/tutorial/getting-started)
- [Examples](https://briklab-docs.pages.dev/packages/silkr/tutorial/examples)
- [Advanced](https://briklab-docs.pages.dev/packages/silkr/tutorial/advanced)
