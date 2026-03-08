/**
 * AICoach.jsx  —  STR/VOL AI Coach tab
 *
 * What this does:
 *   1. Maintains a local chat history (user + assistant turns).
 *   2. On submit, queries Supabase for the user's last 30 days of
 *      sessions + sets and formats them into a system context block.
 *   3. Sends the full conversation (system context + history + new
 *      message) to the Gemini 1.5 Flash model via @google/generative-ai.
 *   4. Streams the response token-by-token into the chat window.
 *
 * Setup:
 *   npm install @google/generative-ai
 *   Add VITE_GEMINI_API_KEY=your_key to .env.local
 *
 * Props:
 *   user  — Supabase User object (for display name only; auth is
 *           handled by the supabase client singleton)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { supabase } from "../lib/supabase"; // adjust path if needed

// ── Gemini client singleton ────────────────────────────────────
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// ── Helpers ────────────────────────────────────────────────────

/** Fetch the last 30 days of workout data for the current user. */
async function fetchWorkoutContext() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const iso = thirtyDaysAgo.toISOString();

    // Fetch sessions in range
    const { data: sessions, error: sessErr } = await supabase
        .from("sessions")
        .select("id, name, session_date, total_volume_kg, total_sets, sleep_hours, hit_macros, bodyweight, bodyweight_unit")
        .gte("session_date", iso)
        .order("session_date", { ascending: false });

    if (sessErr) throw new Error(`Sessions fetch failed: ${sessErr.message}`);
    if (!sessions || sessions.length === 0) return null;

    // For each session, fetch its blocks + sets via the summary view
    // We use the e1rm_history view to get per-exercise bests efficiently
    const { data: e1rmRows, error: e1rmErr } = await supabase
        .from("e1rm_history")
        .select("exercise_name, category, session_date, best_e1rm_kg, session_name")
        .gte("session_date", iso)
        .order("session_date", { ascending: false });

    if (e1rmErr) console.warn("e1rm fetch failed:", e1rmErr.message);

    return formatContextString(sessions, e1rmRows ?? []);
}

/**
 * Turn raw Supabase rows into a clean, token-efficient summary
 * that reads naturally to an LLM coaching system prompt.
 */
function formatContextString(sessions, e1rmRows) {
    const lines = [
        "=== ATHLETE WORKOUT DATA (last 30 days) ===",
        `Sessions logged: ${sessions.length}`,
        "",
    ];

    // Aggregate totals
    const totalVolume = sessions.reduce((a, s) => a + Number(s.total_volume_kg || 0), 0);
    const totalSets   = sessions.reduce((a, s) => a + Number(s.total_sets || 0), 0);
    lines.push(`Total volume:   ${(totalVolume / 1000).toFixed(1)} tonnes`);
    lines.push(`Total sets:     ${totalSets}`);
    lines.push("");

    // Per-session breakdown
    lines.push("--- Session Log ---");
    for (const s of sessions) {
        const date    = new Date(s.session_date).toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric" });
        const vol     = s.total_volume_kg ? `${(Number(s.total_volume_kg)/1000).toFixed(1)}t` : "—";
        const sleep   = s.sleep_hours != null ? `sleep ${s.sleep_hours}h` : "";
        const macros  = s.hit_macros != null ? (s.hit_macros ? "hit macros" : "missed macros") : "";
        const bw      = s.bodyweight ? `BW ${s.bodyweight}${s.bodyweight_unit}` : "";
        const readiness = [sleep, macros, bw].filter(Boolean).join(", ");

        lines.push(`${date}: "${s.name}" — ${vol}, ${s.total_sets} sets${readiness ? ` [${readiness}]` : ""}`);
    }

    // e1RM bests per exercise across the period
    if (e1rmRows.length > 0) {
        lines.push("");
        lines.push("--- Best e1RM per Exercise (this period) ---");

        // Aggregate: highest e1RM seen per exercise
        const bests = {};
        for (const row of e1rmRows) {
            const current = bests[row.exercise_name];
            if (!current || Number(row.best_e1rm_kg) > current.e1rm) {
                bests[row.exercise_name] = {
                    e1rm:     Number(row.best_e1rm_kg),
                    category: row.category,
                    date:     new Date(row.session_date).toLocaleDateString(undefined, { month:"short", day:"numeric" }),
                };
            }
        }

        // Group by category for readability
        const byCategory = {};
        for (const [name, data] of Object.entries(bests)) {
            if (!byCategory[data.category]) byCategory[data.category] = [];
            byCategory[data.category].push(`  ${name}: ${data.e1rm}kg e1RM (${data.date})`);
        }
        for (const [cat, rows] of Object.entries(byCategory)) {
            lines.push(`${cat}:`);
            lines.push(...rows);
        }
    }

    lines.push("");
    lines.push("=== END OF WORKOUT DATA ===");
    return lines.join("\n");
}

