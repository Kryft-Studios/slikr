import slikr from "@briklab/slikr";

const client = slikr("wss://echo.websocket.org");

await client.connect();

client.on((data) => {
  console.log("Received:", data);
});

await client.send("hello", "world");