import { parentPort } from "node:worker_threads";

globalThis.self = {
  postMessage(message) {
    parentPort.postMessage(message);
  },
  onmessage: null,
};

const pendingMessages = [];
parentPort.on("message", (data) => {
  if (typeof globalThis.self.onmessage === "function") {
    void globalThis.self.onmessage({ data });
  } else {
    pendingMessages.push(data);
  }
});

await import("../src/workers/excelSheet.worker.js");
for (const data of pendingMessages.splice(0)) {
  void globalThis.self.onmessage?.({ data });
}
