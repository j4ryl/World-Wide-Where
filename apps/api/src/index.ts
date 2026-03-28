import { config } from "./config";
import { createApp } from "./app";

process.on("uncaughtException", (error) => {
  console.error("[api] uncaughtException", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[api] unhandledRejection", reason);
});

const app = createApp();

app.listen(config.PORT, () => {
  console.log(`World Wide Where API listening on http://localhost:${config.PORT}`);
});
