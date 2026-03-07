/**
 * StrengthTracker.jsx  —  STR/VOL v1.0  (Supabase backend)
 *
 * All localStorage reads/writes have been removed.
 * Data flows through the helpers in src/lib/supabase.js:
 *
 *   On mount  → fetchSessionHistory(), fetchTemplates(), fetchUserPRs()
 *   Save      → saveSession()  (from supabaseClient.js)
 *   Templates → saveTemplate(), deleteTemplate(), fetchTemplates()
 *   Chart     → fetchE1rmHistory(), fetchLoggedExercises()
 *   PRs       → fetchUserPRs()  (calls get_user_prs() RPC)
 *
 * Rest-timer duration is the only value still kept in component
 * state (not persisted — trivial to re-enter).
 *
 * Props:
 *   user      — Supabase User object from App.jsx
 *   onSignOut — async fn that calls supabase.auth.signOut()
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
    saveSession      as dbSaveSession,
    fetchSessionHistory,
    saveTemplate     as dbSaveTemplate,
    deleteTemplate   as dbDeleteTemplate,
    fetchTemplates   as dbFetchTemplates,
    fetchUserPRs,
    fetchE1rmHistory,
    fetchLoggedExercises,
} from "../lib/supabase"; // adjust path if needed

// ── Exercise library ───────────────────────────────────────────
const EXERCISE_LIBRARY = [
    { name: "Back Squat",             category: "Legs",      tags: ["quad","glute","compound"] },
    { name: "Front Squat",            category: "Legs",      tags: ["quad","compound"] },
    { name: "Hack Squat",             category: "Legs",      tags: ["quad"] },
    { name: "Leg Press",              category: "Legs",      tags: ["quad","machine"] },
    { name: "Bulgarian Split Squat",  category: "Legs",      tags: ["quad","glute","unilateral"] },
    { name: "Leg Extension",          category: "Legs",      tags: ["quad","machine","isolation"] },
    { name: "Conventional Deadlift",  category: "Posterior", tags: ["hamstring","glute","compound","back"] },
    { name: "Sumo Deadlift",          category: "Posterior", tags: ["hamstring","glute","compound"] },
    { name: "Romanian Deadlift",      category: "Posterior", tags: ["hamstring","glute"] },
    { name: "Hip Thrust",             category: "Posterior", tags: ["glute"] },
    { name: "Good Morning",           category: "Posterior", tags: ["hamstring","lower back"] },
    { name: "Leg Curl",               category: "Posterior", tags: ["hamstring","machine","isolation"] },
    { name: "Nordic Curl",            category: "Posterior", tags: ["hamstring"] },
    { name: "Bench Press",            category: "Push",      tags: ["chest","compound"] },
    { name: "Incline Bench Press",    category: "Push",      tags: ["chest","compound"] },
    { name: "Close-Grip Bench Press", category: "Push",      tags: ["tricep","chest","compound"] },
    { name: "Overhead Press",         category: "Push",      tags: ["shoulder","compound"] },
    { name: "Push Press",             category: "Push",      tags: ["shoulder","compound"] },
    { name: "Dumbbell Shoulder Press",category: "Push",      tags: ["shoulder"] },
    { name: "Lateral Raise",          category: "Push",      tags: ["shoulder","isolation"] },
    { name: "Tricep Pushdown",        category: "Push",      tags: ["tricep","isolation"] },
    { name: "Skull Crusher",          category: "Push",      tags: ["tricep","isolation"] },
    { name: "Dips",                   category: "Push",      tags: ["tricep","chest","compound"] },
    { name: "Barbell Row",            category: "Pull",      tags: ["back","compound"] },
    { name: "Pendlay Row",            category: "Pull",      tags: ["back","compound"] },
    { name: "Dumbbell Row",           category: "Pull",      tags: ["back"] },
    { name: "Pull-Up",                category: "Pull",      tags: ["back","bicep","compound","bodyweight"] },
    { name: "Chin-Up",                category: "Pull",      tags: ["back","bicep","compound","bodyweight"] },
    { name: "Lat Pulldown",           category: "Pull",      tags: ["back","machine"] },
    { name: "Cable Row",              category: "Pull",      tags: ["back","cable"] },
    { name: "Face Pull",              category: "Pull",      tags: ["rear delt","cable"] },
    { name: "Barbell Curl",           category: "Pull",      tags: ["bicep","isolation"] },
    { name: "Dumbbell Curl",          category: "Pull",      tags: ["bicep","isolation"] },
    { name: "Hammer Curl",            category: "Pull",      tags: ["bicep","isolation"] },
    { name: "Ab Wheel Rollout",       category: "Core",      tags: ["core","bodyweight"] },
    { name: "Cable Crunch",           category: "Core",      tags: ["core","cable"] },
    { name: "Plank",                  category: "Core",      tags: ["core","bodyweight"] },
    { name: "Farmers Carry",          category: "Core",      tags: ["core","grip","compound"] },
];

const CATEGORY_COLORS = {
    Legs:      { dot: "#a78bfa", text: "text-violet-400",  border: "border-violet-800",  bg: "bg-violet-950"  },
    Posterior: { dot: "#fb923c", text: "text-orange-400",  border: "border-orange-800",  bg: "bg-orange-950"  },
    Push:      { dot: "#60a5fa", text: "text-blue-400",    border: "border-blue-800",    bg: "bg-blue-950"    },
    Pull:      { dot: "#34d399", text: "text-emerald-400", border: "border-emerald-800", bg: "bg-emerald-950" },
    Core:      { dot: "#f472b6", text: "text-pink-400",    border: "border-pink-800",    bg: "bg-pink-950"    },
};

const RPE_LABELS = { 6:"Very Easy", 7:"Moderate", 7.5:"Hard-ish", 8:"Hard", 8.5:"Very Hard", 9:"Near Max", 9.5:"1-2 left", 10:"Max" };
const DEFAULT_REST = 180;

// ── Pure helpers ───────────────────────────────────────────────
const fmtTime  = (s) => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
const e1rm     = (w, r) => r === 1 ? w : +(w / (1.0278 - 0.0278 * r)).toFixed(1);
const totalVol = (sets) => sets.reduce((a, s) => a + s.weight * s.reps * s.sets, 0);
const dayName  = () => ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date().getDay()];

// ── Loading spinner ────────────────────────────────────────────
function Spinner({ size = 16, className = "" }) {
    return (
        <svg
            className={`animate-spin text-amber-500 ${className}`}
            width={size} height={size}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round"/>
        </svg>
    );
}

// Full-page loading state shown while initial data is fetching
function PageLoader({ label = "Loading…" }) {
    return (
        <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center gap-4"
             style={{ fontFamily: "'IBM Plex Mono',monospace" }}>
            <p className="text-amber-500 font-bold text-2xl tracking-tight leading-none">
                STR<span className="text-zinc-700">/</span>VOL
            </p>
            <div className="flex items-center gap-2 text-zinc-500 text-xs tracking-widest">
                <Spinner size={14} />
                {label}
            </div>
        </div>
    );
}

// ── ExercisePickerModal ────────────────────────────────────────
function ExercisePickerModal({ onSelect, onClose, alreadyAdded = [] }) {
    const [query, setQuery]                   = useState("");
    const [activeCategory, setActiveCategory] = useState("All");
    const [highlighted, setHighlighted]       = useState(0);
    const inputRef = useRef(null);
    const listRef  = useRef(null);

    useEffect(() => { inputRef.current?.focus(); }, []);
    useEffect(() => {
        const h = (e) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [onClose]);

    const categories = ["All", ...Object.keys(CATEGORY_COLORS)];
    const filtered   = EXERCISE_LIBRARY.filter(ex => {
        const matchCat = activeCategory === "All" || ex.category === activeCategory;
        const q        = query.toLowerCase().trim();
        const matchQ   = !q || ex.name.toLowerCase().includes(q) || ex.tags.some(t => t.includes(q));
        return matchCat && matchQ;
    });

    useEffect(() => { setHighlighted(0); }, [query, activeCategory]);
    useEffect(() => {
        const h = (e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted(i => Math.min(i+1, filtered.length-1)); }
            if (e.key === "ArrowUp")   { e.preventDefault(); setHighlighted(i => Math.max(i-1, 0)); }
            if (e.key === "Enter" && filtered[highlighted]) onSelect(filtered[highlighted].name);
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [filtered, highlighted, onSelect]);
    useEffect(() => { listRef.current?.children[highlighted]?.scrollIntoView({ block:"nearest" }); }, [highlighted]);

    const grouped = activeCategory === "All" && !query.trim()
        ? Object.keys(CATEGORY_COLORS).reduce((acc, cat) => { acc[cat] = EXERCISE_LIBRARY.filter(e => e.category === cat); return acc; }, {})
        : null;

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
             style={{ fontFamily:"'IBM Plex Mono',monospace" }}>
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight:"80vh" }}>

                <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 bg-zinc-950">
                    <svg className="text-amber-500 shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                    </svg>
                    <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
                           placeholder="Search exercises or muscles…"
                           className="flex-1 bg-transparent text-zinc-100 placeholder-zinc-600 text-sm outline-none" />
                    {query && <button onClick={() => setQuery("")} className="text-zinc-600 hover:text-zinc-400 text-lg">×</button>}
                    <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-xs tracking-widest border border-zinc-700 rounded px-2 py-1 transition-colors">ESC</button>
                </div>

                <div className="flex gap-1.5 px-4 py-2.5 border-b border-zinc-800 overflow-x-auto">
                    {categories.map(cat => {
                        const color  = CATEGORY_COLORS[cat];
                        const active = activeCategory === cat;
                        return (
                            <button key={cat} onClick={() => setActiveCategory(cat)}
                                    className={`shrink-0 text-xs px-3 py-1 rounded-full border transition-colors font-bold tracking-wide
                  ${active ? cat === "All" ? "bg-amber-500 border-amber-500 text-zinc-900" : `${color.bg} ${color.border} ${color.text}` : "bg-zinc-800 border-zinc-700 text-zinc-500 hover:text-zinc-300"}`}>
                                {cat}
                            </button>
                        );
                    })}
                </div>

                <div className="overflow-y-auto flex-1">
                    {filtered.length === 0 && (
                        <div className="text-center py-12 text-zinc-600 text-sm">No exercises match "{query}"</div>
                    )}
                    {grouped && Object.entries(grouped).map(([cat, exs]) => {
                        const color = CATEGORY_COLORS[cat];
                        return (
                            <div key={cat}>
                                <div className="flex items-center gap-2 px-4 py-2 sticky top-0 bg-zinc-900 border-b border-zinc-800">
                                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color.dot }} />
                                    <span className={`text-xs font-bold tracking-widest uppercase ${color.text}`}>{cat}</span>
                                </div>
                                {exs.map(ex => {
                                    const flatIdx = filtered.indexOf(ex);
                                    const isAdded = alreadyAdded.includes(ex.name);
                                    return <ExerciseRow key={ex.name} ex={ex} isHighlighted={flatIdx === highlighted} isAdded={isAdded} color={color} onMouseEnter={() => setHighlighted(flatIdx)} onClick={() => !isAdded && onSelect(ex.name)} />;
                                })}
                            </div>
                        );
                    })}
                    {!grouped && (
                        <div ref={listRef}>
                            {filtered.map((ex, i) => {
                                const color   = CATEGORY_COLORS[ex.category];
                                const isAdded = alreadyAdded.includes(ex.name);
                                return <ExerciseRow key={ex.name} ex={ex} isHighlighted={i === highlighted} isAdded={isAdded} color={color} query={query} onMouseEnter={() => setHighlighted(i)} onClick={() => !isAdded && onSelect(ex.name)} />;
                            })}
                        </div>
                    )}
                </div>

                <div className="px-4 py-2 border-t border-zinc-800 bg-zinc-950 flex items-center justify-between">
                    <span className="text-zinc-700 text-xs">{filtered.length} exercise{filtered.length !== 1 ? "s" : ""}</span>
                    <span className="text-zinc-700 text-xs">↑↓ navigate · Enter to add</span>
                </div>
            </div>
        </div>
    );
}

function HighlightMatch({ text, query }) {
    if (!query) return <span>{text}</span>;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return <span>{text}</span>;
    return <span>{text.slice(0,idx)}<span className="text-amber-400 font-bold">{text.slice(idx, idx+query.length)}</span>{text.slice(idx+query.length)}</span>;
}

function ExerciseRow({ ex, isHighlighted, isAdded, color, query, onMouseEnter, onClick }) {
    return (
        <button onMouseEnter={onMouseEnter} onClick={onClick} disabled={isAdded}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${isHighlighted ? "bg-zinc-800" : "hover:bg-zinc-800/50"} ${isAdded ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}>
            <div className="flex items-center gap-3">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color.dot }} />
                <span className="text-sm text-zinc-200"><HighlightMatch text={ex.name} query={query} /></span>
            </div>
            <div className="flex items-center gap-2">
                <span className={`text-xs ${color.text} opacity-60`}>{ex.category}</span>
                {isAdded && <span className="text-zinc-600 text-xs">added</span>}
                {!isAdded && isHighlighted && <span className="text-xs text-amber-500 font-bold">+ ADD</span>}
            </div>
        </button>
    );
}

// ── SaveTemplateModal ──────────────────────────────────────────
function SaveTemplateModal({ blocks, onSave, onClose, saving }) {
    const [name, setName] = useState("");
    const inputRef = useRef(null);

    useEffect(() => { inputRef.current?.focus(); }, []);
    useEffect(() => {
        const h = (e) => { if (e.key === "Escape" && !saving) onClose(); };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [onClose, saving]);

    const suggestions = ["Push Day","Pull Day","Heavy Lower","Upper Hypertrophy","Leg Day","Full Body","Squat Focus","Deadlift Focus","Bench Focus"];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ fontFamily:"'IBM Plex Mono',monospace" }}>
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => !saving && onClose()} />
            <div className="relative w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-zinc-950">
                    <div>
                        <div className="text-amber-400 font-bold text-sm tracking-wide">SAVE AS TEMPLATE</div>
                        <div className="text-zinc-600 text-xs mt-0.5">{blocks.length} exercise{blocks.length !== 1 ? "s" : ""} will be saved</div>
                    </div>
                    <button onClick={() => !saving && onClose()} className="text-zinc-600 hover:text-zinc-300 text-lg leading-none transition-colors">×</button>
                </div>

                <div className="px-5 pt-4 flex flex-wrap gap-1.5">
                    {blocks.map(b => {
                        const color = CATEGORY_COLORS[b.category] ?? { dot:"#71717a" };
                        return (
                            <span key={b.exercise} className="flex items-center gap-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded-full px-2.5 py-1 text-zinc-300">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color.dot }} />
                                {b.exercise}
              </span>
                        );
                    })}
                </div>

                <div className="px-5 pt-4 pb-2">
                    <label className="text-zinc-500 text-xs tracking-widest block mb-2">TEMPLATE NAME</label>
                    <input ref={inputRef} value={name} onChange={e => setName(e.target.value)}
                           onKeyDown={e => e.key === "Enter" && name.trim() && !saving && onSave(name.trim())}
                           placeholder="e.g. Push Day, Heavy Lower…" maxLength={40}
                           className="w-full bg-zinc-800 border border-zinc-700 focus:border-amber-500 rounded-lg px-3 py-2.5 text-zinc-100 text-sm outline-none transition-colors placeholder-zinc-600" />
                </div>

                <div className="px-5 pb-4">
                    <div className="text-zinc-700 text-xs mb-2">Quick names:</div>
                    <div className="flex flex-wrap gap-1.5">
                        {suggestions.map(s => (
                            <button key={s} onClick={() => setName(s)}
                                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${name === s ? "bg-amber-500 border-amber-500 text-zinc-900 font-bold" : "bg-zinc-800 border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500"}`}>
                                {s}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex gap-3 px-5 pb-5">
                    <button onClick={() => !saving && onClose()} disabled={saving}
                            className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm font-bold rounded-lg transition-colors tracking-wide disabled:opacity-50">
                        CANCEL
                    </button>
                    <button onClick={() => name.trim() && !saving && onSave(name.trim())} disabled={!name.trim() || saving}
                            className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-colors tracking-wide flex items-center justify-center gap-2
              ${name.trim() && !saving ? "bg-amber-500 hover:bg-amber-400 text-zinc-900" : "bg-zinc-800 text-zinc-600 cursor-not-allowed"}`}>
                        {saving ? <><Spinner size={13} /> SAVING…</> : "SAVE TEMPLATE"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── LoadTemplatePanel ──────────────────────────────────────────
function LoadTemplatePanel({ templates, onLoad, onDelete, onClose, loadingId, deletingId }) {
    useEffect(() => {
        const h = (e) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ fontFamily:"'IBM Plex Mono',monospace" }}>
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight:"75vh" }}>

                <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-zinc-950 shrink-0">
                    <div>
                        <div className="text-amber-400 font-bold text-sm tracking-wide">LOAD TEMPLATE</div>
                        <div className="text-zinc-600 text-xs mt-0.5">Populates a fresh session instantly</div>
                    </div>
                    <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-lg leading-none transition-colors">×</button>
                </div>

                <div className="overflow-y-auto flex-1 p-3 space-y-2">
                    {templates.length === 0 && (
                        <div className="text-center py-10 text-zinc-700 text-sm">No templates saved yet.</div>
                    )}
                    {templates.map(tpl => {
                        const cats = [...new Set((tpl.exercises || []).map(ex => {
                            const meta = EXERCISE_LIBRARY.find(e => e.name === ex.name);
                            return meta?.category ?? "Other";
                        }))];
                        const isLoading  = loadingId === tpl.id;
                        const isDeleting = deletingId === tpl.id;
                        return (
                            <div key={tpl.id} className="bg-zinc-800 border border-zinc-700 hover:border-zinc-600 rounded-lg p-3.5 transition-colors">
                                <div className="flex items-start justify-between gap-3 mb-2.5">
                                    <div>
                                        <div className="text-zinc-100 font-bold text-sm">{tpl.name}</div>
                                        <div className="text-zinc-600 text-xs mt-0.5">
                                            {(tpl.exercises || []).length} exercise{(tpl.exercises||[]).length !== 1 ? "s" : ""}
                                            <span className="mx-1.5 text-zinc-700">·</span>
                                            {new Date(tpl.created_at).toLocaleDateString(undefined, { month:"short", day:"numeric" })}
                                        </div>
                                    </div>
                                    <div className="flex gap-1 mt-0.5 shrink-0">
                                        {cats.map(cat => (
                                            <span key={cat} className="w-2 h-2 rounded-full"
                                                  style={{ backgroundColor: CATEGORY_COLORS[cat]?.dot ?? "#71717a" }} title={cat} />
                                        ))}
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-1 mb-3">
                                    {(tpl.exercises || []).map(ex => {
                                        const meta  = EXERCISE_LIBRARY.find(e => e.name === ex.name);
                                        const color = CATEGORY_COLORS[meta?.category] ?? { dot:"#71717a" };
                                        return (
                                            <span key={ex.name} className="flex items-center gap-1 text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-zinc-400">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color.dot }} />
                                                {ex.name}
                      </span>
                                        );
                                    })}
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => onLoad(tpl)} disabled={isLoading || isDeleting}
                                            className="flex-1 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-900 text-xs font-bold rounded transition-colors tracking-widest flex items-center justify-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed">
                                        {isLoading ? <><Spinner size={12} className="text-zinc-900" /> LOADING…</> : "LOAD SESSION"}
                                    </button>
                                    <button onClick={() => onDelete(tpl.id)} disabled={isLoading || isDeleting}
                                            className="px-3 py-2 bg-zinc-900 hover:bg-red-950 text-zinc-600 hover:text-red-400 text-xs rounded border border-zinc-700 hover:border-red-800 transition-colors disabled:opacity-40">
                                        {isDeleting ? <Spinner size={12} /> : "DEL"}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="px-5 py-3 border-t border-zinc-800 bg-zinc-950 shrink-0">
                    <p className="text-zinc-700 text-xs text-center">Loading a template resets the current session</p>
                </div>
            </div>
        </div>
    );
}

// ── ReadinessModule ────────────────────────────────────────────
function ReadinessModule({ readiness, onChange }) {
    const [open, setOpen] = useState(true);
    const { bodyweight, bwUnit, sleep, hitMacros } = readiness;

    const score = useMemo(() => {
        let s = 0;
        if (sleep >= 8) s += 40; else if (sleep >= 7) s += 30; else if (sleep >= 6) s += 18; else if (sleep > 0) s += 6;
        if (hitMacros) s += 35;
        if (bodyweight > 0) s += 25;
        return Math.min(s, 100);
    }, [sleep, hitMacros, bodyweight]);

    const scoreColor = score >= 75 ? "#22c55e" : score >= 45 ? "#f59e0b" : "#ef4444";
    const scoreLabel = score >= 75 ? "READY"   : score >= 45 ? "OK"       : "LOW";

    return (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden" style={{ fontFamily:"'IBM Plex Mono',monospace" }}>
            <button onClick={() => setOpen(o => !o)}
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-zinc-800/60 transition-colors">
                <div className="flex items-center gap-2.5">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5">
                        <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                    </svg>
                    <span className="text-zinc-400 text-xs tracking-widest uppercase">Pre-Workout Readiness</span>
                </div>
                <div className="flex items-center gap-2.5">
          <span className="text-xs font-bold px-2 py-0.5 rounded border"
                style={{ color: scoreColor, borderColor: scoreColor+"40", backgroundColor: scoreColor+"12" }}>
            {scoreLabel}
          </span>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                         className={`text-zinc-600 transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </div>
            </button>

            {open && (
                <div className="border-t border-zinc-800 px-4 py-3 grid grid-cols-3 gap-3">
                    <div className="flex flex-col gap-1">
                        <label className="text-zinc-600 text-xs tracking-widest">BODYWEIGHT</label>
                        <div className="flex gap-1">
                            <input type="number" min="30" max="300" step="0.5" value={bodyweight || ""} placeholder="—"
                                   onChange={e => onChange({ ...readiness, bodyweight: e.target.value === "" ? "" : +e.target.value })}
                                   className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 focus:border-amber-500 rounded px-2 py-1.5 text-amber-300 text-sm outline-none transition-colors" />
                            <button onClick={() => onChange({ ...readiness, bwUnit: bwUnit === "kg" ? "lbs" : "kg" })}
                                    className="shrink-0 px-2 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-zinc-400 hover:text-zinc-200 text-xs font-bold transition-colors">
                                {bwUnit}
                            </button>
                        </div>
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="text-zinc-600 text-xs tracking-widest">SLEEP (HRS)</label>
                        <div className="relative">
                            <input type="number" min="0" max="24" step="0.5" value={sleep || ""} placeholder="—"
                                   onChange={e => onChange({ ...readiness, sleep: e.target.value === "" ? "" : +e.target.value })}
                                   className={`w-full bg-zinc-800 border rounded px-2 py-1.5 text-sm outline-none transition-colors
                  ${sleep >= 7 ? "border-green-800 text-green-400" : sleep > 0 && sleep < 6 ? "border-red-800 text-red-400" : "border-zinc-700 focus:border-amber-500 text-amber-300"}`} />
                            {sleep > 0 && (
                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs"
                                      style={{ color: sleep >= 8 ? "#22c55e" : sleep >= 7 ? "#86efac" : sleep >= 6 ? "#f59e0b" : "#ef4444" }}>
                  {sleep >= 8 ? "●●●" : sleep >= 7 ? "●●○" : sleep >= 6 ? "●○○" : "○○○"}
                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="text-zinc-600 text-xs tracking-widest">HIT MACROS?</label>
                        <div className="flex gap-1 h-[34px]">
                            <button onClick={() => onChange({ ...readiness, hitMacros: true })}
                                    className={`flex-1 text-xs font-bold rounded border transition-colors ${hitMacros === true ? "bg-green-900/60 border-green-700 text-green-400" : "bg-zinc-800 border-zinc-700 text-zinc-600 hover:text-zinc-400"}`}>
                                YES
                            </button>
                            <button onClick={() => onChange({ ...readiness, hitMacros: false })}
                                    className={`flex-1 text-xs font-bold rounded border transition-colors ${hitMacros === false ? "bg-red-900/40 border-red-800 text-red-400" : "bg-zinc-800 border-zinc-700 text-zinc-600 hover:text-zinc-400"}`}>
                                NO
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── RestTimer (duration in component state only — not persisted) ─
function RestTimer({ onComplete }) {
    const [restDuration, setRestDuration] = useState(DEFAULT_REST);
    const [timeLeft, setTimeLeft]         = useState(null);
    const [running, setRunning]           = useState(false);
    const [editMode, setEditMode]         = useState(false);
    const [draftSecs, setDraftSecs]       = useState(DEFAULT_REST);
    const intervalRef = useRef(null);

    useEffect(() => {
        if (running && timeLeft > 0) {
            intervalRef.current = setInterval(() => setTimeLeft(t => t-1), 1000);
        } else if (running && timeLeft === 0) {
            setRunning(false); onComplete?.();
        }
        return () => clearInterval(intervalRef.current);
    }, [running, timeLeft]);

    const start    = () => { setTimeLeft(restDuration); setRunning(true); };
    const stop     = () => { setRunning(false); setTimeLeft(null); };
    const savePref = () => { const v = Math.max(10, Math.min(600, draftSecs)); setRestDuration(v); setEditMode(false); };

    const pct           = timeLeft != null ? (timeLeft / restDuration) * 100 : 100;
    const circumference = 2 * Math.PI * 36;

    return (
        <div style={{ fontFamily:"'IBM Plex Mono',monospace" }}
             className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 flex flex-col items-center gap-3">
            <div className="text-zinc-400 text-xs tracking-widest uppercase">Rest Timer</div>
            <div className="relative w-24 h-24">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
                    <circle cx="40" cy="40" r="36" fill="none" stroke="#27272a" strokeWidth="5" />
                    <circle cx="40" cy="40" r="36" fill="none"
                            stroke={timeLeft === 0 ? "#22c55e" : timeLeft != null && timeLeft <= 10 ? "#ef4444" : "#f59e0b"}
                            strokeWidth="5" strokeDasharray={circumference}
                            strokeDashoffset={circumference * (1 - pct / 100)} strokeLinecap="round"
                            style={{ transition:"stroke-dashoffset 0.9s linear, stroke 0.3s" }} />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xl font-bold text-amber-400">
            {timeLeft != null ? fmtTime(timeLeft) : fmtTime(restDuration)}
          </span>
                </div>
            </div>
            <div className="flex gap-2">
                {!running
                    ? <button onClick={start} className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-900 text-xs font-bold rounded transition-colors">START</button>
                    : <button onClick={stop}  className="px-4 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-xs font-bold rounded transition-colors">STOP</button>
                }
                <button onClick={() => { setEditMode(e => !e); setDraftSecs(restDuration); }}
                        className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs rounded border border-zinc-700 transition-colors">SET</button>
            </div>
            {editMode && (
                <div className="flex items-center gap-2 w-full">
                    <input type="range" min="10" max="600" step="5" value={draftSecs}
                           onChange={e => setDraftSecs(+e.target.value)} className="flex-1 accent-amber-500" />
                    <span className="text-amber-400 text-xs w-12 text-right">{fmtTime(draftSecs)}</span>
                    <button onClick={savePref} className="text-xs px-2 py-1 bg-amber-500 text-zinc-900 font-bold rounded">OK</button>
                </div>
            )}
        </div>
    );
}

// ── SetRow ─────────────────────────────────────────────────────
function SetRow({ set, index, onChange, onDelete, historicalPR }) {
    const est        = set.reps && set.weight ? e1rm(set.weight, set.reps) : null;
    const prWeight   = historicalPR?.maxWeight ?? 0;
    const prE1rm     = historicalPR?.maxE1rm   ?? 0;
    const isWeightPR = set.weight > 0 && prWeight > 0 && set.weight > prWeight;
    const isE1rmPR   = est !== null && prE1rm > 0 && est > prE1rm;
    const isAnyPR    = isWeightPR || isE1rmPR;

    return (
        <div className={`grid gap-2 items-center py-2 border-b border-zinc-800 last:border-0 rounded transition-colors ${isAnyPR ? "bg-amber-500/5" : ""}`}
             style={{ gridTemplateColumns:"24px 1fr 1fr 1fr 90px 28px", fontFamily:"'IBM Plex Mono',monospace" }}>
            <span className="text-zinc-600 text-xs text-center">{index + 1}</span>
            <div className="flex flex-col">
                <label className="text-zinc-600 text-xs mb-0.5">SETS</label>
                <input type="number" min="1" max="20" value={set.sets} onChange={e => onChange({ ...set, sets: +e.target.value })}
                       className="bg-zinc-800 border border-zinc-700 focus:border-amber-500 rounded px-2 py-1 text-amber-300 text-sm w-full outline-none transition-colors" />
            </div>
            <div className="flex flex-col">
                <label className="text-zinc-600 text-xs mb-0.5">REPS</label>
                <input type="number" min="1" max="50" value={set.reps} onChange={e => onChange({ ...set, reps: +e.target.value })}
                       className="bg-zinc-800 border border-zinc-700 focus:border-amber-500 rounded px-2 py-1 text-amber-300 text-sm w-full outline-none transition-colors" />
            </div>
            <div className="flex flex-col">
                <label className="text-zinc-600 text-xs mb-0.5">KG</label>
                <input type="number" min="0" step="2.5" value={set.weight} onChange={e => onChange({ ...set, weight: +e.target.value })}
                       className={`bg-zinc-800 border rounded px-2 py-1 text-sm w-full outline-none transition-colors ${isWeightPR ? "border-amber-400 text-amber-300" : "border-zinc-700 focus:border-amber-500 text-amber-300"}`} />
            </div>
            <div className="flex flex-col">
                <label className="text-zinc-600 text-xs mb-0.5">RPE</label>
                <select value={set.rpe} onChange={e => onChange({ ...set, rpe: +e.target.value })}
                        className="bg-zinc-800 border border-zinc-700 focus:border-amber-500 rounded px-2 py-1 text-amber-300 text-sm w-full outline-none transition-colors appearance-none">
                    {Object.keys(RPE_LABELS).map(r => <option key={r} value={r}>{r}</option>)}
                </select>
            </div>
            <div className="flex flex-col items-end gap-0.5">
                {est && (
                    <>
                        <span className="text-zinc-600 text-xs">e1RM</span>
                        <span className={`text-xs font-bold ${isE1rmPR ? "text-amber-400" : "text-green-400"}`}>{est}</span>
                        {isAnyPR && <span className="text-xs leading-none mt-0.5 animate-pulse">🏆 PR</span>}
                    </>
                )}
            </div>
            <button onClick={onDelete} className="text-zinc-700 hover:text-red-400 transition-colors text-lg leading-none self-end pb-1">×</button>
        </div>
    );
}

// ── ExerciseBlock ──────────────────────────────────────────────
function ExerciseBlock({ block, onChange, onDelete, historicalPRs }) {
    const addSet    = () => { const last = block.sets[block.sets.length-1]; onChange({ ...block, sets: [...block.sets, { ...last, id: Date.now() }] }); };
    const updateSet = (i, s) => { const sets = [...block.sets]; sets[i] = s; onChange({ ...block, sets }); };
    const deleteSet = (i) => { const sets = block.sets.filter((_,idx) => idx !== i); if (sets.length === 0) { onDelete(); return; } onChange({ ...block, sets }); };

    const vol            = totalVol(block.sets);
    const pr             = historicalPRs?.[block.exercise] ?? null;
    const liveBestWeight = Math.max(0, ...block.sets.map(s => Number(s.weight) || 0));
    const liveBestE1rm   = Math.max(0, ...block.sets.map(s => s.weight && s.reps ? e1rm(s.weight, s.reps) : 0));
    const blockHasPR     = pr && (liveBestWeight > pr.maxWeight || liveBestE1rm > pr.maxE1rm);

    return (
        <div className={`bg-zinc-900 border rounded-lg overflow-hidden transition-colors ${blockHasPR ? "border-amber-500/50" : "border-zinc-700"}`}
             style={{ fontFamily:"'IBM Plex Mono',monospace" }}>
            <div className={`flex items-center justify-between px-4 py-3 border-b transition-colors ${blockHasPR ? "bg-amber-500/10 border-amber-500/30" : "bg-zinc-800 border-zinc-700"}`}>
                <div className="flex items-center gap-2 min-w-0">
                    {CATEGORY_COLORS[block.category] && (
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: CATEGORY_COLORS[block.category].dot }} />
                    )}
                    <span className="text-amber-400 font-bold text-sm truncate">{block.exercise}</span>
                    {blockHasPR && (
                        <span className="shrink-0 text-xs font-bold text-amber-400 bg-amber-500/20 border border-amber-500/40 rounded px-1.5 py-0.5 leading-none">
              🏆 NEW PR
            </span>
                    )}
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-2">
                    <div className="flex flex-col items-end">
                        <span className="text-zinc-500 text-xs">VOL <span className="text-zinc-300">{vol.toLocaleString()} kg</span></span>
                        {pr
                            ? <span className="text-zinc-600 text-xs">PR: <span className="text-zinc-500">{pr.maxWeight}kg</span><span className="text-zinc-700 mx-1">·</span><span className="text-zinc-500">{pr.maxE1rm}e1</span></span>
                            : <span className="text-zinc-700 text-xs italic">no history</span>
                        }
                    </div>
                    <button onClick={onDelete} className="text-zinc-600 hover:text-red-400 text-xs transition-colors">REMOVE</button>
                </div>
            </div>
            <div className="px-4">
                {block.sets.map((s,i) => (
                    <SetRow key={s.id} set={s} index={i} onChange={s => updateSet(i,s)} onDelete={() => deleteSet(i)} historicalPR={pr} />
                ))}
            </div>
            <div className="px-4 py-3">
                <button onClick={addSet}
                        className="text-xs text-zinc-500 hover:text-amber-400 border border-dashed border-zinc-700 hover:border-amber-500 rounded px-3 py-1.5 transition-colors w-full">
                    + ADD SET
                </button>
            </div>
        </div>
    );
}

// ── ProgressChart (Supabase-powered) ──────────────────────────
function ProgressChart() {
    const containerRef = useRef(null);
    const [width, setWidth]           = useState(600);
    const [chartEx, setChartEx]       = useState("");
    const [dropdownOpen, setDropdown] = useState(false);
    const [tooltip, setTooltip]       = useState(null);
    const [exerciseList, setExerciseList] = useState([]);
    const [chartData, setChartData]       = useState([]);
    const [loadingList, setLoadingList]   = useState(true);
    const [loadingChart, setLoadingChart] = useState(false);

    // Responsive width
    useEffect(() => {
        if (!containerRef.current) return;
        const ro = new ResizeObserver(entries => setWidth(entries[0].contentRect.width || 600));
        ro.observe(containerRef.current);
        return () => ro.disconnect();
    }, []);

    // Fetch exercise list from Supabase
    useEffect(() => {
        setLoadingList(true);
        fetchLoggedExercises().then(({ data, error }) => {
            if (!error && data) {
                // de-duplicate (e1rm_history may return one row per date per exercise)
                const seen = new Set();
                const unique = data.filter(r => { if (seen.has(r.exercise_name)) return false; seen.add(r.exercise_name); return true; });
                setExerciseList(unique);
                if (unique.length > 0 && !chartEx) setChartEx(unique[0].exercise_name);
            }
            setLoadingList(false);
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Fetch e1RM history whenever selected exercise changes
    useEffect(() => {
        if (!chartEx) return;
        setLoadingChart(true);
        setTooltip(null);
        fetchE1rmHistory(chartEx).then(({ data, error }) => {
            if (!error && data) {
                setChartData(data.map(r => ({
                    date:  new Date(r.session_date),
                    value: Number(r.best_e1rm_kg),
                    label: r.session_name,
                })));
            }
            setLoadingChart(false);
        });
    }, [chartEx]);

    // Chart geometry
    const H          = 200;
    const PAD        = { top:16, right:20, bottom:40, left:48 };
    const innerW     = Math.max(width - PAD.left - PAD.right, 20);
    const innerH     = H - PAD.top - PAD.bottom;
    const minVal     = chartData.length > 0 ? Math.min(...chartData.map(d => d.value)) : 0;
    const maxVal     = chartData.length > 0 ? Math.max(...chartData.map(d => d.value)) : 100;
    const valRange   = maxVal - minVal || 1;
    const padVal     = valRange * 0.15;
    const yMin       = Math.max(0, minVal - padVal);
    const yMax       = maxVal + padVal;
    const toX        = (i) => chartData.length < 2 ? PAD.left + innerW/2 : PAD.left + (i/(chartData.length-1)) * innerW;
    const toY        = (v) => PAD.top + innerH - ((v-yMin)/(yMax-yMin)) * innerH;
    const yTicks     = Array.from({length:5}, (_,i) => yMin + (yMax-yMin)*(i/4));
    const xTickIdxs  = chartData.length <= 6 ? chartData.map((_,i) => i) : Array.from({length:6}, (_,i) => Math.round(i*(chartData.length-1)/5));
    const fmtDate    = (d) => d.toLocaleDateString(undefined, { month:"short", day:"numeric" });
    const linePoints = chartData.map((d,i) => `${toX(i)},${toY(d.value)}`).join(" ");
    const areaPath   = chartData.length > 1
        ? `M${toX(0)},${PAD.top+innerH} ${chartData.map((d,i) => `L${toX(i)},${toY(d.value)}`).join(" ")} L${toX(chartData.length-1)},${PAD.top+innerH} Z`
        : "";

    const handleMouseMove = (e) => {
        if (!chartData.length) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left - PAD.left) / innerW));
        const idx  = Math.round(pct * (chartData.length-1));
        const d    = chartData[idx];
        if (d) setTooltip({ x: toX(idx), y: toY(d.value), date: fmtDate(d.date), value: d.value, label: d.label });
    };

    const meta  = EXERCISE_LIBRARY.find(e => e.name === chartEx);
    const color = CATEGORY_COLORS[meta?.category] ?? { dot:"#f59e0b", text:"text-amber-400" };

    return (
        <div ref={containerRef} className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden" style={{ fontFamily:"'IBM Plex Mono',monospace" }}>

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
                <div>
                    <div className="text-zinc-400 text-xs tracking-widest uppercase">e1RM Progress</div>
                    {chartData.length > 0 && (
                        <div className="text-zinc-600 text-xs mt-0.5">
                            {chartData.length} session{chartData.length !== 1 ? "s" : ""}
                            <span className="mx-1.5 text-zinc-700">·</span>
                            Peak <span className="text-amber-400 font-bold">{maxVal}kg</span>
                        </div>
                    )}
                </div>

                {/* Exercise dropdown */}
                <div className="relative">
                    <button onClick={() => setDropdown(o => !o)}
                            className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 rounded-lg px-3 py-1.5 text-xs transition-colors max-w-[180px]">
                        {loadingList
                            ? <><Spinner size={11} /><span className="text-zinc-500">Loading…</span></>
                            : chartEx
                                ? <><span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color.dot }} /><span className="text-zinc-200 truncate">{chartEx}</span></>
                                : <span className="text-zinc-500">Select exercise</span>
                        }
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                             className={`shrink-0 text-zinc-500 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}>
                            <polyline points="6 9 12 15 18 9"/>
                        </svg>
                    </button>

                    {dropdownOpen && (
                        <div className="absolute right-0 top-full mt-1 w-56 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl z-30 overflow-hidden" style={{ maxHeight:"240px", overflowY:"auto" }}>
                            {exerciseList.length === 0 && (
                                <div className="px-3 py-4 text-zinc-600 text-xs text-center">No sessions logged yet</div>
                            )}
                            {exerciseList.map(ex => {
                                const m  = EXERCISE_LIBRARY.find(e => e.name === ex.exercise_name);
                                const c  = CATEGORY_COLORS[m?.category] ?? { dot:"#71717a" };
                                return (
                                    <button key={ex.exercise_name}
                                            onClick={() => { setChartEx(ex.exercise_name); setDropdown(false); }}
                                            className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors ${chartEx === ex.exercise_name ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"}`}>
                                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c.dot }} />
                                        {ex.exercise_name}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* SVG chart area */}
            <div className="relative" onMouseLeave={() => setTooltip(null)}>
                <svg width={width} height={H} onMouseMove={handleMouseMove} style={{ display:"block", cursor:"crosshair" }}>
                    <defs>
                        <linearGradient id="chartAreaGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%"   stopColor="#f59e0b" stopOpacity="0.18" />
                            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.01" />
                        </linearGradient>
                        <filter id="ptGlow" x="-50%" y="-50%" width="200%" height="200%">
                            <feGaussianBlur stdDeviation="3" result="blur"/>
                            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                        </filter>
                    </defs>

                    {yTicks.map((v,i) => (
                        <g key={i}>
                            <line x1={PAD.left} y1={toY(v)} x2={PAD.left+innerW} y2={toY(v)} stroke="#27272a" strokeWidth="1" strokeDasharray="4 4" />
                            <text x={PAD.left-6} y={toY(v)+4} textAnchor="end" fill="#52525b" fontSize="9" fontFamily="'IBM Plex Mono',monospace">{Math.round(v)}</text>
                        </g>
                    ))}
                    <line x1={PAD.left} y1={PAD.top+innerH} x2={PAD.left+innerW} y2={PAD.top+innerH} stroke="#3f3f46" strokeWidth="1" />
                    {xTickIdxs.map(idx => {
                        const d = chartData[idx];
                        if (!d) return null;
                        return <text key={idx} x={toX(idx)} y={H-8} textAnchor="middle" fill="#52525b" fontSize="9" fontFamily="'IBM Plex Mono',monospace">{fmtDate(d.date)}</text>;
                    })}

                    {/* Loading overlay */}
                    {loadingChart && (
                        <text x={PAD.left+innerW/2} y={PAD.top+innerH/2} textAnchor="middle" fill="#52525b" fontSize="11" fontFamily="'IBM Plex Mono',monospace">Loading…</text>
                    )}

                    {/* No data state */}
                    {!loadingChart && chartData.length === 0 && (
                        <text x={PAD.left+innerW/2} y={PAD.top+innerH/2} textAnchor="middle" fill="#3f3f46" fontSize="12" fontFamily="'IBM Plex Mono',monospace">No data for {chartEx || "this exercise"}</text>
                    )}

                    {chartData.length > 1 && !loadingChart && (
                        <>
                            <path d={areaPath} fill="url(#chartAreaGrad)" />
                            <polyline points={linePoints} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                        </>
                    )}

                    {tooltip && <line x1={tooltip.x} y1={PAD.top} x2={tooltip.x} y2={PAD.top+innerH} stroke="#f59e0b" strokeWidth="1" strokeOpacity="0.3" strokeDasharray="3 3" />}

                    {!loadingChart && chartData.map((d,i) => {
                        const cx = toX(i); const cy = toY(d.value);
                        const isHovered = tooltip && Math.abs(tooltip.x - cx) < 2;
                        return (
                            <g key={i} filter={isHovered ? "url(#ptGlow)" : undefined}>
                                <circle cx={cx} cy={cy} r={isHovered ? 7 : 4} fill={isHovered ? "#f59e0b" : "#18181b"} stroke="#f59e0b" strokeWidth={isHovered ? 2.5 : 2} style={{ transition:"r 0.1s, fill 0.1s" }} />
                            </g>
                        );
                    })}
                </svg>

                {tooltip && (
                    <div className="absolute pointer-events-none bg-zinc-950 border border-amber-500/40 rounded-lg px-3 py-2 shadow-xl"
                         style={{ left: Math.min(tooltip.x+12, width-140), top: Math.max(tooltip.y-48, PAD.top), fontFamily:"'IBM Plex Mono',monospace" }}>
                        <div className="text-zinc-500 text-xs">{tooltip.date}</div>
                        <div className="text-amber-400 font-bold text-base leading-tight">{tooltip.value} <span className="text-zinc-500 text-xs font-normal">kg e1RM</span></div>
                        <div className="text-zinc-600 text-xs truncate max-w-[120px]">{tooltip.label}</div>
                    </div>
                )}
            </div>

            {dropdownOpen && <div className="fixed inset-0 z-20" onClick={() => setDropdown(false)} />}
        </div>
    );
}

