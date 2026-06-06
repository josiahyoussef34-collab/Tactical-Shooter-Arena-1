/**
 * Game.tsx
 * --------
 * React component that mounts the Three.js FPS game into a full-screen div,
 * then renders a HUD overlay (health, ammo, crosshair, game-over screen)
 * on top using plain HTML/CSS.
 *
 * The game engine (FPSGame) lives entirely in FPSGame.ts — this component
 * is just the bridge between React and the raw canvas.
 */

import { useEffect, useRef, useState, useCallback, Component, ReactNode } from "react";
import { FPSGame, HUDState } from "@/game/FPSGame";

// ── Error Boundary — catches WebGL failures gracefully ──
interface EBState { hasError: boolean; message: string }
class ErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }
  static getDerivedStateFromError(err: Error) {
    return { hasError: true, message: err.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ ...styles.overlay, background: "#0a0a0f" }}>
          <div style={styles.card}>
            <h1 style={{ ...styles.title, color: "#e74c3c", fontSize: 22 }}>
              WebGL Not Available
            </h1>
            <p style={{ ...styles.subtitle, textAlign: "center", lineHeight: 1.7 }}>
              This game requires WebGL (GPU acceleration).<br />
              Please open the app in a regular browser tab —<br />
              click the <strong style={{ color: "#fff" }}>⎋ open in new tab</strong> button
              in the preview toolbar.
            </p>
            <div style={{ ...styles.divider }} />
            <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, fontFamily: "monospace" }}>
              {this.state.message}
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── WebGL support check ──
function checkWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl")
    );
  } catch {
    return false;
  }
}

// ── Initial HUD values shown before the game loop fires its first update ──
const INITIAL_HUD: HUDState = {
  health: 100,
  magAmmo: 30,
  reserveAmmo: 90,
  magSize: 30,
  isReloading: false,
  reloadProgress: 0,
  gameOver: false,
  won: false,
  enemyHealth: 100,
  maxEnemyHealth: 100,
  showHitMarker: false,
  lastDamageAmount: 0,
  damageFlashActive: false,
  matchTime: 120,
  playerKills: 0,
  enemyKills: 0,
  matchActive: true,
};