/** Build the Gemini system instruction. */
function buildSystemPrompt(workoutContext) {
    return `You are a knowledgeable, direct strength and conditioning coach embedded in the STR/VOL workout tracker app. Your athlete has asked you a question.

Your coaching style:
- Evidence-based. Cite mechanisms (e.g. "progressive overload", "SRA curve") when useful but keep language accessible.
- Direct and practical. Give concrete, actionable advice with specific rep ranges, percentages, or techniques.
- Concise. Avoid padding. Use short paragraphs or bullet points.
- Honest. If data is insufficient to diagnose a problem, say so and ask a targeted follow-up question.
- Warm but not sycophantic. No hollow affirmations.

${workoutContext
        ? `The following is your athlete's actual workout data from the last 30 days. Reference it specifically when relevant — e.g. their volume, frequency, top sets, readiness trends.\n\n${workoutContext}`
        : "No workout data is available for this athlete yet. Provide general advice and encourage them to log sessions for personalised coaching."
    }`;
}

// ── Markdown-lite renderer ─────────────────────────────────────
// Converts the subset of markdown Gemini commonly emits
// (**bold**, *italic*, `code`, ## headers, bullet lists)
// into spans without a full markdown library dependency.
function renderMarkdown(text) {
    const lines = text.split("\n");
    const result = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // Blank line → spacer
        if (!line.trim()) { result.push(<div key={i} className="h-2" />); i++; continue; }

        // ## Heading
        if (/^##\s/.test(line)) {
            result.push(
                <p key={i} className="text-zinc-100 font-bold text-sm mt-3 mb-1">
                    {inlineFormat(line.replace(/^##\s/, ""))}
                </p>
            );
            i++; continue;
        }

        // Bullet list item
        if (/^[-*•]\s/.test(line)) {
            const items = [];
            while (i < lines.length && /^[-*•]\s/.test(lines[i])) {
                items.push(
                    <li key={i} className="flex gap-2 text-zinc-300 text-sm leading-relaxed">
                        <span className="text-amber-500 shrink-0 mt-0.5">▸</span>
                        <span>{inlineFormat(lines[i].replace(/^[-*•]\s/, ""))}</span>
                    </li>
                );
                i++;
            }
            result.push(<ul key={`ul-${i}`} className="space-y-1 my-1">{items}</ul>);
            continue;
        }

        // Normal paragraph
        result.push(
            <p key={i} className="text-zinc-300 text-sm leading-relaxed">
                {inlineFormat(line)}
            </p>
        );
        i++;
    }

    return result;
}

function inlineFormat(text) {
    // Split by bold (**), italic (*), inline code (`)
    const parts = [];
    const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
    let last = 0, match;
    let key = 0;
    while ((match = re.exec(text)) !== null) {
        if (match.index > last) parts.push(<span key={key++}>{text.slice(last, match.index)}</span>);
        const raw = match[0];
        if (raw.startsWith("**")) parts.push(<strong key={key++} className="text-zinc-100 font-bold">{raw.slice(2,-2)}</strong>);
        else if (raw.startsWith("`")) parts.push(<code key={key++} className="bg-zinc-800 text-amber-300 text-xs rounded px-1 py-0.5">{raw.slice(1,-1)}</code>);
        else parts.push(<em key={key++} className="text-zinc-200 not-italic font-medium">{raw.slice(1,-1)}</em>);
        last = match.index + raw.length;
    }
    if (last < text.length) parts.push(<span key={key++}>{text.slice(last)}</span>);
    return parts.length > 0 ? parts : text;
}

