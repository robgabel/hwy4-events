"use client";

// The Tile Room — 4-seat Rummikub scoring + a 120-second turn clock.
// Standard scoring: the round's winner gains the sum of every loser's
// leftover tile points; each loser goes negative by their own count.
// State persists to localStorage so a mid-game refresh loses nothing.

import { useEffect, useRef, useState } from "react";

const TURN_MS = 120_000;
const STORAGE_KEY = "hwy4-fun-rummikub-v1";
const SEATS: number[] = [0, 1, 2, 3];

// Classic Rummikub tile colors, one per seat.
const TILE_COLORS = ["#2B2B33", "#B5432F", "#295E9E", "#D07A2A"];
const SEAT_NUMERALS = ["I", "II", "III", "IV"];

type Round = {
  winner: number;
  // Leftover tile points per seat; winner's entry is always 0.
  tiles: number[];
};

type Saved = {
  phase: "setup" | "play";
  names: string[];
  rounds: Round[];
  turn: number;
};

function seatName(names: string[], i: number) {
  return names[i].trim() || `Seat ${SEAT_NUMERALS[i]}`;
}

function totals(rounds: Round[]): number[] {
  const t = [0, 0, 0, 0];
  for (const r of rounds) {
    const pot = r.tiles.reduce((a, b) => a + b, 0);
    for (const i of SEATS) t[i] += i === r.winner ? pot : -r.tiles[i];
  }
  return t;
}