function GameInner() {
  // DOM container that Three.js appends its <canvas> into
  const containerRef = useRef<HTMLDivElement>(null);

  // Reference to the game engine so we can call restart() / destroy()
  const gameRef = useRef<FPSGame | null>(null);

  // HUD state — updated by the engine on every relevant event
  const [hud, setHud] = useState<HUDState>(INITIAL_HUD);

  // Whether the player has clicked to start (pointer lock requested)
  const [started, setStarted] = useState(false);

  // WebGL availability — show helpful message if not supported
  const [webGLOK] = useState(() => checkWebGL());

  // ── Add CSS animation for damage indicator ──
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `
      @keyframes fadeOut {
        0% { opacity: 1; transform: translateY(0) scale(1); }
        100% { opacity: 0; transform: translateY(-20px) scale(0.8); }
      }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  // ── Stable callback passed to the game engine to update HUD ──
  const onHUD = useCallback((state: HUDState) => {
    setHud({ ...state });
  }, []);

  // ── Mount the game engine once, destroy on unmount ──
  useEffect(() => {
    if (!containerRef.current) return;
    if (!webGLOK) return;

    const game = new FPSGame(containerRef.current, onHUD);
    gameRef.current = game;

    return () => {
      game.destroy();
      gameRef.current = null;
    };
  }, [onHUD, webGLOK]);

  // ── Restart handler ──
  const handleRestart = () => {
    setHud(INITIAL_HUD);
    setStarted(false);
    gameRef.current?.restart();
  };

  // ── Derived HUD colours ──
  const healthColor =
    hud.health > 60 ? "#2ecc71" : hud.health > 30 ? "#f39c12" : "#e74c3c";
  const enemyHealthPct = (hud.enemyHealth / hud.maxEnemyHealth) * 100;
  const playerHealthPct = hud.health;

  // ── No WebGL fallback ──
  if (!webGLOK) {
    return (
      <div style={{ ...styles.overlay, background: "#0a0a0f" }}>
        <div style={styles.card}>
          <h1 style={{ ...styles.title, color: "#e74c3c", fontSize: 22 }}>
            WebGL Not Available
          </h1>
          <p style={{ ...styles.subtitle, textAlign: "center", lineHeight: 1.7 }}>
            This game requires WebGL (GPU acceleration).<br />
            Try opening the app in a regular browser tab — click the<br />
            <strong style={{ color: "#fff" }}>open in new tab</strong> button in the preview toolbar.
          </p>
        </div>
      </div>
    );
  }

  return (
    // Outer wrapper fills the whole viewport
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden", background: "#000" }}>

      {/* ── Three.js canvas container ── */}
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%" }}
        onClick={() => setStarted(true)}
      />

      {/* ── Click-to-start overlay (shown until pointer is locked) ── */}
      {!started && !hud.gameOver && (
        <div style={styles.overlay}>
          <div style={styles.card}>
            <h1 style={styles.title}>SECTOR ZERO</h1>
            <p style={styles.subtitle}>Tactical FPS Prototype</p>
            <div style={styles.divider} />
            <div style={styles.controlsGrid}>
              <span style={styles.key}>W A S D</span><span style={styles.controlLabel}>Move</span>
              <span style={styles.key}>Mouse</span><span style={styles.controlLabel}>Look</span>
              <span style={styles.key}>LMB</span><span style={styles.controlLabel}>Shoot</span>
              <span style={styles.key}>R</span><span style={styles.controlLabel}>Reload</span>
            </div>
            <div style={styles.divider} />
            <p style={{ ...styles.subtitle, fontSize: 13, opacity: 0.7 }}>
              Objective: eliminate the enemy target
            </p>
            <button style={styles.startBtn} onClick={() => setStarted(true)}>
              Click to Start
            </button>
          </div>
        </div>
      )}

      {/* ── Game Over / Win screen ── */}
      {hud.gameOver && (
        <div style={styles.overlay}>
          <div style={styles.card}>
            <h1 style={{ ...styles.title, color: "#fff" }}>MATCH OVER</h1>
            <p style={{ ...styles.subtitle, marginBottom: 8 }}>
              Final Score
            </p>
            <div style={{ color: "#fff", fontFamily: "monospace", fontSize: 18, marginBottom: 8 }}>
              Player: <strong>{hud.playerKills}</strong> — Enemy: <strong>{hud.enemyKills}</strong>
            </div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ ...styles.hudLabel, marginBottom: 6 }}>WINNER</div>
              <div style={{ fontFamily: "monospace", fontSize: 16, color: "#fff" }}>
                {hud.playerKills > hud.enemyKills ? "PLAYER" : hud.enemyKills > hud.playerKills ? "ENEMY" : "DRAW"}
              </div>
            </div>
            <button style={styles.startBtn} onClick={handleRestart}>
              Restart
            </button>
          </div>
        </div>
      )}

      {/* ── HUD: only shown when game is live ── */}
      {started && !hud.gameOver && (
        <>
          {/* Crosshair */}
          <div style={styles.crosshairH} />
          <div style={styles.crosshairV} />

          {/* Hit marker — two diagonal bars that form an × on enemy hit */}
          {hud.showHitMarker && (
            <>
              <div style={{ ...styles.hitMarkerBar, transform: "translate(-50%,-50%) rotate(45deg)" }} />
              <div style={{ ...styles.hitMarkerBar, transform: "translate(-50%,-50%) rotate(-45deg)" }} />
            </>
          )}

          {/* Bottom-left: Health */}
          <div style={styles.hudBottomLeft}>
            <div style={styles.hudLabel}>HEALTH</div>
            <div style={styles.barOuter}>
              <div style={{ ...styles.barInner, width: `${playerHealthPct}%`, background: healthColor }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ ...styles.hudValue, color: healthColor }}>{hud.health}</div>
              {/* Damage indicator — shows when hit */}
              {hud.lastDamageAmount > 0 && (
                <div style={{
                  ...styles.damageIndicator,
                  animation: "fadeOut 0.6s ease-out",
                }}>
                  -{hud.lastDamageAmount}
                </div>
              )}
            </div>
          </div>

          {/* Bottom-right: Ammo */}
          <div style={styles.hudBottomRight}>
            <div style={styles.hudLabel}>AMMO</div>

            {/* Magazine / reserve count */}
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, lineHeight: 1 }}>
              <span style={{ ...styles.hudValue, fontSize: 30 }}>{hud.magAmmo}</span>
              <span style={{ color: "#555", fontFamily: "monospace", fontSize: 16, fontWeight: 700 }}>
                │ {hud.reserveAmmo}
              </span>
            </div>

            {/* Status: reloading progress OR empty-mag warnings */}
            {hud.isReloading ? (
              <div style={{ marginTop: 6, width: 120 }}>
                <div style={{ ...styles.hudLabel, color: "#f39c12", marginBottom: 3 }}>
                  RELOADING…
                </div>
                <div style={styles.barOuter}>
                  <div
                    style={{
                      ...styles.barInner,
                      width: `${hud.reloadProgress * 100}%`,
                      background: "#f39c12",
                    }}
                  />
                </div>
              </div>
            ) : hud.magAmmo === 0 && hud.reserveAmmo === 0 ? (
              <div style={{ ...styles.hudLabel, color: "#e74c3c", marginTop: 4 }}>
                NO AMMO
              </div>
            ) : hud.magAmmo === 0 ? (
              <div style={{ ...styles.hudLabel, color: "#f39c12", marginTop: 4 }}>
                PRESS R TO RELOAD
              </div>
            ) : null}
          </div>

          {/* Top-centre: Match timer */}
          <div style={styles.matchTimerTop}>
            <div style={{ ...styles.hudLabel, marginBottom: 4 }}>TIME</div>
            <div style={{ color: "#fff", fontFamily: "monospace", fontWeight: 800 }}>{Math.max(0, Math.ceil(hud.matchTime))}s</div>
          </div>

          {/* Top-right: Score */}
          <div style={styles.scoreTopRight}>
            <div style={{ ...styles.hudLabel, textAlign: "right" }}>SCORE</div>
            <div style={{ color: "#fff", fontFamily: "monospace", fontWeight: 800 }}>
              P: {hud.playerKills}  •  E: {hud.enemyKills}
            </div>
          </div>

        </>
      )}
    </div>
  );
}

export default function Game() {
  return (
    <ErrorBoundary>
      <GameInner />
    </ErrorBoundary>
  );
}

// ── Inline styles (no Tailwind needed for game HUD) ──
const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "absolute", inset: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "rgba(0,0,0,0.75)",
    backdropFilter: "blur(4px)",
    zIndex: 10,
  },
  card: {
    background: "rgba(10,10,20,0.95)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 12,
    padding: "40px 48px",
    display: "flex", flexDirection: "column", alignItems: "center",
    gap: 12, minWidth: 320, maxWidth: 420,
  },
  title: {
    color: "#fff", fontSize: 32, fontWeight: 800,
    letterSpacing: 6, margin: 0, fontFamily: "monospace",
  },
  subtitle: {
    color: "rgba(255,255,255,0.6)", fontSize: 14,
    margin: 0, fontFamily: "monospace", letterSpacing: 2,
  },
  divider: {
    width: "100%", height: 1,
    background: "rgba(255,255,255,0.1)", margin: "8px 0",
  },
  controlsGrid: {
    display: "grid", gridTemplateColumns: "auto 1fr",
    gap: "8px 20px", alignItems: "center", width: "100%",
  },
  key: {
    background: "rgba(255,255,255,0.1)",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 6, padding: "3px 10px",
    fontFamily: "monospace", fontSize: 13, color: "#fff",
    textAlign: "center",
  },
  controlLabel: {
    color: "rgba(255,255,255,0.55)", fontFamily: "monospace", fontSize: 13,
  },
  startBtn: {
    marginTop: 12,
    background: "linear-gradient(135deg, #e74c3c, #c0392b)",
    border: "none", borderRadius: 8, color: "#fff",
    fontFamily: "monospace", fontSize: 16, fontWeight: 700,
    letterSpacing: 2, padding: "12px 32px", cursor: "pointer",
    width: "100%",
  },
  // Crosshair
  crosshairH: {
    position: "absolute",
    top: "50%", left: "50%",
    transform: "translate(-50%, -50%)",
    width: 20, height: 2,
    background: "rgba(255,255,255,0.8)",
    pointerEvents: "none",
  },
  crosshairV: {
    position: "absolute",
    top: "50%", left: "50%",
    transform: "translate(-50%, -50%)",
    width: 2, height: 20,
    background: "rgba(255,255,255,0.8)",
    pointerEvents: "none",
  },
  // Hit marker — two bars rotated ±45° to form an × over the crosshair
  hitMarkerBar: {
    position: "absolute",
    top: "50%", left: "50%",
    width: 18, height: 3,
    background: "#ff4444",
    borderRadius: 2,
    pointerEvents: "none",
  },
  // Bottom-left HUD
  hudBottomLeft: {
    position: "absolute", bottom: 28, left: 28,
    display: "flex", flexDirection: "column", gap: 4,
    pointerEvents: "none",
  },
  // Bottom-right HUD
  hudBottomRight: {
    position: "absolute", bottom: 28, right: 28,
    display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4,
    pointerEvents: "none",
  },
  hudLabel: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 10, fontFamily: "monospace", letterSpacing: 3,
  },
  hudValue: {
    color: "#fff", fontSize: 20, fontFamily: "monospace", fontWeight: 700,
  },
  barOuter: {
    width: 140, height: 6,
    background: "rgba(255,255,255,0.1)",
    borderRadius: 3, overflow: "hidden",
  },
  barInner: {
    height: "100%", borderRadius: 3,
    transition: "width 0.15s ease, background 0.3s ease",
  },
  // Damage indicator (shown when player takes damage)
  damageIndicator: {
    color: "#ff4444",
    fontFamily: "monospace",
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: 1,
    whiteSpace: "nowrap",
  },
  // Top-centre enemy health
  enemyHudTop: {
    position: "absolute", top: 20, left: "50%",
    transform: "translateX(-50%)",
    display: "flex", flexDirection: "column", alignItems: "center",
    pointerEvents: "none",
  },
  matchTimerTop: {
    position: "absolute", top: 18, left: "50%",
    transform: "translateX(-50%)", textAlign: "center", pointerEvents: "none",
  },
  scoreTopRight: {
    position: "absolute", top: 18, right: 20, textAlign: "right", pointerEvents: "none",
  },
  // Centre message (out of ammo)
  centreMessage: {
    position: "absolute",
    bottom: 100, left: "50%",
    transform: "translateX(-50%)",
    color: "#f39c12", fontFamily: "monospace",
    fontSize: 14, letterSpacing: 2,
    background: "rgba(0,0,0,0.5)", padding: "6px 16px", borderRadius: 4,
    pointerEvents: "none",
  },
};