// ── Suggestion chips ───────────────────────────────────────────
const SUGGESTIONS = [
    "My bench press is stalling. What should I do?",
    "Am I recovering well based on my recent sessions?",
    "How should I structure my next training week?",
    "My squat volume looks low — is that a problem?",
    "What does my sleep data say about my recovery?",
    "Give me a deload protocol based on my training.",
];

// ── Message bubble ─────────────────────────────────────────────
function MessageBubble({ msg }) {
    const isUser = msg.role === "user";

    return (
        <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
            {/* Avatar */}
            <div className={`w-7 h-7 rounded-full border flex items-center justify-center shrink-0 mt-0.5
        ${isUser
                ? "bg-amber-500/20 border-amber-500/40"
                : "bg-zinc-800 border-zinc-700"}`}>
                {isUser
                    ? <span className="text-amber-400 text-xs font-bold leading-none">U</span>
                    : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round">
                        <path d="M12 2a7 7 0 0 1 7 7c0 4-3 6-3 9H8c0-3-3-5-3-9a7 7 0 0 1 7-7z"/>
                        <path d="M9 21h6"/>
                        <path d="M10 17h4"/>
                    </svg>
                }
            </div>

            {/* Bubble */}
            <div className={`max-w-[82%] rounded-xl px-4 py-3 space-y-1
        ${isUser
                ? "bg-amber-500/10 border border-amber-500/20 rounded-tr-sm"
                : "bg-zinc-900 border border-zinc-800 rounded-tl-sm"}`}>

                {msg.role === "assistant" && msg.content === "__loading__"
                    ? <ThinkingDots />
                    : msg.role === "assistant"
                        ? renderMarkdown(msg.content)
                        : <p className="text-zinc-200 text-sm leading-relaxed">{msg.content}</p>
                }

                {msg.error && (
                    <p className="text-red-400 text-xs mt-1 flex items-center gap-1.5">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        {msg.error}
                    </p>
                )}
                {msg.timestamp && (
                    <p className="text-zinc-700 text-xs pt-1">
                        {new Date(msg.timestamp).toLocaleTimeString(undefined, { hour:"2-digit", minute:"2-digit" })}
                    </p>
                )}
            </div>
        </div>
    );
}

function ThinkingDots() {
    return (
        <div className="flex items-center gap-1.5 py-1 px-1">
            {[0,1,2].map(i => (
                <span key={i} className="w-1.5 h-1.5 rounded-full bg-amber-500"
                      style={{ animation: `dotPulse 1.2s ease-in-out ${i*0.22}s infinite` }} />
            ))}
        </div>
    );
}

