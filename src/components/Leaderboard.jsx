/**
 * Leaderboard.jsx  —  STR/VOL Global Leaderboard
 *
 * Ranks all users by all-time best e1RM for the Big 3 lifts.
 * Data comes from the `get_global_leaderboard` Postgres function
 * via fetchLeaderboardData() in src/lib/supabase.js.
 *
 * Features:
 *   • Lift toggle: Squat · Bench · Deadlift
 *   • Top-3 podium with gold / silver / bronze accents
 *   • Full ranked list with avatar, name, e1RM, raw weight, sets
 *   • "You" highlight — current user's row is accented in amber
 *   • Refresh button with cooldown
 *   • Empty / loading / error states
 *
 * Props:
 *   user  — Supabase User object (used to highlight the
 *           current user's row; auth via Supabase client)
 */

import { useState, useEffect, useCallback } from "react";
import { fetchLeaderboardData } from "../lib/supabase";

// ── Big 3 lift definitions ─────────────────────────────────────
const LIFTS = [
    {
        id:       "squat",
        label:    "SQUAT",
        db:       "Back Squat",
        icon:     "🏋️",
        color:    "#a78bfa",   // violet-400
        colorDim: "#a78bfa28",
        border:   "border-violet-800",
        text:     "text-violet-400",
        bg:       "bg-violet-950",
    },
    {
        id:       "bench",
        label:    "BENCH",
        db:       "Bench Press",
        icon:     "💪",
        color:    "#60a5fa",   // blue-400
        colorDim: "#60a5fa28",
        border:   "border-blue-800",
        text:     "text-blue-400",
        bg:       "bg-blue-950",
    },
    {
        id:       "deadlift",
        label:    "DEADLIFT",
        db:       "Conventional Deadlift",
        icon:     "⛓️",
        color:    "#fb923c",   // orange-400
        colorDim: "#fb923c28",
        border:   "border-orange-800",
        text:     "text-orange-400",
        bg:       "bg-orange-950",
    },
];

// ── Medal config ───────────────────────────────────────────────
const MEDALS = [
    { rank: 1, label: "1ST",  color: "#fbbf24", bg: "#fbbf2418", border: "#fbbf2440", glyph: "🥇", size: "text-2xl" },
    { rank: 2, label: "2ND",  color: "#94a3b8", bg: "#94a3b818", border: "#94a3b840", glyph: "🥈", size: "text-xl"  },
    { rank: 3, label: "3RD",  color: "#d97706", bg: "#d9770618", border: "#d9770640", glyph: "🥉", size: "text-xl"  },
];

const FONT = "'IBM Plex Mono', monospace";

