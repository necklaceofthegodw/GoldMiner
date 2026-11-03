import { get, put, BlobPreconditionFailedError } from "@vercel/blob";
import { allocateGlobalMinerNick } from "./_miner-counter.js";

const COUNTER_PATH = "miner-identity/global-counter-v1.json";

export function createMinerNickHandler(token = process.env.BLOB_READ_WRITE_TOKEN) {
  const read = async () => {
    const result = await get(COUNTER_PATH, { access: "private", useCache: false, token });
    if (!result) return null;
    if (result.statusCode !== 200 || !result.blob.etag) throw new Error("Counter unavailable");
    const data = await new Response(result.stream).json();
    if (!Object.hasOwn(data, "lastNumber")) throw new Error("Invalid counter");
    return { lastNumber: data.lastNumber, etag: result.blob.etag };
  };
  const compareAndSet = async (current, next) => {
    try {
      await put(COUNTER_PATH, JSON.stringify({ lastNumber: next }), {
        access: "private", token, addRandomSuffix: false,
        contentType: "application/json", allowOverwrite: Boolean(current),
        ...(current ? { ifMatch: current.etag } : {}),
      });
      return true;
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) return false;
      // Another request may have created the counter during initialization.
      if (!current && await read()) return false;
      throw error;
    }
  };
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      res.statusCode = 405;
      res.end(JSON.stringify({ error: "POST required" }));
      return;
    }
    if (!token) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "Miner identity service is not configured" }));
      return;
    }
    try {
      const nick = await allocateGlobalMinerNick({ read, compareAndSet });
      res.statusCode = 200;
      res.end(JSON.stringify({ nick }));
    } catch {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "Could not reserve a unique miner name" }));
    }
  };
}

export default createMinerNickHandler();