// ── Main AICoach component ─────────────────────────────────────
export default function AICoach({ user }) {
    const [messages, setMessages] = useState([]);   // { role, content, timestamp, error }
    const [input, setInput]       = useState("");
    const [loading, setLoading]   = useState(false);
    const [contextStatus, setContextStatus] = useState("idle"); // "idle"|"fetching"|"ready"|"empty"|"error"
    const [contextStr, setContextStr]       = useState(null);
    const [apiKeyMissing, setApiKeyMissing] = useState(false);

    const bottomRef  = useRef(null);
    const inputRef   = useRef(null);
    const chatRef    = useRef(null);

    // Check API key on mount
    useEffect(() => {
        if (!GEMINI_API_KEY) setApiKeyMissing(true);
    }, []);

    // Auto-scroll to latest message
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Pre-fetch workout context once when the tab is opened
    useEffect(() => {
        let cancelled = false;
        setContextStatus("fetching");
        fetchWorkoutContext()
            .then(ctx => {
                if (cancelled) return;
                setContextStr(ctx);
                setContextStatus(ctx ? "ready" : "empty");
            })
            .catch(err => {
                console.error("Context fetch error:", err);
                if (!cancelled) setContextStatus("error");
            });
        return () => { cancelled = true; };
    }, []);

    // ── Submit handler ─────────────────────────────────────────
    const handleSubmit = useCallback(async () => {
        const text = input.trim();
        if (!text || loading || apiKeyMissing) return;

        setInput("");
        setLoading(true);

        // Append user message immediately
        const userMsg = { role: "user", content: text, timestamp: Date.now() };
        setMessages(prev => [...prev, userMsg]);

        // Append loading placeholder for assistant
        const loadingId = Date.now() + 1;
        setMessages(prev => [...prev, { role: "assistant", content: "__loading__", id: loadingId }]);

        try {
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({
                model: "gemini-2.5-flash",
                systemInstruction: buildSystemPrompt(contextStr),
            });

            // Build conversation history for multi-turn context
            // (exclude the loading placeholder we just added)
            const history = messages
                .filter(m => m.content !== "__loading__")
                .map(m => ({
                    role:  m.role === "user" ? "user" : "model",
                    parts: [{ text: m.content }],
                }));

            const chat = model.startChat({ history });

            // Stream the response
            const result = await chat.sendMessageStream(text);

            let accumulated = "";
            for await (const chunk of result.stream) {
                accumulated += chunk.text();
                // Replace loading placeholder with streaming content
                setMessages(prev => prev.map(m =>
                    m.id === loadingId
                        ? { role: "assistant", content: accumulated, id: loadingId }
                        : m
                ));
            }

            // Finalise — add timestamp once streaming is complete
            setMessages(prev => prev.map(m =>
                m.id === loadingId
                    ? { role: "assistant", content: accumulated, timestamp: Date.now() }
                    : m
            ));

        } catch (err) {
            console.error("Gemini error:", err);
            const msg = err.message?.includes("API_KEY")
                ? "Invalid API key. Check VITE_GEMINI_API_KEY in your .env.local."
                : err.message?.includes("quota")
                    ? "Gemini quota exceeded. Try again later."
                    : `Coach unavailable: ${err.message ?? "unknown error"}`;

            setMessages(prev => prev.map(m =>
                m.id === loadingId
                    ? { role: "assistant", content: "I wasn't able to respond right now.", error: msg, timestamp: Date.now() }
                    : m
            ));
        } finally {
            setLoading(false);
            inputRef.current?.focus();
        }
    }, [input, loading, messages, contextStr, apiKeyMissing]);

    const handleKeyDown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
    };

    const handleSuggestion = (s) => { setInput(s); inputRef.current?.focus(); };

    const isEmpty = messages.length === 0;

    // ── Context status badge ──────────────────────────────────
    const contextBadge = {
        fetching: { color:"text-zinc-500", dot:"bg-zinc-600", label:"Loading your data…" },
        ready:    { color:"text-green-500", dot:"bg-green-500", label:"Last 30 days loaded" },
        empty:    { color:"text-amber-500", dot:"bg-amber-500", label:"No sessions yet — general advice only" },
        error:    { color:"text-red-500",   dot:"bg-red-500",   label:"Could not load workout data" },
        idle:     { color:"text-zinc-600",  dot:"bg-zinc-700",  label:"" },
    }[contextStatus];

    return (
        <div className="flex flex-col h-full" style={{ fontFamily:"'IBM Plex Mono',monospace" }}>

            {/* ── API key warning banner ─────────────────────────── */}
            {apiKeyMissing && (
                <div className="mx-4 mt-4 px-4 py-3 bg-red-950/60 border border-red-800 rounded-lg flex items-start gap-3">
                    <svg className="shrink-0 mt-px text-red-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    <div>
                        <p className="text-red-400 text-xs font-bold">VITE_GEMINI_API_KEY is not set</p>
                        <p className="text-red-600 text-xs mt-0.5">Add it to your <code className="text-red-400">.env.local</code> file and restart Vite. Get a key at <span className="text-red-400">aistudio.google.com</span>.</p>
                    </div>
                </div>
            )}

            {/* ── Context status bar ─────────────────────────────── */}
            <div className="flex items-center gap-2 px-4 pt-3 pb-1">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${contextBadge.dot}`}
              style={contextStatus === "fetching" ? { animation:"dotPulse 1s ease-in-out infinite" } : {}} />
                <span className={`text-xs ${contextBadge.color}`}>{contextBadge.label}</span>
            </div>

            {/* ── Chat window ────────────────────────────────────── */}
            <div ref={chatRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-5 min-h-0">

                {/* Empty / welcome state */}
                {isEmpty && (
                    <div className="flex flex-col items-center justify-center h-full min-h-[280px] gap-6 text-center">
                        {/* Coach icon */}
                        <div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="1.8" strokeLinecap="round">
                                <path d="M12 2a7 7 0 0 1 7 7c0 4-3 6-3 9H8c0-3-3-5-3-9a7 7 0 0 1 7-7z"/>
                                <path d="M9 21h6"/>
                                <path d="M10 17h4"/>
                            </svg>
                        </div>
                        <div>
                            <p className="text-zinc-300 font-bold text-base tracking-tight">AI Coach</p>
                            <p className="text-zinc-600 text-xs mt-1 max-w-xs leading-relaxed">
                                Ask anything about your training. Your last 30 days of workout data is automatically attached as context.
                            </p>
                        </div>

                        {/* Suggestion chips */}
                        <div className="flex flex-wrap gap-2 justify-center max-w-md">
                            {SUGGESTIONS.map((s, i) => (
                                <button key={i} onClick={() => handleSuggestion(s)}
                                        className="text-xs text-zinc-400 hover:text-amber-400 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-amber-500/40 rounded-full px-3 py-1.5 transition-all text-left leading-relaxed">
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Message list */}
                {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}
                <div ref={bottomRef} />
            </div>

            {/* ── Suggestions (shown after first message) ────────── */}
            {!isEmpty && (
                <div className="px-4 pb-2 flex gap-2 overflow-x-auto">
                    {SUGGESTIONS.slice(0, 3).map((s, i) => (
                        <button key={i} onClick={() => handleSuggestion(s)} disabled={loading}
                                className="shrink-0 text-xs text-zinc-500 hover:text-amber-400 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-amber-500/30 rounded-full px-3 py-1 transition-all disabled:opacity-40">
                            {s}
                        </button>
                    ))}
                </div>
            )}

            {/* ── Input bar ──────────────────────────────────────── */}
            <div className="px-4 pb-4 pt-2 border-t border-zinc-800">
                <div className={`flex items-end gap-3 bg-zinc-900 border rounded-xl px-4 py-3 transition-colors
          ${apiKeyMissing ? "border-red-900 opacity-60" : "border-zinc-700 focus-within:border-amber-500"}`}>
          <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask your coach anything… (Enter to send, Shift+Enter for new line)"
              disabled={loading || apiKeyMissing}
              rows={1}
              className="flex-1 bg-transparent text-zinc-100 placeholder-zinc-600 text-sm outline-none resize-none leading-relaxed disabled:cursor-not-allowed"
              style={{ minHeight:"22px", maxHeight:"120px" }}
              onInput={e => {
                  // Auto-grow textarea
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }} />

                    <button
                        onClick={handleSubmit}
                        disabled={!input.trim() || loading || apiKeyMissing}
                        className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all
              ${input.trim() && !loading && !apiKeyMissing
                            ? "bg-amber-500 hover:bg-amber-400 text-zinc-900 shadow-sm shadow-amber-500/30"
                            : "bg-zinc-800 text-zinc-600 cursor-not-allowed"}`}>
                        {loading
                            ? <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round"/>
                            </svg>
                            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="22" y1="2" x2="11" y2="13"/>
                                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                            </svg>
                        }
                    </button>
                </div>

                <p className="text-zinc-800 text-xs mt-2 text-center">
                    AI advice is a training aid, not a substitute for medical or professional guidance.
                </p>
            </div>

            {/* ── Global styles ───────────────────────────────────── */}
            <style>{`
        @keyframes dotPulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50%       { opacity: 1;   transform: scale(1.1); }
        }
        textarea::placeholder { line-height: 1.5; }
      `}</style>
        </div>
    );
}
