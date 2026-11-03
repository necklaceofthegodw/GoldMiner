// The adapter must atomically compare the version and write the next value.
export async function allocateGlobalMinerNick(store, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const current = await store.read();
    const lastNumber = current ? current.lastNumber : 0;
    if (!Number.isSafeInteger(lastNumber) || lastNumber < 0 || lastNumber >= Number.MAX_SAFE_INTEGER) {
      throw new Error("Invalid miner counter");
    }
    const next = lastNumber + 1;
    if (await store.compareAndSet(current, next)) return `Miner${next}`;
    await pause(20 + Math.random() * 80);
  }
  throw new Error("Miner counter is busy");
}
