import { isChoiceHttpConfigured } from "./choiceHttpConfig.js";

export const CHOICE_OUTBOX_PREFIX = "goldminer:choice-http:outbox:v1:";
const REQUEST_TIMEOUT_MS = 5000;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 10000;

function browserStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

function isPayload(payload) {
  const metadata = payload?.metadata;
  return (payload?.bit === 0 || payload?.bit === 1) &&
    typeof payload.timestamp_generation === "string" && payload.timestamp_generation.endsWith("Z") &&
    Number.isFinite(Date.parse(payload.timestamp_generation)) &&
    typeof metadata?.session_id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(metadata.session_id) &&
    typeof metadata.sequence === "string" && /^[1-9]\d*$/.test(metadata.sequence) &&
    Number.isFinite(metadata.game_time) && metadata.game_time >= 0;
}

/** Batyskaf arm protocol: one decision per request, one request in flight. */
export class ChoiceHttpClient {
  constructor(config, {
    storage = browserStorage(),
    fetchImpl = (...args) => globalThis.fetch(...args),
    now = () => Date.now(),
    setTimer = (...args) => globalThis.setTimeout(...args),
    clearTimer = (id) => globalThis.clearTimeout(id),
    reportError = (message) => console.error(message),
  } = {}) {
    this.config = { ...config };
    this.storage = storage;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.reportError = reportError;
    this.pending = new Map();
    this.sessionId = "";
    this.nextSequence = 1;
    this.inFlight = false;
    this.retryTimer = null;
    this.stopped = false;
    this.controller = null;
    if (isChoiceHttpConfigured(this.config)) {
      this.loadOutbox();
      this.pump();
    }
  }

  startSession(sessionId = globalThis.crypto.randomUUID()) {
    this.sessionId = sessionId;
    this.nextSequence = 1;
    if (!isChoiceHttpConfigured(this.config)) {
      this.reportError("Gold Miner: HTTP decisions unavailable. Configure ChoiceUrl, ChoicePlayerId and a runtime API key. Decisions are still logged locally.");
    }
    return sessionId;
  }

  enqueue({ decision, elapsedMs, timestampGeneration }) {
    if (this.stopped || !this.sessionId || !isChoiceHttpConfigured(this.config)) return;
    if ((decision !== 0 && decision !== 1) || !Number.isFinite(elapsedMs) || elapsedMs < 0) return;
    const payload = {
      bit: decision,
      timestamp_generation: timestampGeneration ?? new Date(this.now()).toISOString(),
      metadata: {
        session_id: this.sessionId,
        sequence: String(this.nextSequence++),
        game_time: elapsedMs / 1000,
      },
    };
    if (!isPayload(payload)) return;
    const key = `${CHOICE_OUTBOX_PREFIX}${this.sessionId}_${payload.metadata.sequence}`;
    const record = {
      endpoint: this.config.endpoint,
      game_id: this.config.gameId,
      player_id: this.config.playerId,
      payload,
    };
    const entry = { key, record, body: JSON.stringify(payload), attempts: 0, nextAttemptAt: 0, blocked: false, delivered: false, persisted: false };
    entry.persisted = this.persist(entry);
    this.pending.set(key, entry);
    this.pump();
  }

  persist(entry) {
    try {
      if (!this.storage) throw new Error("storage unavailable");
      this.storage.setItem(entry.key, JSON.stringify(entry.record));
      return true;
    } catch {
      this.reportError("Gold Miner: could not persist an HTTP decision. Keeping it in memory and retrying persistence before transmission.");
      return false;
    }
  }

