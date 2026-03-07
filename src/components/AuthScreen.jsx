/**
 * AuthScreen.jsx
 *
 * Industrial-themed Login / Register entry point for STR/VOL.
 * Drop at:  src/components/AuthScreen.jsx
 *
 * Props:
 *   onAuthSuccess(user) — called after successful sign-in or immediate sign-up.
 *
 * Imports from your Supabase client at src/lib/supabase.js:
 *   signIn(email, password)              → { data, error }
 *   signUp(email, password, displayName) → { data, error }
 */

import { useState, useEffect, useRef } from "react";
import { signIn, signUp } from "../lib/supabase"; // ← adjust if path differs

// ─────────────────────────────────────
//  Decorative sub-components
// ─────────────────────────────────────

/** SVG barbell — echoes the workout context */
function BarbellMark({ className = "" }) {
    return (
        <svg viewBox="0 0 160 28" fill="none" xmlns="http://www.w3.org/2000/svg"
             className={className} aria-hidden="true">
            {/* shaft */}
            <rect x="22" y="13" width="116" height="2" rx="1" fill="#3f3f46"/>
            {/* collars */}
            <rect x="18"  y="9" width="7" height="10" rx="1.5" fill="#52525b"/>
            <rect x="135" y="9" width="7" height="10" rx="1.5" fill="#52525b"/>
            {/* plates */}
            <rect x="4"   y="4" width="14" height="20" rx="2"   fill="#f59e0b"/>
            <rect x="7"   y="10" width="3" height="8"  rx="1"   fill="#92400e" opacity="0.7"/>
            <rect x="142" y="4" width="14" height="20" rx="2"   fill="#f59e0b"/>
            <rect x="150" y="10" width="3" height="8"  rx="1"   fill="#92400e" opacity="0.7"/>
        </svg>
    );
}

/** 5-segment password strength bar */
function PasswordStrength({ password }) {
    const score = (() => {
        if (!password) return 0;
        let s = 0;
        if (password.length >= 8)           s++;
        if (password.length >= 12)          s++;
        if (/[A-Z]/.test(password))         s++;
        if (/[0-9]/.test(password))         s++;
        if (/[^A-Za-z0-9]/.test(password))  s++;
        return s;
    })();

    const meta = [
        null,
        { label: "Weak",   color: "#ef4444" },
        { label: "Fair",   color: "#f97316" },
        { label: "Good",   color: "#eab308" },
        { label: "Strong", color: "#22c55e" },
        { label: "Max",    color: "#34d399" },
    ];

    if (!password) return null;
    const { label, color } = meta[score] || meta[1];

    return (
        <div className="mt-2 space-y-1">
            <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map(i => (
                    <div key={i}
                         className="h-[3px] flex-1 rounded-full transition-all duration-300"
                         style={{ backgroundColor: i <= score ? color : "#27272a" }} />
                ))}
            </div>
            <span className="text-[11px] transition-colors duration-300"
                  style={{ color, fontFamily: "'IBM Plex Mono',monospace" }}>
        {label}
      </span>
        </div>
    );
}

// ─────────────────────────────────────
//  Main AuthScreen component
// ─────────────────────────────────────

