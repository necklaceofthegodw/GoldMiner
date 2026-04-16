import { GAME_LEVELS, createSeededRandom, generateLevel } from "./levels";
import { GAME_ICON_SOURCES } from "./iconSources";

export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;
export const GROUND_Y = 108;
const HUD_PANEL_Y = 10;
const HUD_PANEL_HEIGHT = 80;
const HOOK_ORIGIN_Y = 82;
const HOOK_END_ANGLE = 1.12 + (10 * Math.PI) / 180;
const HUD_MONEY_TARGET_X = 136;
const HUD_MONEY_TARGET_Y = 44;

const SAVE_VERSION = 2;
const MAX_LEVEL = GAME_LEVELS.length;
const HOOK_ICON_SIZE = 24;
const CARRIED_ITEM_Y_OFFSET = 12;
const ICON_SOURCES = GAME_ICON_SOURCES;
const iconCache = new Map();

const DEFAULT_UPGRADES = {
  turboWinch: 0,
  precisionClaw: 0,
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
    shopIcon: "https://cdn-icons-png.flaticon.com/512/4721/4721089.png",
    baseCost: 320,
    costStep: 220,
    maxLevel: 3,
  },
  {
    id: "precisionClaw",
    name: "Precision Claw",
    description: "Permanent: hook hit radius +1.4 per level.",
    category: "upgrade",
    shopIcon: "/assets/icons/claw-machine.png",
    baseCost: 300,
    costStep: 200,
    maxLevel: 3,
  },
  {
    id: "mysteryScanner",
    name: "Mystery Scanner",
    description: "Permanent: mystery crates roll stronger outcomes.",
    category: "upgrade",
    shopIcon: "/assets/icons/mystery-crate.svg",
    baseCost: 280,
    costStep: 210,
    maxLevel: 3,
  },
  {
    id: "timeBoost",
    name: "Pocket Battery",
    description: "Consumable: next level starts with +10s.",
    category: "consumable",
    shopIcon: "https://cdn-icons-png.flaticon.com/512/17742/17742561.png",
    cost: 260,
  },
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const roundToTen = (value) => Math.round(value / 10) * 10;
const getNowMs = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
const getChronoCoreRefund = (level) => {
  const safeLevel = clamp(level, 0, 3);
  if (safeLevel <= 0) return 0;
  return safeLevel * 340 + ((safeLevel - 1) * safeLevel * 260) / 2;
};

function emitAudio(engine, eventId) {
  engine.audioEvents.push(eventId);
}

function addMoneyFlyup(engine, amount, startX, startY) {
  const safeAmount = Math.max(0, Math.round(Number(amount) || 0));
  engine.moneyFlyups.push({
    amount: safeAmount,
    startX,
    startY,
    targetX: HUD_MONEY_TARGET_X,
    targetY: HUD_MONEY_TARGET_Y,
    age: 0,
    duration: 1.48,
    arcHeight: 22,
  });
}

function getIconState(iconId) {
  if (!ICON_SOURCES[iconId]) return null;
  const existing = iconCache.get(iconId);
  if (existing) return existing;

  const image = new Image();
  const state = {
    image,
    status: "loading",
  };
  image.onload = () => {
    state.status = "ready";
  };
  image.onerror = () => {
    state.status = "error";
  };
  image.src = ICON_SOURCES[iconId];
  iconCache.set(iconId, state);
  return state;
}

function drawIcon(ctx, iconId, x, y, width, height, rotation = 0) {
  const state = getIconState(iconId);
  if (!state || state.status !== "ready") return false;

  ctx.save();
  ctx.translate(x, y);
  if (rotation !== 0) ctx.rotate(rotation);
  ctx.drawImage(state.image, -width * 0.5, -height * 0.5, width, height);
  ctx.restore();
  return true;
}

