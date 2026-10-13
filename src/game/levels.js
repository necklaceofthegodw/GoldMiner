const LEVEL_TARGETS = [500, 700, 900, 1200, 1500, 1900, 2400, 3000, 3700, 4500, 5500, 7200];
const ROCK_DENSITY = [
  "Low",
  "Low",
  "Medium",
  "Medium",
  "Medium+",
  "Medium+",
  "High",
  "High",
  "High+",
  "High+",
  "Very High",
  "Extreme",
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const roundToStep = (value, step = 10) => Math.round(value / step) * step;

export const GAME_LEVELS = LEVEL_TARGETS.map((goal, index) => ({
  level: index + 1,
  goal,
  goldTotal: goal,
  zeroGroupTotal: goal,
  rocks: ROCK_DENSITY[index],
}));

export function createSeededRandom(seed) {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;

  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function splitTotal(total, count, variation, rng, step = 10) {
  if (count <= 0) return [];
  const minimum = step;
  const normalizedTotal = Math.max(total, minimum * count);
  const weights = Array.from({ length: count }, () => 1 + (rng() * 2 - 1) * variation);
  const weightSum = weights.reduce((sum, value) => sum + value, 0);
  const values = weights.map((weight) => Math.max(minimum, roundToStep((normalizedTotal * weight) / weightSum, step)));

  let current = values.reduce((sum, value) => sum + value, 0);
  let difference = normalizedTotal - current;
  let safety = 0;

  while (difference !== 0 && safety < 2000) {
    const index = Math.floor(rng() * values.length);
    if (difference > 0) {
      values[index] += step;
      difference -= step;
    } else if (values[index] - step >= minimum) {
      values[index] -= step;
      difference += step;
    }
    safety += 1;
  }

  current = values.reduce((sum, value) => sum + value, 0);
  const finalDifference = normalizedTotal - current;
  if (finalDifference !== 0) {
    values[0] += finalDifference;
  }

  return values;
}

function canPlace(existingItems, candidate, padding) {
  return existingItems.every((item) => {
    const dx = item.x - candidate.x;
    const dy = item.y - candidate.y;
    const spacing = item.radius + candidate.radius + padding;
    return dx * dx + dy * dy > spacing * spacing;
  });
}

export function generateLevel(levelNumber, width, height, groundY = 108) {
  const blueprint = GAME_LEVELS[levelNumber - 1] ?? GAME_LEVELS[0];
  const progress = (blueprint.level - 1) / (GAME_LEVELS.length - 1);
  const rng = createSeededRandom(12731 + blueprint.level * 977);

  const goldCount = clamp(Math.round(6 - progress * 2.6), 3, 6);
  const diamondCount = clamp(2 + Math.floor(blueprint.level / 2), 2, 8);
  const mysteryCount = clamp(2 + Math.floor((blueprint.level - 1) / 3), 2, 5);
  const rockCount = Math.round(4 + progress * 20);

  const diamondShare = 0.58 + progress * 0.1;
  const diamondTotal = roundToStep(blueprint.goal * diamondShare, 10);
  const mysteryAverageTotal = blueprint.goal - diamondTotal;

  const goldValues = splitTotal(blueprint.goal, goldCount, 0.3, rng, 10);
  const diamondValues = splitTotal(diamondTotal, diamondCount, 0.35, rng, 10);
  const mysteryAverageValues = splitTotal(mysteryAverageTotal, mysteryCount, 0.4, rng, 10);

  let idSeed = 0;
  const itemDefs = [];

  for (let index = 0; index < goldValues.length; index += 1) {
    const radius = 16 + progress * 14 + rng() * 8;
    itemDefs.push({
      id: `item-${idSeed += 1}`,
      kind: "gold",
      value: goldValues[index],
      binaryValue: 1,
      radius,
      pullWeight: 1.5 + radius / 24,
    });
  }

  for (let index = 0; index < diamondValues.length; index += 1) {
    const radius = 12 - progress * 4 + rng() * 2;
    itemDefs.push({
      id: `item-${idSeed += 1}`,
      kind: "diamond",
      value: diamondValues[index],
      binaryValue: 0,
      radius,
      pullWeight: 1.2 + radius / 28,
    });
  }

  for (let index = 0; index < mysteryAverageValues.length; index += 1) {
    const radius = 11 - progress * 1.5 + rng() * 3;
    itemDefs.push({
      id: `item-${idSeed += 1}`,
      kind: "mystery",
      value: mysteryAverageValues[index],
      binaryValue: 0,
      radius,
      pullWeight: 1.35 + radius / 30,
    });
  }

  for (let index = 0; index < rockCount; index += 1) {
    const radius = 10 + rng() * (10 + progress * 10);
    const chance = rng();
    const value = chance > 0.8 ? 20 : chance > 0.45 ? 10 : 0;
    itemDefs.push({
      id: `item-${idSeed += 1}`,
      kind: "rock",
      value,
      binaryValue: null,
      radius,
      pullWeight: 1.9 + radius / 20,
    });
  }

  itemDefs.sort((a, b) => b.radius - a.radius);

  const placed = [];
  const leftBound = 26;
  const rightBound = width - 26;
  const bottomBound = height - 18;

  for (const definition of itemDefs) {
    let accepted = null;
    const basePadding = definition.kind === "rock" ? 6 : 10;

    for (let attempt = 0; attempt < 420; attempt += 1) {
      let minY = groundY + 20;
      let maxY = bottomBound;

      if (definition.kind === "rock") {
        const topScreenChance = progress > 0.55 ? 0.35 : 0.18;
        if (rng() < topScreenChance) {
          minY = groundY + 20;
          maxY = groundY + 128 + progress * 20;
        }
      } else {
        minY = groundY + 54 + progress * 76;
        if (definition.kind === "diamond") minY += 12;
        if (definition.kind === "gold") minY -= 14;
      }

      minY = clamp(minY, groundY + 18, height - 80);
      maxY = clamp(maxY, minY + 20, bottomBound);

      const candidate = {
        ...definition,
        x: leftBound + rng() * (rightBound - leftBound),
        y: minY + rng() * (maxY - minY),
      };

      const padding = attempt < 250 ? basePadding : attempt < 340 ? basePadding * 0.5 : 1;
      if (canPlace(placed, candidate, padding)) {
        accepted = candidate;
        break;
      }
    }

    if (!accepted) {
      accepted = {
        ...definition,
        x: leftBound + rng() * (rightBound - leftBound),
        y: groundY + 30 + rng() * (bottomBound - groundY - 30),
      };
    }

    placed.push(accepted);
  }

  return {
    level: blueprint.level,
    goal: blueprint.goal,
    timeLimit: 60,
    economy: {
      goldTotal: blueprint.goal,
      zeroGroupTotal: blueprint.goal,
      rockDensity: blueprint.rocks,
      goldCount,
      diamondCount,
      mysteryCount,
      rockCount,
    },
    items: placed,
  };
}