  loadOutbox() {
    try {
      if (!this.storage) return;
      for (let index = 0; index < this.storage.length; index += 1) {
        const key = this.storage.key(index);
        if (!key?.startsWith(CHOICE_OUTBOX_PREFIX)) continue;
        let record;
        try { record = JSON.parse(this.storage.getItem(key)); } catch { continue; }
        if (record?.endpoint !== this.config.endpoint || record.game_id !== this.config.gameId ||
          record.player_id !== this.config.playerId || !isPayload(record.payload)) continue;
        const metadata = record.payload.metadata;
        if (key !== `${CHOICE_OUTBOX_PREFIX}${metadata.session_id}_${metadata.sequence}`) continue;
        this.pending.set(key, {
          key, record, body: JSON.stringify(record.payload), attempts: 0,
          nextAttemptAt: 0, blocked: false, delivered: false, persisted: true,
        });
      }
    } catch {
      this.reportError("Gold Miner: could not read the HTTP outbox. Existing records have not been removed.");
    }
  }

  removeDelivered(entry) {
    try {
      this.storage.removeItem(entry.key);
      this.pending.delete(entry.key);
    } catch {
      // Do not POST again after an ACK when only local cleanup failed.
      entry.nextAttemptAt = this.now() + RETRY_BASE_MS;
    }
  }

  pump() {
    if (this.stopped || this.inFlight || !isChoiceHttpConfigured(this.config)) return;
    if (this.retryTimer !== null) {
      this.clearTimer(this.retryTimer);
      this.retryTimer = null;
    }
    const now = this.now();
    for (const entry of this.pending.values()) {
      if (entry.delivered && entry.nextAttemptAt <= now) this.removeDelivered(entry);
    }
    const ready = [...this.pending.values()].filter((entry) =>
      !entry.blocked && !entry.delivered && entry.nextAttemptAt <= now
    ).sort((left, right) => {
      const time = left.record.payload.timestamp_generation.localeCompare(right.record.payload.timestamp_generation);
      if (time) return time;
      const a = left.record.payload.metadata;
      const b = right.record.payload.metadata;
      return a.session_id === b.session_id ? Number(a.sequence) - Number(b.sequence) : a.session_id.localeCompare(b.session_id);
    });
    if (ready.length) {
      void this.send(ready[0]);
      return;
    }
    const waiting = [...this.pending.values()].filter((entry) => !entry.blocked);
    if (waiting.length) {
      const next = waiting.reduce((earliest, entry) => Math.min(earliest, entry.nextAttemptAt), Infinity);
      this.retryTimer = this.setTimer(() => {
        this.retryTimer = null;
        this.pump();
      }, Math.max(0, next - this.now()));
    }
  }

  retry(entry) {
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(entry.attempts - 1, 8));
    entry.nextAttemptAt = this.now() + delay;
  }

  async send(entry) {
    this.inFlight = true;
    entry.attempts += 1;
    let timeout = null;
    try {
      if (!entry.persisted) {
        entry.persisted = this.persist(entry);
        if (!entry.persisted) { this.retry(entry); return; }
      }
      const controller = new AbortController();
      this.controller = controller;
      timeout = this.setTimer(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const response = await this.fetchImpl(this.config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Game-ID": this.config.gameId,
          "X-Player-ID": this.config.playerId,
          "X-API-Key": this.config.apiKey,
        },
        body: entry.body,
        signal: controller.signal,
        keepalive: true,
        credentials: "omit",
        redirect: "error",
      });
      if (this.stopped) return;
      if (response.status >= 200 && response.status < 300) {
        entry.delivered = true;
        this.removeDelivered(entry);
      } else if (response.status >= 400 && response.status < 500 &&
        response.status !== 408 && response.status !== 429) {
        entry.blocked = true;
        this.reportError(`Gold Miner: decision blocked by HTTP ${response.status}. Retained locally; fix configuration/server and reload.`);
      } else {
        this.retry(entry);
      }
    } catch {
      if (!this.stopped) this.retry(entry);
    } finally {
      if (timeout !== null) this.clearTimer(timeout);
      this.controller = null;
      this.inFlight = false;
      this.pump();
    }
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer !== null) this.clearTimer(this.retryTimer);
    this.controller?.abort();
  }
}