function createHook(upgrades = DEFAULT_UPGRADES) {
  return {
    originX: GAME_WIDTH / 2,
    originY: HOOK_ORIGIN_Y,
    baseLength: 24,
    length: 24,
    angle: 0,
    minAngle: -HOOK_END_ANGLE,
    maxAngle: HOOK_END_ANGLE,
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
  const decision = value === 1 ? 1 : 0;
  const elapsedMs = Math.max(0, Math.round(getNowMs() - engine.sessionStartedAtMs));
  engine.decisions.push(decision);
  engine.decisionEvents.push({ elapsedMs, decision });
  if (decision === 1) engine.oneDecisions += 1;
  if (decision === 0) engine.zeroDecisions += 1;
}

function createShopDecisionMap() {
  const map = {};
  for (const item of SHOP_ITEMS) {
    map[item.id] = 0;
  }
  return map;
}

function pushShopDecisions(engine) {
  for (const item of SHOP_ITEMS) {
    const purchased = (engine.shopPurchases[item.id] ?? 0) > 0;
    pushDecision(engine, purchased ? 1 : 0);
  }
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

function updateMoneyFlyups(engine, dt) {
  if (engine.moneyFlyups.length === 0) return;
  for (const flyup of engine.moneyFlyups) {
    flyup.age += dt;
  }
  engine.moneyFlyups = engine.moneyFlyups.filter((flyup) => flyup.age < flyup.duration);
}

function resolveHookReturn(engine) {
  const hook = engine.hook;
  const target = getItemById(engine.items, hook.targetId);

  if (target) {
    target.captured = true;

    if (target.kind === "gold") {
      engine.money += target.value;
      addMoneyFlyup(engine, target.value, target.x, target.y);
      engine.stats.goldCaught += 1;
      pushDecision(engine, 1);
      setMessage(engine, `Gold secured: +$${target.value}`, "good");
      emitAudio(engine, "gold");
    } else if (target.kind === "diamond") {
      engine.money += target.value;
      addMoneyFlyup(engine, target.value, target.x, target.y);
      engine.stats.diamondCaught += 1;
      pushDecision(engine, 1);
      setMessage(engine, `Diamond captured: +$${target.value}`, "good");
      emitAudio(engine, "diamond");
    } else if (target.kind === "mystery") {
      engine.stats.mysteryCaught += 1;
      pushDecision(engine, 1);
      const mystery = rollMystery(engine, target.value);
      engine.money += mystery.money;
      addMoneyFlyup(engine, mystery.money, target.x, target.y);
      engine.timeLeft = clamp(engine.timeLeft + mystery.time, 0, 110);
      setMessage(engine, `${mystery.text}${mystery.money > 0 ? ` +$${mystery.money}` : ""}`, mystery.tone);
      emitAudio(engine, "mystery");
    } else if (target.kind === "rock") {
      engine.money += target.value;
      addMoneyFlyup(engine, target.value, target.x, target.y);
      engine.stats.rockCaught += 1;
      pushDecision(engine, 0);
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
    engine.shopPurchases = createShopDecisionMap();
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
      pushDecision(engine, 0);
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
      target.y = tip.y + CARRIED_ITEM_Y_OFFSET;
    }

    if (hook.length <= hook.baseLength) {
      resolveHookReturn(engine);
    }
  }
}

function drawBackground(ctx) {
  const skyGradient = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  skyGradient.addColorStop(0, "#ffe267");
  skyGradient.addColorStop(1, "#f4c839");
  ctx.fillStyle = skyGradient;
  ctx.fillRect(0, 0, GAME_WIDTH, GROUND_Y);

  const dirtGradient = ctx.createLinearGradient(0, GROUND_Y, 0, GAME_HEIGHT);
  dirtGradient.addColorStop(0, "#8a5a2f");
  dirtGradient.addColorStop(0.7, "#5f3a1a");
  dirtGradient.addColorStop(1, "#3f2411");
  ctx.fillStyle = dirtGradient;
  ctx.fillRect(0, GROUND_Y, GAME_WIDTH, GAME_HEIGHT - GROUND_Y);

  ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
  for (let i = 0; i < 32; i += 1) {
    const x = (i * 97) % GAME_WIDTH;
    const y = GROUND_Y + ((i * 61) % (GAME_HEIGHT - GROUND_Y));
    ctx.fillRect(x, y, 2, 2);
  }
}

function drawGold(ctx, item) {
  const iconDrawn = drawIcon(ctx, "gold", item.x, item.y, item.radius * 2.5, item.radius * 2.5);
  if (iconDrawn) return;

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
  const iconDrawn = drawIcon(ctx, "diamond", item.x, item.y, item.radius * 1.3, item.radius * 1.3);
  if (iconDrawn) return;

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
  const iconDrawn = drawIcon(ctx, "mystery", item.x, item.y, item.radius * 2.6, item.radius * 2.6);
  if (iconDrawn) return;

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
  const iconDrawn = drawIcon(ctx, "rock", item.x, item.y, item.radius * 2.4, item.radius * 2.1);
  if (iconDrawn) return;

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
  ctx.strokeStyle = "rgba(23, 27, 36, 0.92)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(hook.originX, hook.originY);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();

  ctx.strokeStyle = "rgba(250, 246, 229, 0.8)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(hook.originX, hook.originY);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();

  ctx.fillStyle = "#f1f5f9";
  ctx.beginPath();
  ctx.arc(hook.originX, hook.originY, 6.5, 0, Math.PI * 2);
  ctx.fill();

  const hookIconDrawn = drawIcon(
    ctx,
    "hook",
    tip.x,
    tip.y,
    HOOK_ICON_SIZE,
    HOOK_ICON_SIZE,
    -hook.angle
  );
  if (!hookIconDrawn) {
    ctx.save();
    ctx.translate(tip.x, tip.y);
    ctx.rotate(hook.angle);

    ctx.strokeStyle = "#2d3645";
    ctx.fillStyle = "#e6edf5";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const clawSpread = 6.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-clawSpread, 10);
    ctx.moveTo(0, 0);
    ctx.lineTo(clawSpread, 10);
    ctx.stroke();
    ctx.restore();
  }
}

function drawInlineStat(ctx, label, value, x, y, labelColor, valueColor) {
  ctx.font = "700 17px Trebuchet MS, Segoe UI, sans-serif";
  ctx.fillStyle = labelColor;
  ctx.fillText(label, x, y);
  const labelWidth = ctx.measureText(label).width;
  ctx.fillStyle = valueColor;
  ctx.fillText(value, x + labelWidth + 7, y);
}

function drawMinerAvatar(ctx, centerX, centerY, radius) {
  const frameGradient = ctx.createLinearGradient(centerX, centerY - radius, centerX, centerY + radius);
  frameGradient.addColorStop(0, "#1e57cf");
  frameGradient.addColorStop(1, "#143389");
  ctx.fillStyle = frameGradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(253, 213, 98, 0.7)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius - 3, 0, Math.PI * 2);
  ctx.clip();

  ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
  ctx.fillRect(centerX - 60, centerY + 18, 120, 28);

  ctx.fillStyle = "#6b4225";
  ctx.fillRect(centerX - 21, centerY + 6, 36, 24);

  ctx.fillStyle = "#a8b1bb";
  ctx.fillRect(centerX - 30, centerY + 10, 46, 10);

  ctx.fillStyle = "#434d59";
  ctx.beginPath();
  ctx.arc(centerX - 7, centerY + 15, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(centerX + 8, centerY + 15, 9, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#e1e8ef";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(centerX - 7, centerY + 15, 4, 0, Math.PI * 2);
  ctx.arc(centerX + 8, centerY + 15, 4, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#6a3d1f";
  ctx.beginPath();
  ctx.ellipse(centerX + 8, centerY - 3, 12, 16, -0.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#eaaf73";
  ctx.beginPath();
  ctx.ellipse(centerX - 4, centerY - 16, 12, 14, 0.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f6d35a";
  ctx.beginPath();
  ctx.ellipse(centerX - 2, centerY - 22, 14, 8, -0.08, Math.PI, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#5e3f05";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(centerX - 18, centerY - 22);
  ctx.lineTo(centerX + 8, centerY - 22);
  ctx.stroke();

  ctx.fillStyle = "#f1d7b8";
  ctx.beginPath();
  ctx.ellipse(centerX - 12, centerY - 17, 4.5, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f8fbff";
  ctx.fillRect(centerX + 15, centerY + 9, 12, 5);
  ctx.restore();
}

function drawCanvasHud(ctx, engine) {
  const avatarY = HUD_PANEL_Y + HUD_PANEL_HEIGHT - 3;

  const leftLabelColor = "#65410b";
  drawInlineStat(ctx, "Current", `$${engine.money}`, 34, 44, leftLabelColor, "#00892f");
  drawInlineStat(ctx, "Vault", `$${engine.bank}`, 205, 44, leftLabelColor, "#0f5ca8");
  drawInlineStat(ctx, "Goal", `$${engine.goal}`, 34, 76, leftLabelColor, "#b35e00");

  const rightX = GAME_WIDTH - 34;
  ctx.textAlign = "right";
  ctx.font = "700 17px Trebuchet MS, Segoe UI, sans-serif";
  ctx.fillStyle = engine.timeLeft < 11 ? "#cf1f1f" : leftLabelColor;
  ctx.fillText(`Time: ${Math.ceil(engine.timeLeft)}`, rightX, 44);
  ctx.fillStyle = leftLabelColor;
  ctx.fillText(`Level: ${engine.levelIndex + 1}`, rightX, 76);
  ctx.textAlign = "left";

  drawMinerAvatar(ctx, GAME_WIDTH / 2, avatarY, 46);
}

function drawMoneyFlyups(ctx, engine) {
  if (engine.moneyFlyups.length === 0) return;

  for (const flyup of engine.moneyFlyups) {
    const t = clamp(flyup.age / flyup.duration, 0, 1);
    const eased = t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
    const x = flyup.startX + (flyup.targetX - flyup.startX) * eased;
    const y =
      flyup.startY +
      (flyup.targetY - flyup.startY) * eased -
      Math.sin(Math.PI * t) * flyup.arcHeight;
    const alpha = t < 0.86 ? 1 : 1 - (t - 0.86) / 0.14;
    const scale = 1 - t * 0.16;

    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.font = "800 24px Trebuchet MS, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(30, 18, 8, 0.55)";
    ctx.fillStyle = flyup.amount > 0 ? "#ffe06e" : "#e4e6ea";
    const text = `$${flyup.amount}`;
    ctx.strokeText(text, 0, 0);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}

function drawOverlay(ctx, engine) {
  if (engine.phase === "playing") return;

  ctx.fillStyle = "rgba(8, 15, 23, 0.48)";
  ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
  ctx.fillStyle = "#f8fafc";
  ctx.font = "700 38px Trebuchet MS, Segoe UI, sans-serif";

  const title =
    engine.phase === "menu"
      ? "Gold Miner"
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
  let bonusTime = 0;
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
    moneyFlyups: [],
    oneDecisions: 0,
    zeroDecisions: 0,
    decisions: [],
    decisionEvents: [],
    sessionStartedAtMs: getNowMs(),
    shopPurchases: createShopDecisionMap(),
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

  const legacyChronoCoreLevel = clamp(Number(saveData?.upgrades?.chronoCore) || 0, 0, 3);
  const legacyChronoRefund = getChronoCoreRefund(legacyChronoCoreLevel);

  engine.maxUnlockedLevel = clamp(
    Number(saveData.maxUnlockedLevel) || 1,
    1,
    MAX_LEVEL
  );
  engine.bank = Math.max(0, Number(saveData.bank) || 0) + legacyChronoRefund;
  engine.upgrades = {
    turboWinch: clamp(Number(saveData?.upgrades?.turboWinch) || 0, 0, 3),
    precisionClaw: clamp(Number(saveData?.upgrades?.precisionClaw) || 0, 0, 3),
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
  engine.moneyFlyups = [];
  engine.oneDecisions = 0;
  engine.zeroDecisions = 0;
  engine.decisions = [];
  engine.shopPurchases = createShopDecisionMap();
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
  engine.moneyFlyups = [];
  engine.oneDecisions = 0;
  engine.zeroDecisions = 0;
  engine.decisions = [];
  engine.shopPurchases = createShopDecisionMap();
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
    pushShopDecisions(engine);
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
  engine.shopPurchases[item.id] = (engine.shopPurchases[item.id] ?? 0) + 1;

  engine.bank -= cost;
  setMessage(engine, `${item.name} purchased for $${cost}.`, "good");
  emitAudio(engine, "shop-buy");
  return { ok: true };
}

export function openMenu(engine) {
  engine.phase = "menu";
  engine.pendingNextLevel = null;
  engine.shopPurchases = createShopDecisionMap();
  engine.hook = createHook(engine.upgrades);
  engine.items = [];
  engine.moneyFlyups = [];
  setMessage(engine, "Pick a level and start mining.", "neutral");
}

export function updateEngine(engine, dt) {
  const step = clamp(dt, 0, 0.05);
  updateMoneyFlyups(engine, step);
  if (engine.phase !== "playing") return;
  engine.timeLeft = clamp(engine.timeLeft - step, 0, 140);
  updateHook(engine, step);

  if (engine.timeLeft <= 0) {
    finishLevel(engine);
  }
}

export function drawEngine(ctx, engine) {
  ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
  drawBackground(ctx);
  drawCanvasHud(ctx, engine);
  drawItems(ctx, engine.items);
  drawHook(ctx, engine.hook);
  drawMoneyFlyups(ctx, engine);
  drawOverlay(ctx, engine);
}

export function consumeAudioEvents(engine) {
  if (engine.audioEvents.length === 0) return [];
  const events = [...engine.audioEvents];
  engine.audioEvents.length = 0;
  return events;
}

export function consumeDecisionEvents(engine) {
  if (engine.decisionEvents.length === 0) return [];
  const events = [...engine.decisionEvents];
  engine.decisionEvents.length = 0;
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
