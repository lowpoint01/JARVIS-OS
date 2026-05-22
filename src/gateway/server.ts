import { loadConfig } from "../config/config.js";
import { createGateway, listen } from "./http.js";

const loaded = loadConfig(process.cwd());
const runtime = await createGateway(loaded);
const address = await listen(runtime, loaded);

console.log(
  `[JARVIS-OS] Gateway ready at http://${address.address}:${address.port} ` +
    `(chat=${loaded.config.models.chat.provider}/${loaded.config.models.chat.model}, ` +
    `embedding=${loaded.config.models.embedding.provider}/${loaded.config.models.embedding.model})`,
);

process.on("SIGINT", () => {
  runtime.server.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  runtime.server.close(() => process.exit(0));
});
