import { runEmbedderDaemonFromEnv } from "./embedder-daemon.js";

void runEmbedderDaemonFromEnv().catch((error) => {
  console.error("[Melu] Failed to start embedder daemon:", error);
  process.exitCode = 1;
});
