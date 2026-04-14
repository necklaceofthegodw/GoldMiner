import { GAME_LEVELS, createSeededRandom, generateLevel } from "./levels";

export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;
export const GROUND_Y = 108;

const SAVE_VERSION = 1;
const MAX_LEVEL = GAME_LEVELS.length;

const DEFAULT_UPGRADES = {
  turboWinch: 0,
  precisionClaw: 0,
  chronoCore: 0,
  mysteryScanner: 0,
};

const DEFAULT_INVENTORY = {
  timeBoost: 0,
};

const DEFAULT_STATS = {
  totalRuns: 0,
  totalWins: 0,
  totalEarned: 0,
  goldCaught: 0,
  diamondCaught: 0,
  mysteryCaught: 0,
  rockCaught: 0,
};

export const SHOP_ITEMS = [
  {
    id: "turboWinch",
    name: "Turbo Winch",
    description: "Permanent: hook retract speed +12% per level.",
    category: "upgrade",
    baseCost: 320,
    costStep: 220,
    maxLevel: 3,
  },
  {
    id: "precisionClaw",
    name: "Precision Claw",
    description: "Permanent: hook hit radius +1.4 per level.",
    category: "upgrade",
    baseCost: 300,
    costStep: 200,
    maxLevel: 3,
  },
  {
    id: "chronoCore",
    name: "Chrono Core",
    description: "Permanent: level start timer +3s per level.",
    category: "upgrade",
    baseCost: 340,
    costStep: 260,
    maxLevel: 3,
  },
  {
    id: "mysteryScanner",
    name: "Mystery Scanner",
    description: "Permanent: mystery crates roll stronger outcomes.",
    category: "upgrade",
    baseCost: 280,
    costStep: 210,
    maxLevel: 3,
  },
  {
    id: "timeBoost",
    name: "Pocket Battery",
    description: "Consumable: next level starts with +10s.",
    category: "consumable",
    cost: 260,
  },
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const roundToTen = (value) => Math.round(value / 10) * 10;

function emitAudio(engine, eventId) {
  engine.audioEvents.push(eventId);
}

function createHook(upgrades = DEFAULT_UPGRADES) {
  return {
    originX: GAME_WIDTH / 2,
    originY: 46,
    baseLength: 28,
    length: 28,
    angle: 0,
    minAngle: -1.12,
    maxAngle: 1.12,
    swingDirection: 1,
    swingSpeed: 1.55,
    state: "swing",
    extendSpeed: 380,
    retractSpeed: 440 * (1 + upgrades.turboWinch * 0.12),
    maxLength: GAME_HEIGHT + 40,
    hitRadius: 8 + upgrades.precisionClaw * 1.4,
    targetId: null,
  };
}

function getHookTip(hook) {
  const x = hook.originX + Math.sin(hook.angle) * hook.length;
  const y = hook.originY + Math.cos(hook.angle) * hook.length;
  return { x, y };
}

function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function getItemById(items, id) {
  return items.find((item) => item.id === id) ?? null;
}

function pushDecision(engine, value) {
  engine.decisions.push(value);
  if (value === 1) engine.oneDecisions += 1;
  if (value === 0) engine.zeroDecisions += 1;
}

function setMessage(engine, text, tone = "neutral") {
  engine.message = text;
  engine.messageTone = tone;
}

function getShopItemCost(engine, item) {
  if (item.category === "consumable") return item.cost;
  const level = engine.upgrades[item.id];
  return item.baseCost + level * item.costStep;
}

function getShopCatalog(engine) {
  return SHOP_ITEMS.map((item) => {
    const level = item.category === "upgrade" ? engine.upgrades[item.id] : engine.inventory[item.id];
    const maxLevel = item.maxLevel ?? null;
    const cost = getShopItemCost(engine, item);
    const isMaxed = maxLevel !== null ? level >= maxLevel : false;

    return {
      ...item,
      level,
      maxLevel,
      cost,
      isMaxed,
      affordable: engine.bank >= cost && !isMaxed,
    };
  });
}

function findHookCollision(engine, tip) {
  let selected = null;
  let nearest = Number.POSITIVE_INFINITY;

  for (const item of engine.items) {
    if (item.captured) continue;
    const limit = item.radius + engine.hook.hitRadius;
    const hit = distanceSquared(item, tip) <= limit * limit;
    if (!hit) continue;

    const distanceFromOrigin = distanceSquared(item, { x: engine.hook.originX, y: engine.hook.originY });
    if (distanceFromOrigin < nearest) {
      nearest = distanceFromOrigin;
      selected = item;
    }
  }

  return selected;
}

function rollMystery(engine, averageValue) {
  const scanLevel = engine.upgrades.mysteryScanner;
  const luckMultiplier = 1 + scanLevel * 0.12;
  const roll = engine.random();
  const jackpotThreshold = 0.24 + scanLevel * 0.025;
  const normalThreshold = 0.6 + scanLevel * 0.05;
  const timeThreshold = 0.84 + scanLevel * 0.02;

  if (roll < jackpotThreshold) {
    return {
      money: roundToTen(averageValue * 2.6 * luckMultiplier),
      time: 0,
      text: "Mystery jackpot!",
      tone: "good",
    };
  }
  if (roll < normalThreshold) {
    return {
      money: roundToTen(averageValue * 0.8 * luckMultiplier),
      time: 0,
      text: "Mystery cache secured.",
      tone: "good",
    };
  }
  if (roll < timeThreshold) {
    return {
      money: roundToTen(averageValue * 0.55 * luckMultiplier),
      time: 5 + scanLevel,
      text: `Chrono shard: +${5 + scanLevel}s bonus.`,
      tone: "good",
    };
  }
  return {
    money: 0,
    time: 0,
    text: "Mystery crate was empty.",
    tone: "warn",
  };
}

function resolveHookReturn(engine) {
  const hook = engine.hook;
  const target = getItemById(engine.items, hook.targetId);

  if (target) {
    target.captured = true;

    if (target.kind === "gold") {
      engine.money += target.value;
      engine.stats.goldCaught += 1;
      pushDecision(engine, 1);
      setMessage(engine, `Gold secured: +$${target.value}`, "good");
      emitAudio(engine, "gold");
    } else if (target.kind === "diamond") {
      engine.money += target.value;
      engine.stats.diamondCaught += 1;
      pushDecision(engine, 0);
      setMessage(engine, `Diamond captured: +$${target.value}`, "good");
      emitAudio(engine, "diamond");
    } else if (target.kind === "mystery") {
      engine.stats.mysteryCaught += 1;
      pushDecision(engine, 0);
      const mystery = rollMystery(engine, target.value);
      engine.money += mystery.money;
      engine.timeLeft = clamp(engine.timeLeft + mystery.time, 0, 110);
      setMessage(engine, `${mystery.text}${mystery.money > 0 ? ` +$${mystery.money}` : ""}`, mystery.tone);
      emitAudio(engine, "mystery");
    } else if (target.kind === "rock") {
      engine.money += target.value;
      engine.stats.rockCaught += 1;
      setMessage(
        engine,
        target.value > 0 ? `Rock fragments sold: +$${target.value}` : "Rock snagged. No payout.",
        "warn"
      );
      emitAudio(engine, "rock");
    }
  }

  hook.targetId = null;
  hook.state = "swing";
  hook.length = hook.baseLength;
  engine.items = engine.items.filter((item) => !item.captured);
}

function finishLevel(engine) {
  const success = engine.money >= engine.goal;
  const levelNumber = engine.levelIndex + 1;
  engine.stats.totalRuns += 1;
  engine.stats.totalEarned += Math.max(0, engine.money);

  const reward = success ? roundToTen(engine.goal * 0.12 + engine.money * 0.24) : 0;
  if (success) {
    engine.bank += reward;
    engine.lastReward = reward;
    engine.stats.totalWins += 1;
  } else {
    engine.lastReward = 0;
  }

  const summary = {
    level: levelNumber,
    goal: engine.goal,
    earned: engine.money,
    reward,
    oneDecisions: engine.oneDecisions,
    zeroDecisions: engine.zeroDecisions,
    success,
  };
  const existingIndex = engine.history.findIndex((entry) => entry.level === levelNumber);
  if (existingIndex === -1) {
    engine.history.push(summary);
  } else {
    engine.history[existingIndex] = summary;
  }

  if (success) {
    engine.maxUnlockedLevel = Math.max(engine.maxUnlockedLevel, levelNumber + 1);
    if (levelNumber >= MAX_LEVEL) {
      engine.phase = "run-complete";
      setMessage(engine, `All 12 levels cleared. Vault bonus +$${reward}.`, "good");
      emitAudio(engine, "level-win");
      return;
    }
    engine.phase = "shop";
    engine.pendingNextLevel = clamp(levelNumber + 1, 1, MAX_LEVEL);
    setMessage(engine, `Target met. Vault +$${reward}. Upgrade before Level ${engine.pendingNextLevel}.`, "good");
    emitAudio(engine, "level-win");
  } else {
    engine.phase = "level-failed";
    engine.pendingNextLevel = null;
    setMessage(engine, "Target missed. Retry or return to menu.", "warn");
    emitAudio(engine, "level-lose");
  }
}

function updateHook(engine, dt) {
  const hook = engine.hook;
  if (hook.state === "swing") {
    hook.angle += hook.swingDirection * hook.swingSpeed * dt;
    if (hook.angle > hook.maxAngle) {
      hook.angle = hook.maxAngle;
      hook.swingDirection = -1;
    } else if (hook.angle < hook.minAngle) {
      hook.angle = hook.minAngle;
      hook.swingDirection = 1;
    }
    return;
  }

  if (hook.state === "extending") {
    hook.length += hook.extendSpeed * dt;
    const tip = getHookTip(hook);
    const hitBoundary = tip.x < 8 || tip.x > GAME_WIDTH - 8 || tip.y > GAME_HEIGHT - 8 || hook.length >= hook.maxLength;
    if (hitBoundary) {
      hook.state = "retracting";
      hook.targetId = null;
      return;
    }

    const hitItem = findHookCollision(engine, tip);
    if (hitItem) {
      hook.state = "retracting";
      hook.targetId = hitItem.id;
    }
    return;
  }

  if (hook.state === "retracting") {
    const target = hook.targetId ? getItemById(engine.items, hook.targetId) : null;
    const drag = target ? target.pullWeight : 1;
    hook.length -= (hook.retractSpeed / drag) * dt;

    const tip = getHookTip(hook);
    if (target) {
      target.x = tip.x;
      target.y = tip.y;
    }

    if (hook.length <= hook.baseLength) {
      resolveHookReturn(engine);
    }
  }
}

function drawBackground(ctx) {
  const skyGradient = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  skyGradient.addColorStop(0, "#f4f9ff");
  skyGradient.addColorStop(1, "#cfe7f2");
  ctx.fillStyle = skyGradient;
  ctx.fillRect(0, 0, GAME_WIDTH, GROUND_Y);

  const dirtGradient = ctx.createLinearGradient(0, GROUND_Y, 0, GAME_HEIGHT);
  dirtGradient.addColorStop(0, "#8a5a2f");
  dirtGradient.addColorStop(0.7, "#5f3a1a");
  dirtGradient.addColorStop(1, "#3f2411");
  ctx.fillStyle = dirtGradient;
  ctx.fillRect(0, GROUND_Y, GAME_WIDTH, GAME_HEIGHT - GROUND_Y);

  ctx.strokeStyle = "#d8b16d";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  ctx.lineTo(GAME_WIDTH, GROUND_Y);
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
  for (let i = 0; i < 32; i += 1) {
    const x = (i * 97) % GAME_WIDTH;
    const y = GROUND_Y + ((i * 61) % (GAME_HEIGHT - GROUND_Y));
    ctx.fillRect(x, y, 2, 2);
  }
}

function drawGold(ctx, item) {
  const gradient = ctx.createRadialGradient(item.x - item.radius * 0.25, item.y - item.radius * 0.35, 2, item.x, item.y, item.radius);
  gradient.addColorStop(0, "#fff5bf");
  gradient.addColorStop(1, "#e1ab18");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(item.x, item.y, item.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#8a5b08";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawDiamond(ctx, item) {
  ctx.fillStyle = "#8fe5ff";
  ctx.strokeStyle = "#2e6684";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(item.x, item.y - item.radius);
  ctx.lineTo(item.x + item.radius * 0.85, item.y);
  ctx.lineTo(item.x, item.y + item.radius);
  ctx.lineTo(item.x - item.radius * 0.85, item.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawMystery(ctx, item) {
  const size = item.radius * 1.75;
  const x = item.x - size * 0.5;
  const y = item.y - size * 0.45;
  ctx.fillStyle = "#e3c3ff";
  ctx.strokeStyle = "#5f387f";
  ctx.lineWidth = 2;
  ctx.fillRect(x, y, size, size * 0.8);
  ctx.strokeRect(x, y, size, size * 0.8);

  ctx.strokeStyle = "#7b3db0";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(item.x, y);
  ctx.lineTo(item.x, y + size * 0.8);
  ctx.moveTo(x, y + size * 0.4);
  ctx.lineTo(x + size, y + size * 0.4);
  ctx.stroke();
}

function drawRock(ctx, item) {
  ctx.fillStyle = "#948d82";
  ctx.strokeStyle = "#544b41";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(item.x, item.y, item.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(50, 40, 30, 0.3)";
  ctx.beginPath();
  ctx.arc(item.x - item.radius * 0.2, item.y - item.radius * 0.15, item.radius * 0.35, 0, Math.PI * 2);
  ctx.fill();
}

function drawItems(ctx, items) {
  for (const item of items) {
    if (item.kind === "gold") drawGold(ctx, item);
    if (item.kind === "diamond") drawDiamond(ctx, item);
    if (item.kind === "mystery") drawMystery(ctx, item);
    if (item.kind === "rock") drawRock(ctx, item);
  }
}

function drawHook(ctx, hook) {
  const tip = getHookTip(hook);
  ctx.strokeStyle = "#f1f5f9";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(hook.originX, hook.originY);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();

  ctx.fillStyle = "#e2e8f0";
  ctx.beginPath();
  ctx.arc(hook.originX, hook.originY, 10, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, 8, 0, Math.PI * 2);
  ctx.stroke();

  const clawSpread = 7;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - clawSpread, tip.y + 10);
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x + clawSpread, tip.y + 10);
  ctx.stroke();
}

function drawCanvasHud(ctx, engine) {
  const padding = 14;
  ctx.fillStyle = "rgba(11, 20, 29, 0.72)";
  ctx.fillRect(12, 12, GAME_WIDTH - 24, 46);

  ctx.fillStyle = "#f8fafc";
  ctx.font = "600 16px Trebuchet MS, Segoe UI, sans-serif";
  ctx.fillText(`Level ${engine.levelIndex + 1}/12`, 24, 41);
  ctx.fillText(`Time: ${Math.ceil(engine.timeLeft)}s`, 185, 41);
  ctx.fillText(`Goal: $${engine.goal}`, 322, 41);
  ctx.fillText(`Cash: $${engine.money}`, 485, 41);
  ctx.fillText(`Vault: $${engine.bank}`, 634, 41);

  const width = 170;
  const progress = clamp(engine.money / engine.goal, 0, 1);
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.fillRect(GAME_WIDTH - width - padding, 28, width, 12);
  ctx.fillStyle = progress >= 1 ? "#22c55e" : "#f59e0b";
  ctx.fillRect(GAME_WIDTH - width - padding, 28, width * progress, 12);
}

function drawOverlay(ctx, engine) {
  if (engine.phase === "playing") return;

  ctx.fillStyle = "rgba(8, 15, 23, 0.48)";
  ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
  ctx.fillStyle = "#f8fafc";
  ctx.font = "700 38px Trebuchet MS, Segoe UI, sans-serif";

  const title =
    engine.phase === "menu"
      ? "Binary Miner"
      : engine.phase === "shop"
        ? "Upgrade Shop"
        : engine.phase === "level-clear"
          ? "Level Cleared"
          : engine.phase === "level-failed"
            ? "Target Missed"
            : "Run Complete";
  const metrics = ctx.measureText(title);
  ctx.fillText(title, GAME_WIDTH / 2 - metrics.width / 2, GAME_HEIGHT / 2 - 20);

  ctx.font = "500 21px Trebuchet MS, Segoe UI, sans-serif";
  const subtitle = engine.message;
  const subtitleMetrics = ctx.measureText(subtitle);
  ctx.fillText(subtitle, GAME_WIDTH / 2 - subtitleMetrics.width / 2, GAME_HEIGHT / 2 + 24);
}

function applyInventoryStartBonuses(engine) {
  let bonusTime = engine.upgrades.chronoCore * 3;
  let consumed = false;

  if (engine.inventory.timeBoost > 0) {
    engine.inventory.timeBoost -= 1;
    bonusTime += 10;
    consumed = true;
  }

  return { bonusTime, consumed };
}

export function createEngine() {
  return {
    phase: "menu",
    levelIndex: 0,
    goal: GAME_LEVELS[0].goal,
    timeLimit: 60,
    timeLeft: 60,
    money: 0,
    bank: 0,
    hook: createHook(DEFAULT_UPGRADES),
    items: [],
    oneDecisions: 0,
    zeroDecisions: 0,
    decisions: [],
    message: "Pick a level and start mining.",
    messageTone: "neutral",
    maxUnlockedLevel: 1,
    pendingNextLevel: null,
    lastReward: 0,
    history: [],
    economy: null,
    random: Math.random,
    upgrades: { ...DEFAULT_UPGRADES },
    inventory: { ...DEFAULT_INVENTORY },
    stats: { ...DEFAULT_STATS },
    audioEvents: [],
    settings: {
      audioEnabled: true,
    },
  };
}

export function setAudioEnabled(engine, enabled) {
  engine.settings.audioEnabled = Boolean(enabled);
}

export function applySaveData(engine, saveData) {
  if (!saveData || typeof saveData !== "object") return;

  engine.maxUnlockedLevel = clamp(
    Number(saveData.maxUnlockedLevel) || 1,
    1,
    MAX_LEVEL
  );
  engine.bank = Math.max(0, Number(saveData.bank) || 0);
  engine.upgrades = {
    turboWinch: clamp(Number(saveData?.upgrades?.turboWinch) || 0, 0, 3),
    precisionClaw: clamp(Number(saveData?.upgrades?.precisionClaw) || 0, 0, 3),
    chronoCore: clamp(Number(saveData?.upgrades?.chronoCore) || 0, 0, 3),
    mysteryScanner: clamp(Number(saveData?.upgrades?.mysteryScanner) || 0, 0, 3),
  };
  engine.inventory = {
    timeBoost: clamp(Number(saveData?.inventory?.timeBoost) || 0, 0, 50),
  };
  engine.history = Array.isArray(saveData.history)
    ? saveData.history
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => ({
          level: clamp(Number(entry.level) || 1, 1, MAX_LEVEL),
          goal: Math.max(0, Number(entry.goal) || 0),
          earned: Math.max(0, Number(entry.earned) || 0),
          reward: Math.max(0, Number(entry.reward) || 0),
          oneDecisions: Math.max(0, Number(entry.oneDecisions) || 0),
          zeroDecisions: Math.max(0, Number(entry.zeroDecisions) || 0),
          success: Boolean(entry.success),
        }))
    : [];
  engine.stats = {
    totalRuns: Math.max(0, Number(saveData?.stats?.totalRuns) || 0),
    totalWins: Math.max(0, Number(saveData?.stats?.totalWins) || 0),
    totalEarned: Math.max(0, Number(saveData?.stats?.totalEarned) || 0),
    goldCaught: Math.max(0, Number(saveData?.stats?.goldCaught) || 0),
    diamondCaught: Math.max(0, Number(saveData?.stats?.diamondCaught) || 0),
    mysteryCaught: Math.max(0, Number(saveData?.stats?.mysteryCaught) || 0),
    rockCaught: Math.max(0, Number(saveData?.stats?.rockCaught) || 0),
  };
  engine.settings.audioEnabled = saveData?.settings?.audioEnabled !== false;
}

export function getSaveData(engine) {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    maxUnlockedLevel: engine.maxUnlockedLevel,
    bank: engine.bank,
    upgrades: { ...engine.upgrades },
    inventory: { ...engine.inventory },
    history: [...engine.history],
    stats: { ...engine.stats },
    settings: {
      audioEnabled: engine.settings.audioEnabled,
    },
  };
}

export function resetProgress(engine) {
  engine.phase = "menu";
  engine.levelIndex = 0;
  engine.goal = GAME_LEVELS[0].goal;
  engine.timeLimit = 60;
  engine.timeLeft = 60;
  engine.money = 0;
  engine.bank = 0;
  engine.hook = createHook(DEFAULT_UPGRADES);
  engine.items = [];
  engine.oneDecisions = 0;
  engine.zeroDecisions = 0;
  engine.decisions = [];
  engine.maxUnlockedLevel = 1;
  engine.pendingNextLevel = null;
  engine.lastReward = 0;
  engine.history = [];
  engine.economy = null;
  engine.random = Math.random;
  engine.upgrades = { ...DEFAULT_UPGRADES };
  engine.inventory = { ...DEFAULT_INVENTORY };
  engine.stats = { ...DEFAULT_STATS };
  setMessage(engine, "Progress reset. Pick a level and start mining.", "neutral");
}

export function startLevel(engine, levelNumber) {
  const requested = clamp(Number(levelNumber) || 1, 1, MAX_LEVEL);
  if (requested > engine.maxUnlockedLevel) {
    setMessage(engine, `Level ${requested} is locked. Clear previous levels first.`, "warn");
    emitAudio(engine, "error");
    return false;
  }

  const data = generateLevel(requested, GAME_WIDTH, GAME_HEIGHT, GROUND_Y);
  const bonuses = applyInventoryStartBonuses(engine);
  const timeLimit = data.timeLimit + bonuses.bonusTime;

  engine.levelIndex = data.level - 1;
  engine.goal = data.goal;
  engine.timeLimit = timeLimit;
  engine.timeLeft = timeLimit;
  engine.money = 0;
  engine.items = data.items.map((item) => ({ ...item, captured: false }));
  engine.hook = createHook(engine.upgrades);
  engine.oneDecisions = 0;
  engine.zeroDecisions = 0;
  engine.decisions = [];
  engine.phase = "playing";
  engine.pendingNextLevel = null;
  engine.economy = data.economy;
  engine.random = createSeededRandom(911 + data.level * 2017 + Date.now());
  engine.lastReward = 0;
  setMessage(
    engine,
    bonuses.consumed
      ? `Drop the hook to mine resources. Pocket Battery active (+10s).`
      : "Drop the hook to mine resources.",
    "neutral"
  );
  emitAudio(engine, "start-level");
  return true;
}

export function releaseHook(engine) {
  if (engine.phase !== "playing") return;
  if (engine.hook.state !== "swing") return;
  engine.hook.state = "extending";
  emitAudio(engine, "hook-launch");
}

export function retryLevel(engine) {
  startLevel(engine, engine.levelIndex + 1);
}

export function nextLevel(engine) {
  if (engine.phase === "shop" && engine.pendingNextLevel) {
    startLevel(engine, engine.pendingNextLevel);
    return;
  }
  const next = clamp(engine.levelIndex + 2, 1, MAX_LEVEL);
  startLevel(engine, next);
}

export function purchaseShopItem(engine, itemId) {
  const item = SHOP_ITEMS.find((candidate) => candidate.id === itemId);
  if (!item) return { ok: false, reason: "not-found" };

  const cost = getShopItemCost(engine, item);
  if (engine.bank < cost) {
    setMessage(engine, "Not enough vault cash for that upgrade.", "warn");
    emitAudio(engine, "error");
    return { ok: false, reason: "insufficient-funds" };
  }

  if (item.category === "upgrade") {
    const currentLevel = engine.upgrades[item.id];
    if (currentLevel >= item.maxLevel) {
      setMessage(engine, `${item.name} is already maxed.`, "warn");
      emitAudio(engine, "error");
      return { ok: false, reason: "maxed" };
    }
    engine.upgrades[item.id] += 1;
  } else {
    engine.inventory[item.id] += 1;
  }

  engine.bank -= cost;
  setMessage(engine, `${item.name} purchased for $${cost}.`, "good");
  emitAudio(engine, "shop-buy");
  return { ok: true };
}

export function openMenu(engine) {
  engine.phase = "menu";
  engine.pendingNextLevel = null;
  engine.hook = createHook(engine.upgrades);
  engine.items = [];
  setMessage(engine, "Pick a level and start mining.", "neutral");
}

export function updateEngine(engine, dt) {
  if (engine.phase !== "playing") return;
  const step = clamp(dt, 0, 0.05);
  engine.timeLeft = clamp(engine.timeLeft - step, 0, 140);
  updateHook(engine, step);

  if (engine.timeLeft <= 0) {
    finishLevel(engine);
  }
}

export function drawEngine(ctx, engine) {
  ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
  drawBackground(ctx);
  drawItems(ctx, engine.items);
  drawHook(ctx, engine.hook);
  drawCanvasHud(ctx, engine);
  drawOverlay(ctx, engine);
}

export function consumeAudioEvents(engine) {
  if (engine.audioEvents.length === 0) return [];
  const events = [...engine.audioEvents];
  engine.audioEvents.length = 0;
  return events;
}

export function getSnapshot(engine) {
  return {
    phase: engine.phase,
    level: engine.levelIndex + 1,
    totalLevels: MAX_LEVEL,
    goal: engine.goal,
    timeLimit: engine.timeLimit,
    timeLeft: engine.timeLeft,
    money: engine.money,
    bank: engine.bank,
    hookState: engine.hook.state,
    message: engine.message,
    messageTone: engine.messageTone,
    oneDecisions: engine.oneDecisions,
    zeroDecisions: engine.zeroDecisions,
    maxUnlockedLevel: engine.maxUnlockedLevel,
    pendingNextLevel: engine.pendingNextLevel,
    lastReward: engine.lastReward,
    history: [...engine.history].sort((a, b) => a.level - b.level),
    economy: engine.economy,
    upgrades: { ...engine.upgrades },
    inventory: { ...engine.inventory },
    shopCatalog: getShopCatalog(engine),
    stats: { ...engine.stats },
    settings: { ...engine.settings },
  };
}

export { GAME_LEVELS };
