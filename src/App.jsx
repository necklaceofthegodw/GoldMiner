import { useCallback, useEffect, useRef, useState } from "react";
import { createSoundEngine, playSoundBatch } from "./audio/sfx";
import {
  GAME_HEIGHT,
  GAME_WIDTH,
  applySaveData,
  consumeAudioEvents,
  consumeDecisionEvents,
  createEngine,
  drawEngine,
  getSaveData,
  getSnapshot,
  nextLevel,
  purchaseShopItem,
  releaseHook,
  resetProgress,
  startLevel,
  updateEngine,
} from "./game/engine";
import {
  appendDecisionEntries,
  startDecisionSession,
} from "./game/decisionLogClient";
import { GAME_ICON_SOURCES } from "./game/iconSources";
import { loadGameSave, saveGameSave } from "./game/storage";
import { createMinerNick } from "./game/minerIdentity.js";
import { getSlotStatus, readExperimentSlot, slotAllowsPlay } from "./game/experimentSlot.js";

function formatMoney(value) {
  return `$${Math.max(0, Math.round(value)).toLocaleString()}`;
}

function App() {
  const startMysteryIcon = GAME_ICON_SOURCES.mystery;
  const startGoldIcon = GAME_ICON_SOURCES.gold;
  const startDiamondIcon = GAME_ICON_SOURCES.diamond;
  const canvasRef = useRef(null);
  const summaryTimerRef = useRef(0);
  const startingRunRef = useRef(false);
  const experimentSummaryRef = useRef({ maxLevel: 0, money: 0 });
  const returningToPortalRef = useRef(false);
  const [experimentSummary, setExperimentSummary] = useState({ maxLevel: 0, money: 0 });
  const [slot] = useState(() => readExperimentSlot());
  const [slotStatus, setSlotStatus] = useState(() => getSlotStatus(slot));
  const [slotSeconds, setSlotSeconds] = useState(0);

  useEffect(() => {
    const sync = () => {
      const now = Date.now();
      setSlotStatus(getSlotStatus(slot, now));
      if (slot && !slot.invalid && now >= slot.stopAt) {
        const summary = experimentSummaryRef.current;
        setExperimentSummary((previous) => previous.maxLevel === summary.maxLevel && previous.money === summary.money ? previous : { ...summary });
      }
      if (slot && !slot.invalid && now >= slot.endAt) {
        if (!returningToPortalRef.current) {
          returningToPortalRef.current = true;
          window.location.replace(slot.portalEndpoint);
        }
        return;
      }
      if (slot && !slot.invalid) setSlotSeconds(Math.max(0, Math.ceil((slot.startAt - now) / 1000)));
    };
    sync();
    const timer = window.setInterval(sync, 100);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [slot]);

  const [engine] = useState(() => {
    const created = createEngine();
    const loaded = loadGameSave();
    if (loaded) applySaveData(created, loaded);
    return created;
  });
  const [audio] = useState(() => createSoundEngine(engine.settings.audioEnabled));
  const [snapshot, setSnapshot] = useState(() => getSnapshot(engine));
  const [hasEnteredGame, setHasEnteredGame] = useState(false);
  const [showLevelSummary, setShowLevelSummary] = useState(false);
  const [isPortraitMobile, setIsPortraitMobile] = useState(false);
  const [startCountdown, setStartCountdown] = useState(5);
  const [startError, setStartError] = useState("");
  const [controlHint, setControlHint] = useState("Press Space to use hook");

  const requestLandscapeLock = useCallback(() => {
    if (!window.screen?.orientation?.lock) return;
    window.screen.orientation.lock("landscape").catch(() => {});
  }, []);

  const requestFullscreen = useCallback(() => {
    const root = document.documentElement;
    const request =
      root.requestFullscreen ||
      root.webkitRequestFullscreen ||
      root.mozRequestFullScreen ||
      root.msRequestFullscreen;

    if (!request) return;
    request.call(root).catch?.(() => {});
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return undefined;

    let previous = performance.now();
    let uiInterval = 0;
    let frameHandle = 0;
    let previousPhase = engine.phase;

    const animate = (now) => {
      const delta = (now - previous) / 1000;
      previous = now;

      if (!slotAllowsPlay(slot)) {
        consumeDecisionEvents(engine);
        consumeAudioEvents(engine);
        setSlotStatus(getSlotStatus(slot));
        frameHandle = window.requestAnimationFrame(animate);
        return;
      }

      const moneyBefore = engine.money;
      updateEngine(engine, delta);
      if (hasEnteredGame) {
        experimentSummaryRef.current.money += Math.max(0, engine.money - moneyBefore);
        experimentSummaryRef.current.maxLevel = Math.max(experimentSummaryRef.current.maxLevel, engine.levelIndex + 1);
      }
      drawEngine(context, engine);

      const soundEvents = consumeAudioEvents(engine);
      if (soundEvents.length > 0) {
        playSoundBatch(audio, soundEvents);
      }

      const decisionEvents = consumeDecisionEvents(engine);
      if (decisionEvents.length > 0) {
        appendDecisionEntries(decisionEvents);
      }

      if (engine.phase !== previousPhase) {
        const oldPhase = previousPhase;
        previousPhase = engine.phase;
        saveGameSave(getSaveData(engine));

        if (oldPhase === "playing" && engine.phase === "shop") {
          setShowLevelSummary(true);
          if (summaryTimerRef.current) window.clearTimeout(summaryTimerRef.current);
          summaryTimerRef.current = window.setTimeout(() => {
            setShowLevelSummary(false);
          }, 2200);
        } else if (engine.phase !== "shop") {
          setShowLevelSummary(false);
          if (summaryTimerRef.current) {
            window.clearTimeout(summaryTimerRef.current);
            summaryTimerRef.current = 0;
          }
        }
      }

      uiInterval += delta;
      if (uiInterval >= 0.1) {
        setSnapshot(getSnapshot(engine));
        uiInterval = 0;
      }

      frameHandle = window.requestAnimationFrame(animate);
    };

    drawEngine(context, engine);
    frameHandle = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frameHandle);
  }, [audio, engine, slot, hasEnteredGame]);

  useEffect(() => {
    const persist = () => saveGameSave(getSaveData(engine));
    const saveOnHidden = () => {
      if (document.visibilityState === "hidden") persist();
    };

    const intervalHandle = window.setInterval(persist, 3000);
    window.addEventListener("beforeunload", persist);
    document.addEventListener("visibilitychange", saveOnHidden);
    return () => {
      window.clearInterval(intervalHandle);
      window.removeEventListener("beforeunload", persist);
      document.removeEventListener("visibilitychange", saveOnHidden);
    };
  }, [engine]);

  useEffect(() => {
    return () => {
      if (summaryTimerRef.current) {
        window.clearTimeout(summaryTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!window.matchMedia) return undefined;

    const coarsePointerQuery = window.matchMedia("(pointer: coarse)");
    const hoverlessQuery = window.matchMedia("(hover: none)");
    const syncControlHint = () => {
      const touchCapable =
        coarsePointerQuery.matches ||
        hoverlessQuery.matches ||
        (navigator.maxTouchPoints ?? 0) > 0;

      setControlHint(touchCapable ? "Tap to use hook" : "Press Space to use hook");
    };
    const subscribe = (query) => {
      if (query.addEventListener) {
        query.addEventListener("change", syncControlHint);
        return () => query.removeEventListener("change", syncControlHint);
      }

      query.addListener(syncControlHint);
      return () => query.removeListener(syncControlHint);
    };

    syncControlHint();
    const unsubscribeCoarse = subscribe(coarsePointerQuery);
    const unsubscribeHover = subscribe(hoverlessQuery);
    return () => {
      unsubscribeCoarse();
      unsubscribeHover();
    };
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 980px) and (orientation: portrait)");
    const syncOrientation = () => {
      setIsPortraitMobile(query.matches);
    };

    syncOrientation();
    requestLandscapeLock();

    query.addEventListener("change", syncOrientation);
    window.addEventListener("orientationchange", syncOrientation);
    return () => {
      query.removeEventListener("change", syncOrientation);
      window.removeEventListener("orientationchange", syncOrientation);
    };
  }, [requestLandscapeLock]);

  const refreshSnapshot = useCallback((persist = false) => {
    setSnapshot(getSnapshot(engine));
    if (persist) saveGameSave(getSaveData(engine));
  }, [engine]);

  const startNewRun = useCallback(async ({ automatic = false } = {}) => {
    if (!slotAllowsPlay(slot)) return;
    if (startingRunRef.current || engine.phase === "playing") return;
    startingRunRef.current = true;
    setStartError("");
    // Fullscreen requires a user gesture; automatic starts use the normal viewport.
    if (!automatic) {
      requestFullscreen();
      requestLandscapeLock();
    }
    try {
      startDecisionSession(createMinerNick());
      resetProgress(engine);
      startLevel(engine, 1);
      experimentSummaryRef.current.maxLevel = Math.max(1, experimentSummaryRef.current.maxLevel);
      setHasEnteredGame(true);
      setShowLevelSummary(false);
      refreshSnapshot(true);
    } finally {
      startingRunRef.current = false;
    }
  }, [engine, refreshSnapshot, requestFullscreen, requestLandscapeLock, slot]);

  useEffect(() => {
    if (hasEnteredGame || ["ended", "invalid", "summary"].includes(slotStatus)) return undefined;
    if (slot) {
      if (slotStatus === "active") void startNewRun({ automatic: true });
      return undefined;
    }
    const deadline = performance.now() + 5000;
    const interval = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
      setStartCountdown(remaining);
      if (remaining === 0) {
        window.clearInterval(interval);
        void startNewRun({ automatic: true });
      }
    }, 100);
    return () => window.clearInterval(interval);
  }, [hasEnteredGame, startNewRun, slot, slotStatus]);

  const handleCanvasTap = useCallback(() => {
    if (!slotAllowsPlay(slot)) return;
    if (!hasEnteredGame) return;
    if (snapshot.phase !== "playing") return;
    releaseHook(engine);
    refreshSnapshot(false);
  }, [engine, hasEnteredGame, refreshSnapshot, snapshot.phase, slot]);

  const handlePurchase = (itemId) => {
    if (!slotAllowsPlay(slot)) return;
    purchaseShopItem(engine, itemId);
    refreshSnapshot(true);
  };

  const handleNextLevel = useCallback(() => {
    if (!slotAllowsPlay(slot)) return;
    nextLevel(engine);
    refreshSnapshot(true);
  }, [engine, refreshSnapshot, slot]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!slotAllowsPlay(slot)) return;
      if (event.repeat) return;

      if (!hasEnteredGame && (event.code === "Enter" || event.code === "Space")) {
        event.preventDefault();
        startNewRun();
        return;
      }

      if (!hasEnteredGame) return;

      if (snapshot.phase === "playing" && (event.code === "Enter" || event.code === "Space")) {
        event.preventDefault();
        releaseHook(engine);
        refreshSnapshot(false);
        return;
      }

      if (snapshot.phase === "shop" && !showLevelSummary && event.code === "Enter") {
        event.preventDefault();
        handleNextLevel();
        return;
      }

      if ((snapshot.phase === "level-failed" || snapshot.phase === "run-complete") && event.code === "Enter") {
        event.preventDefault();
        startNewRun();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [engine, handleNextLevel, hasEnteredGame, refreshSnapshot, showLevelSummary, snapshot.phase, startNewRun, slot]);

  const canPlay = slotStatus === "active" || slotStatus === "unscheduled";
  const isPlaying = canPlay && hasEnteredGame && snapshot.phase === "playing";
  const isShop = canPlay && hasEnteredGame && snapshot.phase === "shop" && !showLevelSummary;
  const isSummary = canPlay && hasEnteredGame && snapshot.phase === "shop" && showLevelSummary;
  const isFailed = canPlay && hasEnteredGame && snapshot.phase === "level-failed";
  const isComplete = canPlay && hasEnteredGame && snapshot.phase === "run-complete";
  const binaryTotal = snapshot.oneDecisions + snapshot.zeroDecisions;

  return (
    <div className={`scene-root${isPortraitMobile ? " scene-root--portrait" : ""}`}>
      {canPlay && startError && <p className="start-error" role="alert">{startError}</p>}
      {!canPlay && (
        <section className="scene-panel slot-screen" aria-live="polite">
          <h1>{["ended", "summary"].includes(slotStatus) ? "Thank you for participating!" : slotStatus === "invalid" ? "Invalid experiment slot" : "Waiting for your game"}</h1>
          {slotStatus === "summary" && <>
            <h2>Game Summary</h2>
            <p>Maximum level reached: <strong>{experimentSummary.maxLevel}</strong></p>
            <p>Money earned: <strong>{formatMoney(experimentSummary.money)}</strong></p>
            <p>You will return to the portal automatically at the end of your slot.</p>
          </>}
          {slotStatus === "waiting" && <>
            <p>Your game will start automatically at {new Date(slot.startAt).toLocaleTimeString()}.</p>
            <p role="timer">Starting in {Math.floor(slotSeconds / 60)}:{String(slotSeconds % 60).padStart(2, "0")}</p>
          </>}
          {slotStatus === "ended" && <p>Your time slot has ended. You can return to the portal.</p>}
          {slotStatus === "invalid" && <p>Please open the game again using the link from the portal.</p>}
        </section>
      )}
      <canvas
        ref={canvasRef}
        width={GAME_WIDTH}
        height={GAME_HEIGHT}
        onPointerDown={handleCanvasTap}
        className={`game-canvas${isPlaying ? " game-canvas--visible" : ""}`}
        aria-label="Gold Miner gameplay canvas"
      />

      {canPlay && !hasEnteredGame ? (
        <section
          className="scene-panel start-screen start-screen--mine"
          role="dialog"
          aria-modal="true"
          aria-labelledby="start-title"
        >
          <img
            src="/assets/start/lantern.svg"
            alt=""
            className="start-decor start-decor--lantern"
            loading="lazy"
            aria-hidden="true"
          />
          <img
            src="/assets/start/rock-chunk.svg"
            alt=""
            className="start-decor start-decor--rock"
            loading="lazy"
            aria-hidden="true"
          />
          <img
            src={startDiamondIcon}
            alt=""
            className="start-decor start-decor--diamond"
            loading="lazy"
            aria-hidden="true"
          />
          <img
            src={startMysteryIcon}
            alt=""
            className="start-decor start-decor--mystery"
            loading="lazy"
            aria-hidden="true"
          />
          <header className="start-hero">
            <h1 id="start-title">Gold Miner</h1>
          </header>

          <div className="start-nugget-shell">
            <img
              src={startGoldIcon}
              alt=""
              className="start-nugget-asset"
              loading="lazy"
              aria-hidden="true"
            />
            <div className="start-form start-form--nugget">
              <p className="start-countdown" role="timer" aria-live="polite" aria-atomic="true">
                <span>{startError ? "Ready to retry" : startCountdown > 0 ? "Starting in" : "Starting…"}</span>
                {startCountdown > 0 && <strong>{startCountdown}</strong>}
              </p>
              <button type="button" className="play-cta" onClick={startNewRun}>
                <span>PLAY</span>
              </button>
            </div>
          </div>

          <p className="control-hint">{controlHint}</p>

          <div className="start-rule-strip">
            <article className="start-rule-card">
              <div className="start-rule-card__head">
                <img
                  src="/assets/icons/claw-machine.png"
                  alt=""
                  className="start-rule-icon"
                  loading="lazy"
                  aria-hidden="true"
                />
                <h2>Claw</h2>
              </div>
              <p>Drop at the right moment to grab one item.</p>
            </article>
            <article className="start-rule-card">
              <div className="start-rule-card__head">
                <img
                  src="/assets/start/pickaxe-badge.svg"
                  alt=""
                  className="start-rule-icon"
                  loading="lazy"
                  aria-hidden="true"
                />
                <h2>Shop</h2>
              </div>
              <p>Use vault cash for speed, reach, and boosts.</p>
            </article>
            <article className="start-rule-card">
              <div className="start-rule-card__head">
                <img
                  src={startMysteryIcon}
                  alt=""
                  className="start-rule-icon"
                  loading="lazy"
                  aria-hidden="true"
                />
                <h2>Goal</h2>
              </div>
              <p>Hit the cash target before time runs out.</p>
            </article>
          </div>
        </section>
      ) : null}

      {isSummary ? (
        <section className="scene-panel summary-screen">
          <h2>Level {snapshot.level} Summary</h2>
          <div className="summary-grid">
            <div>
              <span>Goal</span>
              <strong>{formatMoney(snapshot.goal)}</strong>
            </div>
            <div>
              <span>Collected</span>
              <strong>{formatMoney(snapshot.money)}</strong>
            </div>
            <div>
              <span>Vault Reward</span>
              <strong>{formatMoney(snapshot.lastReward)}</strong>
            </div>
          </div>
          <p className="scene-note">Shop opens in a moment...</p>
        </section>
      ) : null}

      {isShop ? (
        <section className="scene-panel shop-screen">
          <header className="shop-header">
            <h2>Gold Miner Shop</h2>
            <button type="button" className="action-btn action-btn--green" onClick={handleNextLevel}>
              Next Level
            </button>
          </header>
          <p className="speech">
            Click the items you want to buy. When you are ready, move to the next level.
          </p>
          <p className="wallet">Vault Cash: <strong>{formatMoney(snapshot.bank)}</strong></p>
          <div className="shop-list">
            {snapshot.shopCatalog.map((item) => {
              const levelLabel = item.category === "upgrade" ? `Lv ${item.level}/${item.maxLevel}` : `Owned ${item.level}`;
              const disabled = !item.affordable || item.isMaxed;
              return (
                <article key={item.id} className="shop-item-card">
                  {item.shopIcon ? <img src={item.shopIcon} alt="" className="shop-item-icon" loading="lazy" /> : null}
                  <div className="shop-item-copy">
                    <div className="shop-item-heading">
                      <h3>{item.name}</h3>
                      <span className="shop-item-level">{levelLabel}</span>
                    </div>
                    <p>{item.description}</p>
                  </div>
                  <button
                    type="button"
                    className="action-btn action-btn--buy action-btn--buy-side"
                    disabled={disabled}
                    onClick={() => handlePurchase(item.id)}
                  >
                    {item.isMaxed ? "Maxed" : `Buy ${formatMoney(item.cost)}`}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {isFailed ? (
        <section className="scene-panel fail-screen">
          <h2>Level Failed</h2>
          <p>You did not reach the goal on level {snapshot.level}.</p>
          <div className="summary-grid">
            <div>
              <span>Goal</span>
              <strong>{formatMoney(snapshot.goal)}</strong>
            </div>
            <div>
              <span>Collected</span>
              <strong>{formatMoney(snapshot.money)}</strong>
            </div>
            <div>
              <span>Total Decisions</span>
              <strong>{binaryTotal}</strong>
            </div>
            <div>
              <span>Completed Levels</span>
              <strong>{Math.max(0, snapshot.level - 1)}</strong>
            </div>
          </div>
          <button type="button" className="action-btn action-btn--gold" onClick={startNewRun}>
            Start Over
          </button>
        </section>
      ) : null}

      {isComplete ? (
        <section className="scene-panel complete-screen">
          <h2>Congratulations</h2>
          <p>You completed all 12 levels of Gold Miner.</p>
          <div className="summary-grid">
            <div>
              <span>Total Earned</span>
              <strong>{formatMoney(snapshot.stats.totalEarned)}</strong>
            </div>
            <div>
              <span>Levels Won</span>
              <strong>{snapshot.stats.totalWins}</strong>
            </div>
            <div>
              <span>Gold</span>
              <strong>{snapshot.stats.goldCaught}</strong>
            </div>
            <div>
              <span>Diamonds + Mystery</span>
              <strong>{snapshot.stats.diamondCaught + snapshot.stats.mysteryCaught}</strong>
            </div>
          </div>
          <button type="button" className="action-btn action-btn--gold" onClick={startNewRun}>
            Play Again
          </button>
        </section>
      ) : null}

      <section className="rotate-lock" aria-hidden={!isPortraitMobile}>
        <div className="rotate-lock__card">
          <h2>Rotate Your Phone</h2>
          <p>This game is designed for landscape mode. Rotate your device horizontally to see everything.</p>
        </div>
      </section>
    </div>
  );
}

export default App;