export default function TileRoom() {
  const [hydrated, setHydrated] = useState(false);
  const [phase, setPhase] = useState<"setup" | "play">("setup");
  const [names, setNames] = useState<string[]>(["", "", "", ""]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [turn, setTurn] = useState(0);

  // Turn clock. endsAt is a wall-clock target so the countdown never drifts.
  const [running, setRunning] = useState(false);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState(TURN_MS);
  const [soundOn, setSoundOn] = useState(true);
  const lastTickSecond = useRef<number>(-1);

  // Round scoring panel.
  const [scoring, setScoring] = useState(false);
  const [roundWinner, setRoundWinner] = useState<number | null>(null);
  const [tileEntry, setTileEntry] = useState<string[]>(["", "", "", ""]);

  const [confirmingReset, setConfirmingReset] = useState(false);

  // ---- persistence -------------------------------------------------------
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Saved;
        if (Array.isArray(s.names) && s.names.length === 4) {
          setNames(s.names.map((n) => String(n ?? "")));
          setRounds(Array.isArray(s.rounds) ? s.rounds : []);
          setTurn(typeof s.turn === "number" ? ((s.turn % 4) + 4) % 4 : 0);
          setPhase(s.phase === "play" ? "play" : "setup");
        }
      }
    } catch {
      // Corrupt or blocked storage: start fresh.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const s: Saved = { phase, names, rounds, turn };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      // Private mode etc. — play on without persistence.
    }
  }, [hydrated, phase, names, rounds, turn]);

  // ---- audio (Web Audio, no files) ---------------------------------------
  const audioRef = useRef<AudioContext | null>(null);

  function beep(freq: number, durMs: number, type: OscillatorType, gain = 0.07, delayMs = 0) {
    if (!soundOn) return;
    try {
      type Win = Window & { webkitAudioContext?: typeof AudioContext };
      const Ctx = window.AudioContext ?? (window as Win).webkitAudioContext;
      if (!Ctx) return;
      if (!audioRef.current) audioRef.current = new Ctx();
      const ctx = audioRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      const t0 = ctx.currentTime + delayMs / 1000;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + durMs / 1000 + 0.05);
    } catch {
      // Audio is a garnish; never let it break the clock.
    }
  }

  const tick = () => beep(1180, 90, "sine", 0.045);
  const chime = () => {
    beep(660, 160, "sine", 0.06);
    beep(990, 220, "sine", 0.05, 110);
  };
  const buzzer = () => {
    beep(196, 420, "sawtooth", 0.09);
    beep(147, 480, "sawtooth", 0.09, 60);
  };

  // ---- clock loop ---------------------------------------------------------
  useEffect(() => {
    if (!running || endsAt == null) return;
    const id = window.setInterval(() => {
      const left = endsAt - Date.now();
      if (left <= 0) {
        // Time. Buzz, pass the turn, and restart the two minutes.
        buzzer();
        lastTickSecond.current = -1;
        setTurn((t) => (t + 1) % 4);
        setEndsAt(Date.now() + TURN_MS);
        setRemainingMs(TURN_MS);
        return;
      }
      const whole = Math.ceil(left / 1000);
      if (whole <= 10 && whole !== lastTickSecond.current) {
        lastTickSecond.current = whole;
        tick();
      }
      setRemainingMs(left);
    }, 100);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, endsAt, soundOn]);

  function startPause() {
    if (running) {
      setRemainingMs(endsAt ? Math.max(0, endsAt - Date.now()) : remainingMs);
      setEndsAt(null);
      setRunning(false);
    } else {
      // First tap also unlocks the AudioContext (user gesture).
      chime();
      setEndsAt(Date.now() + remainingMs);
      setRunning(true);
    }
  }

  function passTurn() {
    chime();
    lastTickSecond.current = -1;
    setTurn((t) => (t + 1) % 4);
    setRemainingMs(TURN_MS);
    if (running) setEndsAt(Date.now() + TURN_MS);
  }

  function resetClockPaused(nextTurn: number) {
    setRunning(false);
    setEndsAt(null);
    setRemainingMs(TURN_MS);
    lastTickSecond.current = -1;
    setTurn(nextTurn);
  }

  // ---- rounds -------------------------------------------------------------
  function openScoring() {
    setScoring(true);
    setRoundWinner(null);
    setTileEntry(["", "", "", ""]);
    if (running) startPause();
  }

  function bumpTiles(i: number, delta: number) {
    setTileEntry((e) => {
      const next = [...e];
      const v = Math.max(0, (parseInt(next[i], 10) || 0) + delta);
      next[i] = v === 0 ? "" : String(v);
      return next;
    });
  }

  function recordRound() {
    if (roundWinner == null) return;
    const tiles = SEATS.map((i) =>
      i === roundWinner ? 0 : Math.max(0, parseInt(tileEntry[i], 10) || 0),
    );
    setRounds((r) => [...r, { winner: roundWinner, tiles }]);
    setScoring(false);
    chime();
    // Honors: the winner leads the next round, clock racked and paused.
    resetClockPaused(roundWinner);
  }

  function closeTable() {
    setRounds([]);
    setTurn(0);
    setPhase("setup");
    setScoring(false);
    setConfirmingReset(false);
    resetClockPaused(0);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // fine
    }
  }

  const score = totals(rounds);
  const best = rounds.length ? Math.max(...score) : null;
  const secs = Math.ceil(remainingMs / 1000);
  const clockText = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const frac = remainingMs / TURN_MS;
  const urgent = running && secs <= 10;
  const potPreview =
    roundWinner == null
      ? 0
      : SEATS.reduce(
          (a, i) => a + (i === roundWinner ? 0 : Math.max(0, parseInt(tileEntry[i], 10) || 0)),
          0,
        );

  const R = 112;
  const CIRC = 2 * Math.PI * R;

  if (!hydrated) {
    return <div className="bb-root" aria-hidden="true" style={{ minHeight: "100vh" }} />;
  }

  return (
    <div className="bb-root">
      <style>{CSS_TEXT}</style>

      {/* Cabana awning */}
      <div className="bb-awning" aria-hidden="true" />
      <div className="bb-scallops" aria-hidden="true" />

      <main className="bb-shellwrap">
        {/* Masthead */}
        <header className="bb-masthead">
          <div className="bb-crest" aria-hidden="true">
            <span>TR</span>
          </div>
          <p className="bb-label">Members &amp; their guests</p>
          <h1 className="bb-title">The Tile Room</h1>
          <div className="bb-rule">
            <span className="bb-rule-line" />
            <span className="bb-rule-diamond" aria-hidden="true">
              ◆
            </span>
            <span className="bb-rule-line" />
          </div>
          <p className="bb-sub">
            Rummikub, played properly. <em>Two minutes a turn, no exceptions.</em>
          </p>
        </header>

        {phase === "setup" ? (
          /* ------------------------------ setup ----------------------------- */
          <section className="bb-panel">
            <p className="bb-label bb-panel-label">This evening&rsquo;s foursome</p>
            <div className="bb-namegrid">
              {SEATS.map((i) => (
                <label key={i} className="bb-namefield">
                  <span className="bb-tilechip" style={{ color: TILE_COLORS[i] }}>
                    {SEAT_NUMERALS[i]}
                  </span>
                  <input
                    type="text"
                    value={names[i]}
                    maxLength={18}
                    placeholder={`Seat ${SEAT_NUMERALS[i]}`}
                    onChange={(e) =>
                      setNames((n) => n.map((v, j) => (j === i ? e.target.value : v)))
                    }
                  />
                </label>
              ))}
            </div>
            <button className="bb-btn bb-btn-primary" onClick={() => setPhase("play")}>
              Open the table
            </button>
            <p className="bb-fineprint">
              Names are optional; unclaimed seats play as Seats I through IV.
            </p>
          </section>
        ) : (
          /* ------------------------------- play ----------------------------- */
          <>
            {/* Turn clock */}
            <section className="bb-clock" aria-label="Turn clock">
              <p className="bb-label">
                On the tiles
                <button
                  className="bb-soundtoggle"
                  onClick={() => setSoundOn((s) => !s)}
                  aria-pressed={soundOn}
                  title={soundOn ? "Bell on" : "Bell off"}
                >
                  {soundOn ? "bell on" : "bell off"}
                </button>
              </p>
              <p className="bb-turnname" style={{ color: TILE_COLORS[turn] }}>
                {seatName(names, turn)}
              </p>
              <div className={`bb-ringwrap${urgent ? " bb-urgent" : ""}`}>
                <svg viewBox="0 0 260 260" className="bb-ring" role="img" aria-label={`${clockText} remaining`}>
                  <circle cx="130" cy="130" r={R} className="bb-ring-track" />
                  <circle
                    cx="130"
                    cy="130"
                    r={R}
                    className="bb-ring-fill"
                    style={{
                      strokeDasharray: CIRC,
                      strokeDashoffset: CIRC * (1 - frac),
                      stroke: urgent ? "#B5432F" : undefined,
                    }}
                  />
                </svg>
                <div className="bb-clockface">
                  <span className="bb-clocktime">{clockText}</span>
                  <span className="bb-label bb-clockcaption">
                    {running ? "on the clock" : remainingMs === TURN_MS ? "racked" : "held"}
                  </span>
                </div>
              </div>
              <div className="bb-clockbtns">
                <button className="bb-btn bb-btn-outline" onClick={startPause}>
                  {running ? "Hold" : remainingMs === TURN_MS ? "Start the clock" : "Resume"}
                </button>
                <button className="bb-btn bb-btn-primary" onClick={passTurn}>
                  Pass the turn
                </button>
              </div>
            </section>

            {/* Standings */}
            <section className="bb-panel">
              <p className="bb-label bb-panel-label">Standings</p>
              <ol className="bb-standings">
                {SEATS.map((i) => (
                  <li key={i}>
                    <span className="bb-tilechip" style={{ color: TILE_COLORS[i] }}>
                      {SEAT_NUMERALS[i]}
                    </span>
                    <span className={`bb-standname${i === turn ? " bb-standname-turn" : ""}`}>
                      {seatName(names, i)}
                      {best != null && score[i] === best && (
                        <span className="bb-laurel" title="Leading"> ✦</span>
                      )}
                    </span>
                    <span className="bb-dots" aria-hidden="true" />
                    <span className={`bb-standscore${score[i] < 0 ? " bb-neg" : ""}`}>
                      {score[i] > 0 ? `+${score[i]}` : score[i]}
                    </span>
                  </li>
                ))}
              </ol>

              {!scoring ? (
                <button className="bb-btn bb-btn-brass" onClick={openScoring}>
                  Score a round
                </button>
              ) : (
                <div className="bb-scorepanel">
                  <p className="bb-label bb-panel-label">Who went out?</p>
                  <div className="bb-winnerrow">
                    {SEATS.map((i) => (
                      <button
                        key={i}
                        className={`bb-winnerbtn${roundWinner === i ? " bb-winnerbtn-on" : ""}`}
                        style={{ color: TILE_COLORS[i] }}
                        onClick={() => setRoundWinner(i)}
                      >
                        {seatName(names, i)}
                      </button>
                    ))}
                  </div>

                  {roundWinner != null && (
                    <>
                      <p className="bb-label bb-panel-label">Tiles left on each rack</p>
                      {SEATS.filter((i) => i !== roundWinner).map((i) => (
                        <div key={i} className="bb-tilerow">
                          <span className="bb-tilerowname" style={{ color: TILE_COLORS[i] }}>
                            {seatName(names, i)}
                          </span>
                          <div className="bb-stepper">
                            <button onClick={() => bumpTiles(i, -1)} aria-label="minus one">
                              −
                            </button>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={tileEntry[i]}
                              placeholder="0"
                              onChange={(e) =>
                                setTileEntry((t) =>
                                  t.map((v, j) =>
                                    j === i ? e.target.value.replace(/[^0-9]/g, "").slice(0, 3) : v,
                                  ),
                                )
                              }
                            />
                            <button onClick={() => bumpTiles(i, 1)} aria-label="plus one">
                              +
                            </button>
                            <button className="bb-step5" onClick={() => bumpTiles(i, 5)}>
                              +5
                            </button>
                          </div>
                        </div>
                      ))}
                      <p className="bb-potline">
                        {seatName(names, roundWinner)} collects{" "}
                        <strong>+{potPreview}</strong>
                        {potPreview === 0 && " (enter the losers’ leftover tile points)"}
                      </p>
                    </>
                  )}

                  <div className="bb-clockbtns">
                    <button className="bb-btn bb-btn-outline" onClick={() => setScoring(false)}>
                      Never mind
                    </button>
                    <button
                      className="bb-btn bb-btn-brass"
                      disabled={roundWinner == null}
                      onClick={recordRound}
                    >
                      Enter it in the ledger
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* Ledger */}
            {rounds.length > 0 && (
              <section className="bb-panel">
                <p className="bb-label bb-panel-label">The ledger</p>
                <div className="bb-ledgerwrap">
                  <table className="bb-ledger">
                    <thead>
                      <tr>
                        <th>Rd</th>
                        {SEATS.map((i) => (
                          <th key={i} style={{ color: TILE_COLORS[i] }}>
                            {seatName(names, i)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rounds.map((r, n) => {
                        const pot = r.tiles.reduce((a, b) => a + b, 0);
                        return (
                          <tr key={n}>
                            <td>{n + 1}</td>
                            {SEATS.map((i) => (
                              <td key={i} className={i === r.winner ? "bb-win" : "bb-neg"}>
                                {i === r.winner ? `+${pot}` : `−${r.tiles[i]}`}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                      <tr className="bb-totalrow">
                        <td>—</td>
                        {SEATS.map((i) => (
                          <td key={i} className={score[i] < 0 ? "bb-neg" : "bb-win"}>
                            {score[i] > 0 ? `+${score[i]}` : score[i]}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Close the table */}
            <div className="bb-closerow">
              {!confirmingReset ? (
                <button className="bb-linkbtn" onClick={() => setConfirmingReset(true)}>
                  Close the table
                </button>
              ) : (
                <span className="bb-confirm">
                  Clear names and every round?
                  <button className="bb-linkbtn bb-linkbtn-danger" onClick={closeTable}>
                    Yes, close it
                  </button>
                  <button className="bb-linkbtn" onClick={() => setConfirmingReset(false)}>
                    Keep playing
                  </button>
                </span>
              )}
            </div>
          </>
        )}

        <p className="bb-colophon">est. one rainy evening · Highway 4</p>
      </main>
    </div>
  );
}

// Scoped theme: coastal-club navy, sand, and brass. All class names are
// bb-prefixed so nothing leaks into (or in from) the site's Tailwind theme.
const CSS_TEXT = `
.bb-root {
  --bb-navy: #17334D;
  --bb-navy-deep: #0E2337;
  --bb-sand: #F4ECDD;
  --bb-shell: #FBF7EC;
  --bb-brass: #A0812F;
  --bb-line: rgba(23, 51, 77, 0.22);
  background: var(--bb-sand);
  color: var(--bb-navy);
  min-height: 100vh;
  font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif);
}
.bb-awning {
  height: 26px;
  background: repeating-linear-gradient(90deg, var(--bb-navy) 0 40px, var(--bb-shell) 40px 80px);
}
.bb-scallops {
  height: 18px;
  background:
    radial-gradient(circle at 20px -3px, var(--bb-navy) 0 17px, transparent 18px) repeat-x,
    radial-gradient(circle at 20px -3px, var(--bb-shell) 0 17px, transparent 18px) repeat-x;
  background-size: 80px 20px;
  background-position: 0 0, 40px 0;
}
.bb-shellwrap {
  max-width: 660px;
  margin: 0 auto;
  padding: clamp(24px, 5vw, 48px) 20px 56px;
}
.bb-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--bb-navy) 72%, var(--bb-sand));
}
.bb-masthead { text-align: center; margin-bottom: clamp(28px, 6vw, 44px); }
.bb-crest {
  width: 64px; height: 64px; margin: 0 auto 14px;
  border: 1.5px solid var(--bb-brass);
  outline: 1px solid var(--bb-brass);
  outline-offset: 4px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
}
.bb-crest span {
  font-family: var(--font-club, Georgia, serif);
  font-style: italic; font-weight: 600; font-size: 24px;
  color: var(--bb-brass); letter-spacing: 0.06em;
}
.bb-title {
  font-family: var(--font-club, Georgia, serif);
  font-weight: 600;
  font-size: clamp(42px, 9vw, 62px);
  line-height: 1.02;
  margin: 6px 0 10px;
  letter-spacing: 0.01em;
}
.bb-rule { display: flex; align-items: center; gap: 10px; max-width: 300px; margin: 0 auto 12px; }
.bb-rule-line { flex: 1; height: 1px; background: var(--bb-line); }
.bb-rule-diamond { color: var(--bb-brass); font-size: 9px; }
.bb-sub {
  font-family: var(--font-club, Georgia, serif);
  font-size: 18px; color: color-mix(in srgb, var(--bb-navy) 80%, var(--bb-sand));
}
.bb-sub em { color: var(--bb-brass); }

.bb-panel {
  background: var(--bb-shell);
  border: 1px solid var(--bb-line);
  border-radius: 2px;
  padding: clamp(20px, 4.5vw, 30px);
  margin-bottom: 22px;
  box-shadow: 0 1px 0 rgba(14, 35, 55, 0.05), 0 12px 28px -18px rgba(14, 35, 55, 0.28);
}
.bb-panel-label { margin-bottom: 14px; }

.bb-namegrid { display: grid; gap: 14px; margin-bottom: 22px; }
.bb-namefield { display: flex; align-items: center; gap: 12px; }
.bb-namefield input {
  flex: 1; background: transparent; border: 0;
  border-bottom: 1px solid var(--bb-line);
  font-family: var(--font-club, Georgia, serif);
  font-size: 20px; padding: 6px 2px; color: var(--bb-navy); outline: none;
}
.bb-namefield input:focus { border-bottom-color: var(--bb-brass); }
.bb-namefield input::placeholder { color: color-mix(in srgb, var(--bb-navy) 38%, var(--bb-sand)); }

.bb-tilechip {
  width: 34px; height: 42px; flex: none;
  background: #FDFAF1;
  border: 1px solid rgba(23, 51, 77, 0.18);
  border-radius: 5px;
  box-shadow: inset 0 -2px 0 rgba(23, 51, 77, 0.08), 0 1px 2px rgba(14, 35, 55, 0.15);
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-club, Georgia, serif);
  font-weight: 700; font-size: 16px;
}

.bb-btn {
  display: inline-block; width: 100%;
  padding: 13px 18px;
  font-size: 12px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase;
  border-radius: 2px; border: 1px solid var(--bb-navy);
  cursor: pointer; transition: transform 0.12s ease, background 0.15s ease, color 0.15s ease;
  font-family: inherit;
}
.bb-btn:active { transform: translateY(1px); }
.bb-btn:disabled { opacity: 0.4; cursor: default; }
.bb-btn-primary { background: var(--bb-navy); color: var(--bb-shell); }
.bb-btn-primary:hover { background: var(--bb-navy-deep); }
.bb-btn-outline { background: transparent; color: var(--bb-navy); }
.bb-btn-outline:hover { background: rgba(23, 51, 77, 0.06); }
.bb-btn-brass { background: transparent; border-color: var(--bb-brass); color: var(--bb-brass); }
.bb-btn-brass:hover:not(:disabled) { background: var(--bb-brass); color: var(--bb-shell); }
.bb-fineprint { margin-top: 12px; font-size: 13px; text-align: center;
  color: color-mix(in srgb, var(--bb-navy) 60%, var(--bb-sand)); }

.bb-clock { text-align: center; margin-bottom: 22px; }
.bb-soundtoggle {
  margin-left: 10px; background: none; border: 0; cursor: pointer;
  font: inherit; letter-spacing: inherit; text-transform: inherit;
  color: var(--bb-brass); text-decoration: underline dotted; text-underline-offset: 3px;
}
.bb-turnname {
  font-family: var(--font-club, Georgia, serif);
  font-weight: 700; font-size: clamp(28px, 6vw, 36px); margin: 6px 0 14px;
}
.bb-ringwrap { position: relative; width: min(66vw, 250px); margin: 0 auto 18px; }
.bb-ring { width: 100%; height: auto; transform: rotate(-90deg); display: block; }
.bb-ring-track { fill: none; stroke: rgba(23, 51, 77, 0.13); stroke-width: 7; }
.bb-ring-fill {
  fill: none; stroke: var(--bb-brass); stroke-width: 7; stroke-linecap: round;
  transition: stroke-dashoffset 0.15s linear, stroke 0.3s ease;
}
.bb-clockface {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
}
.bb-clocktime {
  font-family: var(--font-club, Georgia, serif);
  font-weight: 600; font-size: clamp(52px, 13vw, 68px); line-height: 1;
  font-variant-numeric: tabular-nums;
}
.bb-clockcaption { letter-spacing: 0.3em; }
.bb-urgent .bb-clocktime { color: #B5432F; animation: bb-pulse 1s ease infinite; }
@keyframes bb-pulse { 50% { opacity: 0.55; } }
@media (prefers-reduced-motion: reduce) { .bb-urgent .bb-clocktime { animation: none; } }
.bb-clockbtns { display: flex; gap: 10px; margin-top: 14px; }
.bb-clockbtns .bb-btn { width: auto; flex: 1; }

.bb-standings { list-style: none; margin: 0 0 20px; padding: 0; display: grid; gap: 12px; }
.bb-standings li { display: flex; align-items: center; gap: 12px; }
.bb-standname { font-family: var(--font-club, Georgia, serif); font-size: 20px; font-weight: 600; }
.bb-standname-turn { text-decoration: underline; text-decoration-color: var(--bb-brass); text-underline-offset: 5px; }
.bb-laurel { color: var(--bb-brass); }
.bb-dots { flex: 1; border-bottom: 2px dotted rgba(23, 51, 77, 0.3); transform: translateY(-4px); }
.bb-standscore {
  font-family: var(--font-club, Georgia, serif);
  font-weight: 700; font-size: 22px; font-variant-numeric: tabular-nums;
}
.bb-neg { color: #A34531; }
.bb-win { color: #33691E; }

.bb-scorepanel { border-top: 1px solid var(--bb-line); padding-top: 18px; }
.bb-winnerrow { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 18px; }
.bb-winnerbtn {
  padding: 11px 8px; background: #FDFAF1;
  border: 1px solid rgba(23, 51, 77, 0.18); border-radius: 5px;
  box-shadow: inset 0 -2px 0 rgba(23, 51, 77, 0.08);
  font-family: var(--font-club, Georgia, serif); font-weight: 700; font-size: 17px;
  cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.bb-winnerbtn-on { outline: 2px solid var(--bb-brass); outline-offset: 1px; background: #FFFDF6; }
.bb-tilerow { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.bb-tilerowname {
  font-family: var(--font-club, Georgia, serif); font-weight: 600; font-size: 18px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.bb-stepper { display: flex; align-items: center; gap: 6px; flex: none; }
.bb-stepper button {
  width: 38px; height: 38px; border: 1px solid var(--bb-line); border-radius: 2px;
  background: transparent; color: var(--bb-navy); font-size: 18px; cursor: pointer;
}
.bb-stepper button:hover { background: rgba(23, 51, 77, 0.06); }
.bb-stepper .bb-step5 { width: 44px; font-size: 13px; font-weight: 700; }
.bb-stepper input {
  width: 52px; text-align: center; background: transparent;
  border: 0; border-bottom: 1px solid var(--bb-line);
  font-family: var(--font-club, Georgia, serif); font-size: 22px; font-weight: 700;
  color: var(--bb-navy); outline: none; padding: 4px 0;
  font-variant-numeric: tabular-nums;
}
.bb-stepper input:focus { border-bottom-color: var(--bb-brass); }
.bb-potline {
  font-family: var(--font-club, Georgia, serif); font-size: 17px;
  margin: 6px 0 14px; color: color-mix(in srgb, var(--bb-navy) 80%, var(--bb-sand));
}
.bb-potline strong { color: #33691E; font-size: 20px; }

.bb-ledgerwrap { overflow-x: auto; }
.bb-ledger { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.bb-ledger th {
  font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
  text-align: right; padding: 6px 8px; border-bottom: 1px solid var(--bb-line);
  max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.bb-ledger th:first-child, .bb-ledger td:first-child {
  text-align: left; color: color-mix(in srgb, var(--bb-navy) 55%, var(--bb-sand));
}
.bb-ledger td {
  font-family: var(--font-club, Georgia, serif); font-size: 17px; font-weight: 600;
  text-align: right; padding: 7px 8px; border-bottom: 1px dotted rgba(23, 51, 77, 0.16);
}
.bb-totalrow td { border-top: 2px solid var(--bb-navy); border-bottom: 0; font-size: 19px; font-weight: 700; }

.bb-closerow { text-align: center; margin-top: 6px; }
.bb-linkbtn {
  background: none; border: 0; cursor: pointer; font-size: 12px; font-weight: 600;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: color-mix(in srgb, var(--bb-navy) 62%, var(--bb-sand));
  text-decoration: underline; text-underline-offset: 4px; padding: 6px 8px;
  font-family: inherit;
}
.bb-linkbtn-danger { color: #A34531; }
.bb-confirm { font-size: 13px; color: color-mix(in srgb, var(--bb-navy) 70%, var(--bb-sand)); }

.bb-colophon {
  margin-top: 34px; text-align: center;
  font-family: var(--font-club, Georgia, serif); font-style: italic; font-size: 15px;
  color: color-mix(in srgb, var(--bb-navy) 55%, var(--bb-sand));
}
`;
