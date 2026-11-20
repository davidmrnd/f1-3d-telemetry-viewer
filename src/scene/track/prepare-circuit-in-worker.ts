import { isCircuitSnapshot, type CircuitSnapshot } from "./circuit-preparation";

export function prepareCircuitInWorker(bytes: Uint8Array): Promise<CircuitSnapshot | undefined> {
  return new Promise(resolve => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./circuit-worker.ts", import.meta.url), { type: "module" });
    } catch {
      resolve(undefined);
      return;
    }
    const finish = (snapshot?: CircuitSnapshot) => {
      worker.terminate();
      resolve(snapshot);
    };
    worker.onmessage = ({ data }: MessageEvent<CircuitSnapshot>) => finish(isCircuitSnapshot(data) ? data : undefined);
    worker.onerror = event => { event.preventDefault(); finish(); };
    worker.onmessageerror = () => finish();
    try {
      worker.postMessage(bytes, [bytes.buffer]);
    } catch {
      finish();
    }
  });
}
