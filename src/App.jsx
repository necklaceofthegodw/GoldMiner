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
            <h1 id="start-title">Gold Miner</h1>
            <p>Zlap jak najwiecej surowcow zanim minie czas.</p>
            <div className="control-grid">
              <article>
                <h2>Hook</h2>
                <p>Spacja lub klikniecie.</p>
              </article>
              <article>
                <h2>Sklep</h2>
                <p>Kupuj ulepszenia, aby szybciej zdobywac surowce.</p>
              </article>
              <article>
                <h2>Cel</h2>
                <p>Zdobadz wystarczajaca ilosc kasy, aby przejsc dalej.</p>
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
          <h2>Podsumowanie Poziomu {snapshot.level}</h2>
          <div className="summary-grid">
            <div>
              <span>Cel</span>
              <strong>{formatMoney(snapshot.goal)}</strong>
            </div>
            <div>
              <span>Zebrane</span>
              <strong>{formatMoney(snapshot.money)}</strong>
            </div>
            <div>
              <span>Nagroda do sejfu</span>
              <strong>{formatMoney(snapshot.lastReward)}</strong>
            </div>
            <div>
              <span>Decyzje 1/0</span>
              <strong>{snapshot.oneDecisions}/{snapshot.zeroDecisions}</strong>
            </div>
          </div>
          <p className="scene-note">Sklep otwiera sie za chwile...</p>
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
            Kliknij przedmioty, ktore chcesz kupic. Gdy jestes gotowy, przejdz do nastepnego poziomu.
          </p>
          <p className="wallet">Vault Cash: <strong>{formatMoney(snapshot.bank)}</strong></p>
          <div className="shop-list">
            {snapshot.shopCatalog.map((item) => {
              const levelLabel = item.category === "upgrade" ? `Lv ${item.level}/${item.maxLevel}` : `Owned ${item.level}`;
              const disabled = !item.affordable || item.isMaxed;
              return (
                <article key={item.id} className="shop-item-card">
                  <div className="shop-item-top">
                    <h3>{item.name}</h3>
                    <span>{levelLabel}</span>
                  </div>
                  <p>{item.description}</p>
                  <button
                    type="button"
                    className="action-btn action-btn--buy"
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
          <h2>Przegrales</h2>
          <p>Nie udalo sie dobic celu na poziomie {snapshot.level}.</p>
          <div className="summary-grid">
            <div>
              <span>Cel</span>
              <strong>{formatMoney(snapshot.goal)}</strong>
            </div>
            <div>
              <span>Zebrane</span>
              <strong>{formatMoney(snapshot.money)}</strong>
            </div>
            <div>
              <span>Decyzje lacznie</span>
              <strong>{binaryTotal}</strong>
            </div>
            <div>
              <span>Ukonczone poziomy</span>
              <strong>{Math.max(0, snapshot.level - 1)}</strong>
            </div>
          </div>
          <button type="button" className="action-btn action-btn--gold" onClick={startNewRun}>
            Sprobuj od poczatku
          </button>
        </section>
      ) : null}

      {isComplete ? (
        <section className="scene-panel complete-screen">
          <h2>Gratulacje</h2>
          <p>Ukonczyles wszystkie 12 poziomow Binary Miner.</p>
          <div className="summary-grid">
            <div>
              <span>Lacznie zarobione</span>
              <strong>{formatMoney(snapshot.stats.totalEarned)}</strong>
            </div>
            <div>
              <span>Wygrane poziomy</span>
              <strong>{snapshot.stats.totalWins}</strong>
            </div>
            <div>
              <span>Zloto</span>
              <strong>{snapshot.stats.goldCaught}</strong>
            </div>
            <div>
              <span>Diamenty + Mystery</span>
              <strong>{snapshot.stats.diamondCaught + snapshot.stats.mysteryCaught}</strong>
            </div>
          </div>
          <button type="button" className="action-btn action-btn--gold" onClick={startNewRun}>
            Zagraj jeszcze raz
          </button>
        </section>
      ) : null}

      <section className="rotate-lock" aria-hidden={!isPortraitMobile}>
        <div className="rotate-lock__card">
          <h2>Obroc telefon</h2>
          <p>Ta gra dziala w poziomie. Przekrec urzadzenie poziomo, aby wszystko bylo widoczne.</p>
        </div>
      </section>
    </div>
  );
}

export default App;