// ── Main StrengthTracker ───────────────────────────────────────
export default function StrengthTracker({ user, onSignOut }) {
    // ── Active session state ──────────────────────────────────
    const [blocks, setBlocks]                     = useState([]);
    const [showPicker, setShowPicker]             = useState(false);
    const [showSaveTemplate, setShowSaveTemplate] = useState(false);
    const [showLoadTemplate, setShowLoadTemplate] = useState(false);
    const [readiness, setReadiness]               = useState({ bodyweight:"", bwUnit:"kg", sleep:"", hitMacros:null });
    const [sessionName, setSessionName]           = useState(() => `${dayName()} Session`);
    const [timerDone, setTimerDone]               = useState(false);
    const [view, setView]                         = useState("log");
    const [toast, setToast]                       = useState(null);

    // ── Supabase data ─────────────────────────────────────────
    const [savedSessions, setSavedSessions] = useState([]);
    const [templates, setTemplates]         = useState([]);
    const [historicalPRs, setHistoricalPRs] = useState({});

    // ── Loading states ────────────────────────────────────────
    const [initLoading, setInitLoading]       = useState(true);   // first load
    const [savingSession, setSavingSession]   = useState(false);
    const [savingTemplate, setSavingTemplate] = useState(false);
    const [templateLoadingId, setTemplateLoadingId] = useState(null);
    const [templateDeletingId, setTemplateDeletingId] = useState(null);

    // ── Initial data fetch on mount ───────────────────────────
    useEffect(() => {
        async function bootstrap() {
            setInitLoading(true);
            try {
                const [historyResult, templatesResult, prsResult] = await Promise.all([
                    fetchSessionHistory(30, 0),
                    dbFetchTemplates(),
                    fetchUserPRs(),
                ]);
                if (historyResult.data)   setSavedSessions(historyResult.data);
                if (templatesResult.data) setTemplates(templatesResult.data);
                if (!prsResult.error)     setHistoricalPRs(prsResult.prs);
            } catch (err) {
                console.error("Bootstrap fetch failed:", err);
            } finally {
                setInitLoading(false);
            }
        }
        bootstrap();
    }, []);

    // ── Helpers ───────────────────────────────────────────────
    const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

    const refreshPRs = async () => {
        const { prs, error } = await fetchUserPRs();
        if (!error) setHistoricalPRs(prs);
    };

    // ── Exercise management ───────────────────────────────────
    const addExercise = useCallback((name) => {
        const meta = EXERCISE_LIBRARY.find(e => e.name === name);
        setBlocks(b => [...b, {
            id: Date.now(), exercise: name, category: meta?.category ?? "Other",
            sets: [{ id: Date.now(), sets: 3, reps: 5, weight: 60, rpe: 8 }],
        }]);
        setShowPicker(false);
    }, []);

    const updateBlock = (id, block) => setBlocks(b => b.map(x => x.id === id ? block : x));
    const deleteBlock = (id)         => setBlocks(b => b.filter(x => x.id !== id));

    const totalVolume = blocks.reduce((a, b) => a + totalVol(b.sets), 0);
    const totalSets   = blocks.reduce((a, b) => a + b.sets.reduce((s, r) => s + r.sets, 0), 0);

    // ── Save session to Supabase ──────────────────────────────
    const handleSaveSession = async () => {
        if (blocks.length === 0) { showToast("Add at least one exercise first."); return; }
        setSavingSession(true);
        try {
            const { session, error } = await dbSaveSession({
                name: sessionName, blocks, totalVolume, totalSets, readiness,
            });
            if (error) throw error;

            // Optimistically prepend to history and refresh PRs
            const { data: fresh } = await fetchSessionHistory(30, 0);
            if (fresh) setSavedSessions(fresh);
            await refreshPRs();
            showToast("Session saved ✓");
        } catch (err) {
            console.error(err);
            showToast(`Save failed: ${err.message}`);
        } finally {
            setSavingSession(false);
        }
    };

    const clearSession = () => { if (confirm("Clear this session?")) { setBlocks([]); setReadiness({ bodyweight:"", bwUnit:"kg", sleep:"", hitMacros:null }); setSessionName(`${dayName()} Session`); } };

    // ── Templates ─────────────────────────────────────────────
    const handleSaveTemplate = async (templateName) => {
        setSavingTemplate(true);
        try {
            const exercises = blocks.map(b => ({ name: b.exercise, category: b.category, defaultSets: b.sets.length }));
            const { data, error } = await dbSaveTemplate(templateName, exercises);
            if (error) throw error;
            // Re-fetch for consistency
            const { data: fresh } = await dbFetchTemplates();
            if (fresh) setTemplates(fresh);
            setShowSaveTemplate(false);
            showToast(`Template "${templateName}" saved ✓`);
        } catch (err) {
            console.error(err);
            showToast(`Template save failed: ${err.message}`);
        } finally {
            setSavingTemplate(false);
        }
    };

    const handleLoadTemplate = async (tpl) => {
        if (blocks.length > 0 && !confirm("Loading a template will clear the current session. Continue?")) return;
        setTemplateLoadingId(tpl.id);
        const newBlocks = (tpl.exercises || []).map((ex, i) => ({
            id: Date.now() + i, exercise: ex.name, category: ex.category,
            sets: Array.from({ length: ex.defaultSets || 3 }, (_, j) => ({
                id: Date.now() + i*100 + j, sets: 1, reps: 5, weight: 0, rpe: 8,
            })),
        }));
        setBlocks(newBlocks);
        setSessionName(`${tpl.name} — ${dayName()}`);
        setShowLoadTemplate(false);
        setTemplateLoadingId(null);
        showToast(`"${tpl.name}" loaded ✓`);
    };

    const handleDeleteTemplate = async (id) => {
        setTemplateDeletingId(id);
        try {
            const { error } = await dbDeleteTemplate(id);
            if (error) throw error;
            setTemplates(t => t.filter(x => x.id !== id));
        } catch (err) {
            showToast(`Delete failed: ${err.message}`);
        } finally {
            setTemplateDeletingId(null);
        }
    };

    const rpeColor = (rpe) => {
        if (rpe <= 7) return "text-green-400";
        if (rpe <= 8) return "text-amber-400";
        if (rpe <= 9) return "text-orange-400";
        return "text-red-400";
    };

    // ── Initial loading splash ────────────────────────────────
    if (initLoading) return <PageLoader label="FETCHING YOUR DATA…" />;

    // ── Render ────────────────────────────────────────────────
    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100" style={{ fontFamily:"'IBM Plex Mono',monospace" }}>

            {/* ── App Header ── */}
            <header className="border-b border-zinc-800 px-4 py-4 sticky top-0 z-20 bg-zinc-950/95 backdrop-blur">
                <div className="max-w-2xl mx-auto flex items-center justify-between">
                    <div>
                        <div className="text-amber-500 font-bold text-lg tracking-tight leading-none">
                            STR<span className="text-zinc-400">/</span>VOL
                        </div>
                        <div className="text-zinc-600 text-xs mt-0.5">STRENGTH &amp; VOLUME TRACKER</div>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* View tabs */}
                        <div className="flex gap-1">
                            {["log","history"].map(v => (
                                <button key={v} onClick={() => setView(v)}
                                        className={`px-3 py-1.5 text-xs rounded transition-colors uppercase tracking-widest ${view === v ? "bg-amber-500 text-zinc-900 font-bold" : "text-zinc-500 hover:text-zinc-300"}`}>
                                    {v}
                                </button>
                            ))}
                        </div>

                        {/* User avatar + sign-out */}
                        {user && (
                            <div className="flex items-center gap-2 pl-2 border-l border-zinc-800">
                                <div className="w-7 h-7 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0"
                                     title={user.user_metadata?.display_name || user.email}>
                  <span className="text-amber-400 text-xs font-bold leading-none select-none">
                    {(user.user_metadata?.display_name || user.email || "?").charAt(0).toUpperCase()}
                  </span>
                                </div>
                                {onSignOut && (
                                    <button onClick={onSignOut} aria-label="Sign out" title="Sign out"
                                            className="text-zinc-600 hover:text-red-400 transition-colors">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                                            <polyline points="16 17 21 12 16 7"/>
                                            <line x1="21" y1="12" x2="9" y2="12"/>
                                        </svg>
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </header>

            <main className="max-w-2xl mx-auto px-4 py-6 space-y-5">

                {/* Toast */}
                {toast && (
                    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-amber-500 text-zinc-900 px-4 py-2 rounded text-sm font-bold shadow-xl animate-pulse">
                        {toast}
                    </div>
                )}

                {/* ══════════════════ LOG VIEW ══════════════════════ */}
                {view === "log" && (
                    <>
                        {/* Session name + date */}
                        <div className="flex items-center gap-3">
                            <input value={sessionName} onChange={e => setSessionName(e.target.value)}
                                   className="bg-transparent border-b border-zinc-700 focus:border-amber-500 outline-none text-zinc-200 font-bold text-base flex-1 pb-1 transition-colors" />
                            <span className="text-zinc-600 text-xs">{new Date().toLocaleDateString()}</span>
                        </div>

                        {/* Readiness module */}
                        <ReadinessModule readiness={readiness} onChange={setReadiness} />

                        {/* Stats bar */}
                        <div className="grid grid-cols-3 gap-3">
                            {[
                                { label:"EXERCISES",  value: blocks.length },
                                { label:"TOTAL SETS", value: totalSets },
                                { label:"VOLUME",     value: totalVolume > 0 ? `${(totalVolume/1000).toFixed(1)}t` : "0" },
                            ].map(({ label, value }) => (
                                <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-3 text-center">
                                    <div className="text-zinc-600 text-xs mb-1">{label}</div>
                                    <div className="text-amber-400 font-bold text-xl">{value}</div>
                                </div>
                            ))}
                        </div>

                        {/* Rest timer */}
                        <RestTimer onComplete={() => { setTimerDone(true); setTimeout(() => setTimerDone(false), 3000); }} />
                        {timerDone && (
                            <div className="text-center text-green-400 text-sm font-bold animate-bounce">✓ REST COMPLETE — NEXT SET</div>
                        )}

                        {/* Empty state */}
                        {blocks.length === 0 && (
                            <div className="text-center py-12 text-zinc-700 text-sm border border-dashed border-zinc-800 rounded-lg">
                                No exercises yet.<br />
                                <span className="text-zinc-600">Add an exercise or load a template below.</span>
                            </div>
                        )}

                        {/* Exercise blocks */}
                        {blocks.map(b => (
                            <ExerciseBlock key={b.id} block={b}
                                           onChange={b => updateBlock(b.id, b)}
                                           onDelete={() => deleteBlock(b.id)}
                                           historicalPRs={historicalPRs} />
                        ))}

                        {/* Action grid */}
                        <div className="grid grid-cols-2 gap-3 pt-2">
                            <button onClick={() => setShowPicker(true)}
                                    className="py-3 border border-zinc-600 text-zinc-300 hover:border-amber-500 hover:text-amber-400 font-bold text-xs rounded-lg transition-colors tracking-widest">
                                + EXERCISE
                            </button>

                            <button onClick={() => setShowLoadTemplate(true)}
                                    className="py-3 border border-zinc-600 text-zinc-300 hover:border-amber-500 hover:text-amber-400 font-bold text-xs rounded-lg transition-colors tracking-widest flex items-center justify-center gap-2">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
                                    <path d="M12 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                    <polyline points="14 2 14 8 20 8"/>
                                    <line x1="16" y1="13" x2="8" y2="13"/>
                                    <line x1="16" y1="17" x2="8" y2="17"/>
                                </svg>
                                LOAD TEMPLATE
                                {templates.length > 0 && (
                                    <span className="bg-amber-500 text-zinc-900 text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
                    {templates.length}
                  </span>
                                )}
                            </button>

                            <button onClick={() => { if (blocks.length === 0) { showToast("Add exercises first."); return; } setShowSaveTemplate(true); }}
                                    className="py-3 border border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300 font-bold text-xs rounded-lg transition-colors tracking-widest flex items-center justify-center gap-2">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
                                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                                    <polyline points="17 21 17 13 7 13 7 21"/>
                                    <polyline points="7 3 7 8 15 8"/>
                                </svg>
                                SAVE TEMPLATE
                            </button>

                            <button onClick={handleSaveSession} disabled={savingSession}
                                    className={`py-3 font-bold text-xs rounded-lg transition-colors tracking-widest flex items-center justify-center gap-2
                  ${savingSession ? "bg-amber-600 text-zinc-900 cursor-not-allowed" : "bg-amber-500 hover:bg-amber-400 text-zinc-900"}`}>
                                {savingSession ? <><Spinner size={13} className="text-zinc-900" /> SAVING…</> : "SAVE SESSION"}
                            </button>
                        </div>

                        {blocks.length > 0 && (
                            <button onClick={clearSession} className="w-full py-2 text-zinc-700 hover:text-red-400 text-xs transition-colors">
                                CLEAR SESSION
                            </button>
                        )}
                    </>
                )}

                {/* ══════════════════ HISTORY VIEW ═════════════════ */}
                {view === "history" && (
                    <div className="space-y-3">
                        <div className="text-zinc-500 text-xs tracking-widest uppercase mb-4">Session History</div>

                        {/* Progress chart — reads from Supabase */}
                        <ProgressChart />

                        {savedSessions.length === 0 && (
                            <div className="text-center py-12 text-zinc-700 text-sm border border-dashed border-zinc-800 rounded-lg">
                                No sessions saved yet.
                            </div>
                        )}

                        {savedSessions.map(s => (
                            <div key={s.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                                <div className="flex justify-between items-start mb-3">
                                    <div>
                                        <div className="text-amber-400 font-bold">{s.name}</div>
                                        <div className="text-zinc-600 text-xs mt-0.5">
                                            {new Date(s.session_date).toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" })}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-zinc-300 text-sm font-bold">{(Number(s.total_volume_kg)/1000).toFixed(1)}t</div>
                                        <div className="text-zinc-600 text-xs">{s.total_sets} sets</div>
                                    </div>
                                </div>

                                {/* Readiness strip */}
                                {(s.bodyweight || s.sleep_hours != null || s.hit_macros != null) && (
                                    <div className="flex items-center gap-3 mb-2.5 px-2.5 py-2 bg-zinc-800/60 border border-zinc-800 rounded">
                                        {s.bodyweight && (
                                            <div className="flex items-center gap-1.5">
                                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
                                                <span className="text-zinc-500 text-xs">BW</span>
                                                <span className="text-zinc-300 text-xs font-bold">{s.bodyweight}{s.bodyweight_unit}</span>
                                            </div>
                                        )}
                                        {s.sleep_hours != null && s.sleep_hours !== "" && (
                                            <>
                                                {s.bodyweight && <span className="text-zinc-700">·</span>}
                                                <div className="flex items-center gap-1.5">
                                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth="2.5"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                                                    <span className="text-zinc-500 text-xs">SLEEP</span>
                                                    <span className={`text-xs font-bold ${s.sleep_hours >= 7 ? "text-green-400" : s.sleep_hours >= 6 ? "text-amber-400" : "text-red-400"}`}>{s.sleep_hours}h</span>
                                                </div>
                                            </>
                                        )}
                                        {s.hit_macros != null && (
                                            <>
                                                <span className="text-zinc-700">·</span>
                                                <div className="flex items-center gap-1.5">
                                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth="2.5"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>
                                                    <span className="text-zinc-500 text-xs">MACROS</span>
                                                    <span className={`text-xs font-bold ${s.hit_macros ? "text-green-400" : "text-red-400"}`}>{s.hit_macros ? "✓ YES" : "✗ NO"}</span>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}

                                {/* Per-exercise breakdown from session_summary view */}
                                <div className="space-y-1.5">
                                    {(s.blocks || []).map((b, bi) => {
                                        const maxE1rm = b.max_e1rm  ? Number(b.max_e1rm).toFixed(1) : "—";
                                        return (
                                            <div key={bi} className="flex justify-between items-center text-xs border-t border-zinc-800 pt-1.5">
                                                <span className="text-zinc-400">{b.exercise}</span>
                                                <div className="flex gap-4">
                                                    <span className="text-zinc-600">{b.set_count} sets</span>
                                                    <span className="text-green-400">e1RM {maxE1rm}kg</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>

            {/* Footer */}
            <footer className="text-center text-zinc-800 text-xs py-8 border-t border-zinc-900 mt-10">
                STR/VOL v1.0 · Supabase
            </footer>

            {/* Modals */}
            {showPicker && (
                <ExercisePickerModal onSelect={addExercise} onClose={() => setShowPicker(false)} alreadyAdded={blocks.map(b => b.exercise)} />
            )}
            {showSaveTemplate && (
                <SaveTemplateModal blocks={blocks} onSave={handleSaveTemplate} onClose={() => setShowSaveTemplate(false)} saving={savingTemplate} />
            )}
            {showLoadTemplate && (
                <LoadTemplatePanel templates={templates} onLoad={handleLoadTemplate} onDelete={handleDeleteTemplate} onClose={() => setShowLoadTemplate(false)} loadingId={templateLoadingId} deletingId={templateDeletingId} />
            )}

            <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; }
        input[type=number]::-webkit-inner-spin-button { opacity: 0.3; }
        select option { background: #18181b; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #09090b; }
        ::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 2px; }
        @keyframes pr-flash {
          0%   { box-shadow: 0 0 0 0 rgba(245,158,11,0.5); }
          50%  { box-shadow: 0 0 0 6px rgba(245,158,11,0); }
          100% { box-shadow: 0 0 0 0 rgba(245,158,11,0); }
        }
        .pr-flash { animation: pr-flash 1.2s ease-out infinite; }
      `}</style>
        </div>
    );
}