export default function AuthScreen({ onAuthSuccess }) {
    const [mode, setMode]               = useState("login");   // "login" | "register"
    const [email, setEmail]             = useState("");
    const [password, setPassword]       = useState("");
    const [displayName, setDisplayName] = useState("");
    const [showPass, setShowPass]       = useState(false);
    const [loading, setLoading]         = useState(false);
    const [error, setError]             = useState(null);
    const [notice, setNotice]           = useState(null);
    const [mounted, setMounted]         = useState(false);
    const emailRef = useRef(null);

    // Staggered entrance animation
    useEffect(() => {
        const t = setTimeout(() => setMounted(true), 40);
        return () => clearTimeout(t);
    }, []);

    // Auto-focus + clear messages when switching modes
    useEffect(() => {
        setError(null);
        setNotice(null);
        const t = setTimeout(() => emailRef.current?.focus(), 60);
        return () => clearTimeout(t);
    }, [mode]);

    // ── Submit handler ────────────────────────────
    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setNotice(null);
        setLoading(true);

        try {
            if (mode === "login") {
                const { data, error: err } = await signIn(email, password);
                if (err) throw err;
                onAuthSuccess(data.user);

            } else {
                if (!displayName.trim())  throw new Error("Display name is required.");
                if (password.length < 8)  throw new Error("Password must be at least 8 characters.");

                const { data, error: err } = await signUp(email, password, displayName.trim());
                if (err) throw err;

                if (data.session) {
                    // Email confirmation disabled → user is immediately active
                    onAuthSuccess(data.user);
                } else {
                    // Confirmation email sent
                    setNotice("Account created! Check your inbox to confirm your email, then sign in.");
                    setMode("login");
                }
            }
        } catch (err) {
            setError(err.message || "Something went wrong — please try again.");
        } finally {
            setLoading(false);
        }
    };

    // ── Shared input class helper ─────────────────
    const inputCls = (isError = false) =>
        `w-full bg-zinc-800 border rounded-lg px-3 py-2.5 text-zinc-100 text-sm outline-none
     transition-colors placeholder-zinc-600
     ${isError
            ? "border-red-700 focus:border-red-500"
            : "border-zinc-700 focus:border-amber-500"}`;

    // ── Feature list (left panel) ─────────────────
    const features = [
        { tag: "SETS · REPS · KG · RPE", label: "Log every set"   },
        { tag: "e1RM BADGING",            label: "Track PRs live"   },
        { tag: "ROUTINE TEMPLATES",       label: "Warm up faster"  },
        { tag: "PROGRESS CHARTS",         label: "Visualise gains" },
        { tag: "READINESS MODULE",        label: "Sleep & macros"  },
    ];

    return (
        <div className="min-h-screen bg-zinc-950 flex items-stretch"
             style={{ fontFamily: "'IBM Plex Mono',monospace" }}>

            {/* ════════════════════════════════════
          LEFT PANEL  –  brand & features
          Visible lg+ only
      ════════════════════════════════════ */}
            <aside className="hidden lg:flex flex-col justify-between
        w-[400px] shrink-0 border-r border-zinc-800/70 p-10 relative overflow-hidden">

                {/* Engineering grid texture */}
                <div className="absolute inset-0 pointer-events-none"
                     style={{
                         backgroundImage:
                             "repeating-linear-gradient(0deg,#ffffff05 0,#ffffff05 1px,transparent 1px,transparent 48px)," +
                             "repeating-linear-gradient(90deg,#ffffff05 0,#ffffff05 1px,transparent 1px,transparent 48px)",
                     }} />

                {/* Amber left-edge accent */}
                <div className="absolute top-0 left-0 w-[3px] h-28
          bg-gradient-to-b from-amber-500 via-amber-500/40 to-transparent" />

                {/* ── Wordmark ── */}
                <div style={{
                    opacity:    mounted ? 1 : 0,
                    transform:  mounted ? "translateY(0)" : "translateY(-14px)",
                    transition: "opacity 0.6s ease, transform 0.6s ease",
                }}>
                    <p className="text-amber-500 font-bold text-[2.6rem] tracking-tight leading-none">
                        STR<span className="text-zinc-700">/</span>VOL
                    </p>
                    <p className="text-zinc-700 text-[11px] tracking-[0.22em] mt-1.5 uppercase">
                        Strength &amp; Volume Tracker
                    </p>
                </div>

                {/* ── Mid section ── */}
                <div className="space-y-8">
                    {/* Barbell */}
                    <div style={{
                        opacity:    mounted ? 1 : 0,
                        transition: "opacity 0.7s ease 0.15s",
                    }}>
                        <BarbellMark className="w-44" />
                    </div>

                    {/* Feature rows */}
                    <ul className="space-y-0">
                        {features.map(({ tag, label }, i) => (
                            <li key={i}
                                className="flex items-center justify-between py-2.5 border-b border-zinc-800/60"
                                style={{
                                    opacity:    mounted ? 1 : 0,
                                    transform:  mounted ? "translateX(0)" : "translateX(-12px)",
                                    transition: `opacity 0.5s ease ${0.2 + i * 0.07}s, transform 0.5s ease ${0.2 + i * 0.07}s`,
                                }}>
                                <span className="text-zinc-600 text-xs">{label}</span>
                                <span className="text-zinc-500 text-[11px] tracking-wider">{tag}</span>
                            </li>
                        ))}
                    </ul>

                    {/* Blinking terminal cursor */}
                    <div className="flex items-center gap-2" style={{
                        opacity:    mounted ? 1 : 0,
                        transition: "opacity 0.5s ease 0.6s",
                    }}>
                        <span className="text-amber-500 text-xs" style={{ animation: "blink 1.1s step-end infinite" }}>▋</span>
                        <span className="text-zinc-700 text-[11px]">v1.0 · powered by Supabase</span>
                    </div>
                </div>

                {/* Bottom tagline */}
                <p className="text-zinc-800 text-[11px]" style={{
                    opacity:    mounted ? 1 : 0,
                    transition: "opacity 0.5s ease 0.75s",
                }}>
                    Built for athletes who measure everything.
                </p>
            </aside>

            {/* ════════════════════════════════════
          RIGHT PANEL  –  auth form
      ════════════════════════════════════ */}
            <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">

                {/* Mobile wordmark */}
                <div className="lg:hidden mb-10 text-center" style={{
                    opacity:    mounted ? 1 : 0,
                    transform:  mounted ? "translateY(0)" : "translateY(-10px)",
                    transition: "opacity 0.5s ease, transform 0.5s ease",
                }}>
                    <p className="text-amber-500 font-bold text-3xl tracking-tight">
                        STR<span className="text-zinc-700">/</span>VOL
                    </p>
                    <p className="text-zinc-700 text-[11px] tracking-[0.2em] mt-1 uppercase">
                        Strength &amp; Volume Tracker
                    </p>
                </div>

                {/* ── Form card ── */}
                <div className="w-full max-w-[360px]" style={{
                    opacity:    mounted ? 1 : 0,
                    transform:  mounted ? "translateY(0)" : "translateY(22px)",
                    transition: "opacity 0.55s ease 0.1s, transform 0.55s ease 0.1s",
                }}>

                    {/* Mode toggle tabs */}
                    <div className="flex mb-6 p-0.5 bg-zinc-900 border border-zinc-800 rounded-lg">
                        {[
                            { id: "login",    label: "Sign In"  },
                            { id: "register", label: "Register" },
                        ].map(({ id, label }) => (
                            <button key={id} onClick={() => setMode(id)}
                                    className={`flex-1 py-2 text-xs font-bold rounded tracking-widest uppercase
                  transition-all duration-200
                  ${mode === id
                                        ? "bg-amber-500 text-zinc-900"
                                        : "text-zinc-500 hover:text-zinc-300"}`}>
                                {label}
                            </button>
                        ))}
                    </div>

                    {/* Notice banner (email confirmation) */}
                    {notice && (
                        <div className="mb-5 px-3.5 py-3 bg-green-950/60 border border-green-800 rounded-lg
              flex items-start gap-2.5">
                            <svg className="shrink-0 mt-px" width="13" height="13" viewBox="0 0 24 24"
                                 fill="none" stroke="#4ade80" strokeWidth="2.5">
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" strokeLinecap="round"/>
                                <polyline points="22 4 12 14.01 9 11.01"/>
                            </svg>
                            <p className="text-green-400 text-xs leading-relaxed">{notice}</p>
                        </div>
                    )}

                    {/* Error banner */}
                    {error && (
                        <div className="mb-5 px-3.5 py-3 bg-red-950/60 border border-red-800 rounded-lg
              flex items-start gap-2.5">
                            <svg className="shrink-0 mt-px" width="13" height="13" viewBox="0 0 24 24"
                                 fill="none" stroke="#f87171" strokeWidth="2.5">
                                <circle cx="12" cy="12" r="10"/>
                                <line x1="12" y1="8"  x2="12"    y2="12"/>
                                <line x1="12" y1="16" x2="12.01" y2="16"/>
                            </svg>
                            <p className="text-red-400 text-xs leading-relaxed">{error}</p>
                        </div>
                    )}

                    {/* Form fields */}
                    <form onSubmit={handleSubmit} className="space-y-4" noValidate>

                        {/* Display name — register only, slides in */}
                        {mode === "register" && (
                            <div className="space-y-1.5"
                                 style={{ animation: "slideDown 0.22s ease forwards" }}>
                                <label className="text-zinc-500 text-[11px] tracking-widest uppercase block">
                                    Display Name
                                </label>
                                <input
                                    type="text"
                                    value={displayName}
                                    onChange={e => setDisplayName(e.target.value)}
                                    placeholder="e.g. Alex"
                                    autoComplete="name"
                                    required
                                    className={inputCls()}
                                />
                            </div>
                        )}

                        {/* Email */}
                        <div className="space-y-1.5">
                            <label className="text-zinc-500 text-[11px] tracking-widest uppercase block">
                                Email
                            </label>
                            <input
                                ref={emailRef}
                                type="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                placeholder="you@example.com"
                                autoComplete="email"
                                required
                                className={inputCls()}
                            />
                        </div>

                        {/* Password */}
                        <div className="space-y-1.5">
                            <label className="text-zinc-500 text-[11px] tracking-widest uppercase block">
                                Password
                            </label>
                            <div className="relative">
                                <input
                                    type={showPass ? "text" : "password"}
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder={mode === "register" ? "Min. 8 characters" : "••••••••"}
                                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                                    required
                                    className={`${inputCls()} pr-11`}
                                />
                                {/* Show/hide toggle */}
                                <button
                                    type="button"
                                    onClick={() => setShowPass(s => !s)}
                                    aria-label={showPass ? "Hide password" : "Show password"}
                                    className="absolute right-3 top-1/2 -translate-y-1/2
                    text-zinc-600 hover:text-zinc-400 transition-colors">
                                    {showPass
                                        ? /* eye-slash */
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                                             stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                                            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                                            <line x1="1" y1="1" x2="23" y2="23"/>
                                        </svg>
                                        : /* eye */
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                                             stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                            <circle cx="12" cy="12" r="3"/>
                                        </svg>
                                    }
                                </button>
                            </div>
                            {mode === "register" && <PasswordStrength password={password} />}
                        </div>

                        {/* Submit button */}
                        <button
                            type="submit"
                            disabled={loading || !email || !password}
                            className={`w-full py-3 mt-1 rounded-lg text-sm font-bold tracking-[0.12em]
                uppercase transition-all duration-200
                ${loading || !email || !password
                                ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                                : "bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-900 shadow-lg shadow-amber-500/20 hover:shadow-amber-500/30"}`}>
                            {loading
                                ? <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24"
                         fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round"/>
                    </svg>
                                    {mode === "login" ? "Signing in…" : "Creating account…"}
                  </span>
                                : mode === "login" ? "Sign In" : "Create Account"
                            }
                        </button>
                    </form>

                    {/* Divider */}
                    <div className="my-6 flex items-center gap-3">
                        <div className="flex-1 h-px bg-zinc-800" />
                        <span className="text-zinc-700 text-[11px]">or</span>
                        <div className="flex-1 h-px bg-zinc-800" />
                    </div>

                    {/* Mode switch link */}
                    <p className="text-center text-zinc-600 text-xs">
                        {mode === "login"
                            ? <>No account?{" "}
                                <button onClick={() => setMode("register")}
                                        className="text-amber-500 hover:text-amber-400 font-bold transition-colors">
                                    Register free →
                                </button>
                            </>
                            : <>Already have one?{" "}
                                <button onClick={() => setMode("login")}
                                        className="text-amber-500 hover:text-amber-400 font-bold transition-colors">
                                    Sign in →
                                </button>
                            </>
                        }
                    </p>
                </div>

                {/* Fine print */}
                <p className="mt-12 text-zinc-800 text-[11px] text-center
          max-w-[260px] leading-relaxed" style={{
                    opacity:    mounted ? 1 : 0,
                    transition: "opacity 0.6s ease 0.5s",
                }}>
                    Data stored securely via Supabase.<br/>
                    Passwords are never stored in plain text.
                </p>
            </main>

            {/* ── Global styles ────────────────────── */}
            <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&display=swap');

        * { box-sizing: border-box; }

        @keyframes blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }

        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0);    }
        }

        input[type=number]::-webkit-inner-spin-button { display: none; }

        input:-webkit-autofill,
        input:-webkit-autofill:focus {
          -webkit-box-shadow: 0 0 0 100px #27272a inset !important;
          -webkit-text-fill-color: #f4f4f5 !important;
          caret-color: #f4f4f5;
        }
      `}</style>
        </div>
    );
}
