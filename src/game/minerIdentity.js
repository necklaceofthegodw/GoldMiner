export async function allocateMinerNick() {
  const response = await fetch("/api/miner-nick", {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Miner identity service unavailable");
  const { nick } = await response.json();
  if (typeof nick !== "string" || !/^Miner[1-9]\d*$/.test(nick)) {
    throw new Error("Invalid miner name");
  }
  return nick;
}
