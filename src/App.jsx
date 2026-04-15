import { useCallback, useEffect, useRef, useState } from "react";
import { createSoundEngine, playSoundBatch } from "./audio/sfx";
import {
  GAME_HEIGHT,
  GAME_WIDTH,
  applySaveData,
  consumeAudioEvents,
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
import { loadGameSave, saveGameSave } from "./game/storage";

function formatMoney(value) {
  return `$${Math.max(0, Math.round(value)).toLocaleString()}`;
}

function App() {
  const canvasRef = useRef(null);
  const summaryTimerRef = useRef(0);

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

      updateEngine(engine, delta);
      drawEngine(context, engine);

      const soundEvents = consumeAudioEvents(engine);
      if (soundEvents.length > 0) {
        playSoundBatch(audio, soundEvents);
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
  }, [audio, engine]);

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

  const startNewRun = useCallback(() => {
    requestFullscreen();
    requestLandscapeLock();
    resetProgress(engine);
    startLevel(engine, 1);
    setHasEnteredGame(true);
    setShowLevelSummary(false);
    refreshSnapshot(true);
  }, [engine, refreshSnapshot, requestFullscreen, requestLandscapeLock]);

  const handleCanvasTap = useCallback(() => {
    if (!hasEnteredGame) return;
    if (snapshot.phase !== "playing") return;
    releaseHook(engine);
    refreshSnapshot(false);
  }, [engine, hasEnteredGame, refreshSnapshot, snapshot.phase]);

  const handlePurchase = (itemId) => {
    purchaseShopItem(engine, itemId);
    refreshSnapshot(true);
  };

  const handleNextLevel = useCallback(() => {
    nextLevel(engine);
    refreshSnapshot(true);
  }, [engine, refreshSnapshot]);

  useEffect(() => {
    const onKeyDown = (event) => {
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
  }, [engine, handleNextLevel, hasEnteredGame, refreshSnapshot, showLevelSummary, snapshot.phase, startNewRun]);

  const isPlaying = hasEnteredGame && snapshot.phase === "playing";
  const isShop = hasEnteredGame && snapshot.phase === "shop" && !showLevelSummary;
  const isSummary = hasEnteredGame && snapshot.phase === "shop" && showLevelSummary;
  const isFailed = hasEnteredGame && snapshot.phase === "level-failed";
  const isComplete = hasEnteredGame && snapshot.phase === "run-complete";
  const binaryTotal = snapshot.oneDecisions + snapshot.zeroDecisions;

  return (
    <div className={`scene-root${isPortraitMobile ? " scene-root--portrait" : ""}`}>
      <canvas
        ref={canvasRef}
        width={GAME_WIDTH}
        height={GAME_HEIGHT}
        onPointerDown={handleCanvasTap}
        className={`game-canvas${isPlaying ? " game-canvas--visible" : ""}`}
        aria-label="Binary Miner gameplay canvas"
      />

      {!hasEnteredGame ? (
        <section className="scene-panel start-screen" role="dialog" aria-modal="true" aria-labelledby="start-title">
          <div className="start-left">
            <button type="button" className="nugget-start" onClick={startNewRun}>
              Start
            </button>
            <div className="miner-portrait" aria-hidden="true" />
          </div>
                    <div className="start-right">
            <h1 id="start-title">Binary Miner</h1>
            <p>Grab as many resources as you can before time runs out.</p>
            <div className="control-grid">
              <article>
                <h2>Hook</h2>
                <p>Press Space or tap/click.</p>
              </article>
              <article>
                <h2>Shop</h2>
                <p>Buy upgrades to gather resources faster.</p>
              </article>
              <article>
                <h2>Goal</h2>
                <p>Earn enough cash to move on.</p>
              </article>
            </div>
            <button type="button" className="action-btn action-btn--gold" onClick={startNewRun}>
              Start Mining
            </button>
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
            <div>
              <span>1/0 Decisions</span>
              <strong>{snapshot.oneDecisions}/{snapshot.zeroDecisions}</strong>
            </div>
          </div>
          <p className="scene-note">Shop opens in a moment...</p>
        </section>
      ) : null}

      {isShop ? (
        <section className="scene-panel shop-screen">
          <header className="shop-header">
            <h2>Binary Miner Shop</h2>
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
                  <div className="shop-item-main">
                    <div className="shop-item-title">
                      {item.shopIcon ? <img src={item.shopIcon} alt="" className="shop-item-icon" loading="lazy" /> : null}
                      <div className="shop-item-copy">
                        <div className="shop-item-heading">
                          <h3>{item.name}</h3>
                          <span className="shop-item-level">{levelLabel}</span>
                        </div>
                        <p>{item.description}</p>
                      </div>
                    </div>
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
          <p>You completed all 12 levels of Binary Miner.</p>
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
              <span>Diamenty + Mystery</span>
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