// ── Avatar ─────────────────────────────────────────────────────
function Avatar({ name, size = 36, color = "#f59e0b", isMe = false }) {
    const initial = (name ?? "?").charAt(0).toUpperCase();
    return (
        <div style={{
            width: size, height: size, borderRadius: "50%",
            background: isMe ? "#f59e0b18" : "#27272a",
            border: `1.5px solid ${isMe ? "#f59e0b60" : color + "50"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
        }}>
      <span style={{
          color: isMe ? "#f59e0b" : color,
          fontSize: size * 0.38, fontWeight: "bold",
          fontFamily: FONT, lineHeight: 1, userSelect: "none",
      }}>
        {initial}
      </span>
        </div>
    );
}

// ── Podium card (top 3) ────────────────────────────────────────
function PodiumCard({ entry, lift, isMe }) {
    const medal = MEDALS.find(m => m.rank === entry.rank);
    if (!medal) return null;

    const isFirst = entry.rank === 1;

    return (
        <div style={{
            flex: 1, minWidth: 0,
            background: medal.bg,
            border: `1px solid ${medal.border}`,
            borderRadius: 12,
            padding: isFirst ? "20px 16px 16px" : "16px 12px 12px",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
            position: "relative",
            transform: isFirst ? "translateY(-8px)" : "none",
            transition: "transform 0.2s",
            fontFamily: FONT,
        }}>
            {/* Rank badge */}
            <div style={{
                position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)",
                background: medal.bg, border: `1px solid ${medal.border}`,
                borderRadius: 20, padding: "2px 10px",
                fontSize: 10, fontWeight: "bold", color: medal.color, letterSpacing: "0.08em",
            }}>
                {medal.label}
            </div>

            <span style={{ fontSize: isFirst ? 28 : 22, lineHeight: 1 }}>{medal.glyph}</span>

            <Avatar name={entry.display_name} size={isFirst ? 44 : 36} color={lift.color} isMe={isMe} />

            <div style={{ textAlign: "center", width: "100%" }}>
                <div style={{
                    color: isMe ? "#f59e0b" : "#e4e4e7",
                    fontSize: 11, fontWeight: "bold",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    maxWidth: "100%",
                }}>
                    {entry.display_name}
                    {isMe && <span style={{ color:"#f59e0b", fontSize:9, marginLeft:4 }}>YOU</span>}
                </div>
                <div style={{ color: medal.color, fontSize: isFirst ? 20 : 16, fontWeight: "bold", marginTop: 4, lineHeight: 1 }}>
                    {entry.best_e1rm_kg != null ? entry.best_e1rm_kg.toFixed(1) : "—"}
                    <span style={{ color: "#52525b", fontSize: 9, marginLeft: 2 }}>kg e1RM</span>
                </div>
                <div style={{ color: "#52525b", fontSize: 9, marginTop: 3 }}>
                    {entry.best_weight_kg != null ? `${entry.best_weight_kg}kg raw` : ""}
                    {entry.total_sets > 0 ? ` · ${entry.total_sets} sets` : ""}
                </div>
            </div>
        </div>
    );
}

// ── E1RM bar (visual width relative to leader) ─────────────────
function E1rmBar({ value, max, color }) {
    const pct = max > 0 ? Math.max(3, (value / max) * 100) : 0;
    return (
        <div style={{ flex: 1, height: 4, background: "#27272a", borderRadius: 2, overflow: "hidden" }}>
            <div style={{
                width: `${pct}%`, height: "100%",
                background: color, borderRadius: 2,
                transition: "width 0.5s ease",
            }} />
        </div>
    );
}

// ── Full ranked list row ───────────────────────────────────────
function RankRow({ entry, lift, isMe, maxE1rm, animate, animDelay }) {
    const medal = MEDALS.find(m => m.rank === entry.rank);

    return (
        <div style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "12px 16px",
            background: isMe ? "#f59e0b08" : medal ? medal.bg : "transparent",
            border: `1px solid ${isMe ? "#f59e0b30" : medal ? medal.border : "#27272a"}`,
            borderRadius: 10,
            fontFamily: FONT,
            opacity: animate ? 0 : 1,
            transform: animate ? "translateY(8px)" : "translateY(0)",
            transition: `opacity 0.35s ease ${animDelay}ms, transform 0.35s ease ${animDelay}ms`,
        }}>
            {/* Rank number */}
            <div style={{
                width: 28, textAlign: "center", flexShrink: 0,
            }}>
                {medal
                    ? <span style={{ fontSize: 18 }}>{medal.glyph}</span>
                    : <span style={{ color: "#52525b", fontSize: 12, fontWeight: "bold" }}>#{entry.rank}</span>
                }
            </div>

            {/* Avatar */}
            <Avatar name={entry.display_name} size={32} color={medal?.color ?? lift.color} isMe={isMe} />

            {/* Name + bar */}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
              color: isMe ? "#f59e0b" : medal ? medal.color : "#d4d4d8",
              fontSize: 12, fontWeight: "bold",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {entry.display_name}
          </span>
                    {isMe && (
                        <span style={{
                            background: "#f59e0b20", border: "1px solid #f59e0b40",
                            borderRadius: 10, padding: "1px 6px",
                            color: "#f59e0b", fontSize: 9, fontWeight: "bold", letterSpacing: "0.08em",
                            flexShrink: 0,
                        }}>
              YOU
            </span>
                    )}
                </div>
                <E1rmBar value={entry.best_e1rm_kg ?? 0} max={maxE1rm} color={medal?.color ?? lift.color} />
            </div>

            {/* Stats */}
            <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{
                    color: medal?.color ?? lift.color,
                    fontSize: 15, fontWeight: "bold", lineHeight: 1,
                }}>
                    {entry.best_e1rm_kg != null ? entry.best_e1rm_kg.toFixed(1) : "—"}
                    <span style={{ color: "#52525b", fontSize: 9, marginLeft: 2 }}>kg</span>
                </div>
                <div style={{ color: "#52525b", fontSize: 9, marginTop: 2 }}>
                    e1RM
                </div>
                {entry.best_weight_kg != null && (
                    <div style={{ color: "#3f3f46", fontSize: 9 }}>
                        {entry.best_weight_kg}kg raw
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Skeleton loader row ────────────────────────────────────────
function SkeletonRow({ delay = 0 }) {
    return (
        <div style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "12px 16px",
            background: "#18181b", border: "1px solid #27272a", borderRadius: 10,
            animation: `pulse 1.5s ease-in-out ${delay}ms infinite`,
        }}>
            <div style={{ width: 28, height: 14, background: "#27272a", borderRadius: 4 }} />
            <div style={{ width: 32, height: 32, background: "#27272a", borderRadius: "50%" }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ height: 10, background: "#27272a", borderRadius: 4, width: "40%" }} />
                <div style={{ height: 4,  background: "#27272a", borderRadius: 2, width: "70%" }} />
            </div>
            <div style={{ width: 40, height: 16, background: "#27272a", borderRadius: 4 }} />
        </div>
    );
}

// ── Lift toggle button ─────────────────────────────────────────
function LiftTab({ lift, active, onClick }) {
    return (
        <button onClick={onClick} style={{
            flex: 1, padding: "10px 8px",
            background: active ? lift.colorDim : "transparent",
            border: `1px solid ${active ? lift.color + "60" : "#3f3f46"}`,
            borderRadius: 8, cursor: "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            transition: "all 0.15s",
            fontFamily: FONT,
        }}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>{lift.icon}</span>
            <span style={{
                fontSize: 10, fontWeight: "bold", letterSpacing: "0.1em",
                color: active ? lift.color : "#52525b",
            }}>
        {lift.label}
      </span>
        </button>
    );
}

// ── Refresh button ─────────────────────────────────────────────
function RefreshButton({ onClick, loading, cooldown }) {
    return (
        <button onClick={onClick} disabled={loading || cooldown} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 12px", borderRadius: 6,
            background: "transparent",
            border: "1px solid #3f3f46",
            cursor: loading || cooldown ? "not-allowed" : "pointer",
            opacity: loading || cooldown ? 0.5 : 1,
            transition: "all 0.15s",
            fontFamily: FONT,
        }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                 stroke={loading ? "#f59e0b" : "#71717a"} strokeWidth="2.5" strokeLinecap="round"
                 style={{ animation: loading ? "spin 1s linear infinite" : "none" }}>
                <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
            <span style={{ fontSize: 10, color: "#71717a", letterSpacing: "0.08em" }}>
        {loading ? "LOADING…" : cooldown ? "WAIT…" : "REFRESH"}
      </span>
        </button>
    );
}

// ── Main Leaderboard component ─────────────────────────────────
export default function Leaderboard({ user }) {
    const [activeLift, setActiveLift]   = useState(LIFTS[0]);
    const [data, setData]               = useState([]);
    const [loading, setLoading]         = useState(true);
    const [error, setError]             = useState(null);
    const [cooldown, setCooldown]       = useState(false);
    const [animating, setAnimating]     = useState(false);
    const [lastUpdated, setLastUpdated] = useState(null);

    const myUserId = user?.id ?? null;

    const load = useCallback(async (lift, isRefresh = false) => {
        setLoading(true);
        setError(null);
        if (!isRefresh) setAnimating(true);

        const { data: rows, error: err } = await fetchLeaderboardData(lift.db);

        if (err) {
            setError(err.message ?? "Failed to load leaderboard.");
            setLoading(false);
            return;
        }

        setData(rows);
        setLastUpdated(new Date());
        setLoading(false);

        // Trigger entrance animation
        setTimeout(() => setAnimating(false), 50);

        // Refresh cooldown (10 s)
        if (isRefresh) {
            setCooldown(true);
            setTimeout(() => setCooldown(false), 10_000);
        }
    }, []);

    // Load whenever the active lift changes
    useEffect(() => {
        load(activeLift, false);
    }, [activeLift, load]);

    const topThree   = data.filter(r => r.rank <= 3);
    const restOfList = data.filter(r => r.rank > 3);
    const maxE1rm    = data[0]?.best_e1rm_kg ?? 1;

    // Find current user's position for the "your rank" banner
    const myEntry = data.find(r => r.user_id === myUserId);

    return (
        <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: 20 }}>

            {/* CSS keyframes injected once */}
            <style>{`
        @keyframes spin  { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
      `}</style>

            {/* ── Header ── */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                    <div style={{ color: "#d4d4d8", fontSize: 15, fontWeight: "bold", letterSpacing: "0.03em" }}>
                        Global Leaderboard
                    </div>
                    <div style={{ color: "#52525b", fontSize: 10, marginTop: 2 }}>
                        All-time best e1RM · The Big 3
                        {lastUpdated && (
                            <span style={{ marginLeft: 8 }}>
                · Updated {lastUpdated.toLocaleTimeString(undefined, { hour:"2-digit", minute:"2-digit" })}
              </span>
                        )}
                    </div>
                </div>
                <RefreshButton
                    onClick={() => load(activeLift, true)}
                    loading={loading}
                    cooldown={cooldown}
                />
            </div>

            {/* ── Lift selector ── */}
            <div style={{ display: "flex", gap: 8 }}>
                {LIFTS.map(lift => (
                    <LiftTab
                        key={lift.id}
                        lift={lift}
                        active={activeLift.id === lift.id}
                        onClick={() => { if (activeLift.id !== lift.id) setActiveLift(lift); }}
                    />
                ))}
            </div>

            {/* ── Current lift label ── */}
            <div style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 14px",
                background: activeLift.colorDim,
                border: `1px solid ${activeLift.color}30`,
                borderRadius: 8,
            }}>
                <span style={{ fontSize: 16 }}>{activeLift.icon}</span>
                <span style={{ color: activeLift.color, fontSize: 11, fontWeight: "bold", letterSpacing: "0.1em" }}>
          {activeLift.db.toUpperCase()}
        </span>
                {!loading && data.length > 0 && (
                    <span style={{ color: "#52525b", fontSize: 10, marginLeft: "auto" }}>
            {data.length} athlete{data.length !== 1 ? "s" : ""} ranked
          </span>
                )}
            </div>

            {/* ── Error state ── */}
            {error && (
                <div style={{
                    padding: "14px 16px", background: "#2d0a0a",
                    border: "1px solid #7f1d1d", borderRadius: 10,
                }}>
                    <p style={{ color: "#f87171", fontSize: 12, margin: 0 }}>
                        {error}
                    </p>
                </div>
            )}

            {/* ── Loading skeleton ── */}
            {loading && !error && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[0, 80, 160, 240, 320].map(d => <SkeletonRow key={d} delay={d} />)}
                </div>
            )}

            {/* ── Empty state ── */}
            {!loading && !error && data.length === 0 && (
                <div style={{
                    textAlign: "center", padding: "56px 24px",
                    border: "1px dashed #27272a", borderRadius: 12,
                    color: "#3f3f46", fontSize: 13,
                }}>
                    No data yet for {activeLift.db}.<br />
                    <span style={{ color: "#27272a", fontSize: 11 }}>
            Be the first to log a set and claim the top spot.
          </span>
                </div>
            )}

            {/* ── Podium (top 3) ── */}
            {!loading && !error && topThree.length > 0 && (
                <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                    {/* Reorder: 2nd · 1st · 3rd for classic podium layout */}
                    {[
                        topThree.find(r => r.rank === 2),
                        topThree.find(r => r.rank === 1),
                        topThree.find(r => r.rank === 3),
                    ].filter(Boolean).map(entry => (
                        <PodiumCard
                            key={entry.user_id}
                            entry={entry}
                            lift={activeLift}
                            isMe={entry.user_id === myUserId}
                        />
                    ))}
                </div>
            )}

            {/* ── "Your rank" sticky banner (only if outside top 3) ── */}
            {!loading && !error && myEntry && myEntry.rank > 3 && (
                <div style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 16px",
                    background: "#f59e0b08", border: "1px solid #f59e0b30",
                    borderRadius: 10,
                }}>
          <span style={{ color: "#f59e0b", fontSize: 10, fontWeight: "bold", letterSpacing: "0.1em" }}>
            YOUR RANK
          </span>
                    <span style={{ color: "#f59e0b", fontSize: 20, fontWeight: "bold" }}>
            #{myEntry.rank}
          </span>
                    <span style={{ color: "#71717a", fontSize: 11 }}>
            {myEntry.best_e1rm_kg != null ? `${myEntry.best_e1rm_kg.toFixed(1)} kg e1RM` : "—"}
          </span>
                    {data[0] && myEntry.best_e1rm_kg != null && (
                        <span style={{ color: "#3f3f46", fontSize: 10, marginLeft: "auto" }}>
              {(data[0].best_e1rm_kg - myEntry.best_e1rm_kg).toFixed(1)} kg behind leader
            </span>
                    )}
                </div>
            )}

            {/* ── Full ranked list (rank 4+, plus top 3 repeated for scroll context) ── */}
            {!loading && !error && data.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ color: "#52525b", fontSize: 10, letterSpacing: "0.1em", paddingLeft: 2, marginBottom: 4 }}>
                        FULL RANKINGS
                    </div>
                    {data.map((entry, i) => (
                        <RankRow
                            key={entry.user_id}
                            entry={entry}
                            lift={activeLift}
                            isMe={entry.user_id === myUserId}
                            maxE1rm={maxE1rm}
                            animate={animating}
                            animDelay={i * 40}
                        />
                    ))}
                </div>
            )}

            {/* ── Footer note ── */}
            {!loading && !error && data.length > 0 && (
                <div style={{
                    textAlign: "center", color: "#3f3f46", fontSize: 9,
                    letterSpacing: "0.06em", paddingBottom: 8,
                }}>
                    Rankings based on Epley estimated 1-rep max (e1RM).
                    Raw lifts only — no equipped / assisted entries distinguished.
                </div>
            )}
        </div>
    );
}