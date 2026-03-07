// ─────────────────────────────────────────────────────────────
//  src/lib/supabase.js
//
//  Supabase client + typed query helpers for STR/VOL.
//
//  Environment variables (add to .env.local):
//    VITE_SUPABASE_URL      = https://<project-ref>.supabase.co
//    VITE_SUPABASE_ANON_KEY = eyJ...
//
//  For Create React App replace VITE_ with REACT_APP_.
// ─────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";

// ── Client singleton ──────────────────────────────────────────
const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error(
        "Missing Supabase env vars. " +
        "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local"
    );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        // Persist session in localStorage (default).
        // Set to false if you handle token storage yourself.
        persistSession: true,
        autoRefreshToken: true,
    },
});


// ─────────────────────────────────────────────────────────────
//  Auth helpers
// ─────────────────────────────────────────────────────────────

/** Sign up with email + password. Profile row is created by DB trigger. */
export async function signUp(email, password, displayName) {
    return supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName } },
    });
}

/** Sign in with email + password. */
export async function signIn(email, password) {
    return supabase.auth.signInWithPassword({ email, password });
}

/** Sign out. */
export async function signOut() {
    return supabase.auth.signOut();
}

/** Returns the currently authenticated user or null. */
export function getCurrentUser() {
    return supabase.auth.getUser();
}


// ─────────────────────────────────────────────────────────────
//  Session queries
// ─────────────────────────────────────────────────────────────

/**
 * Save a complete workout session.
 *
 * Mirrors the LocalStorage payload shape:
 *   { name, blocks, totalVolume, totalSets, readiness }
 *
 * Returns { session, error }.
 */
export async function saveSession(payload) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { session: null, error: new Error("Not authenticated") };

    const { name, blocks, totalVolume, totalSets, readiness } = payload;

    // 1 ── Insert session row
    const { data: session, error: sessionError } = await supabase
        .from("sessions")
        .insert({
            user_id:         user.id,
            name,
            total_volume_kg: totalVolume,
            total_sets:      totalSets,
            // Readiness fields (null-safe)
            bodyweight:       readiness?.bodyweight     ?? null,
            bodyweight_unit:  readiness?.bwUnit         ?? "kg",
            sleep_hours:      readiness?.sleep          ?? null,
            hit_macros:       readiness?.hitMacros      ?? null,
        })
        .select()
        .single();

    if (sessionError) return { session: null, error: sessionError };

    // 2 ── Insert workout_blocks + workout_sets for each exercise block
    for (let blockOrder = 0; blockOrder < blocks.length; blockOrder++) {
        const block = blocks[blockOrder];

        // Look up exercise_id from the reference table
        const { data: exRow, error: exError } = await supabase
            .from("exercises")
            .select("id")
            .eq("name", block.exercise)
            .single();

        if (exError) {
            console.warn(`Exercise not found in DB: ${block.exercise}`, exError);
            continue;
        }

        const { data: wBlock, error: blockError } = await supabase
            .from("workout_blocks")
            .insert({
                session_id:   session.id,
                exercise_id:  exRow.id,
                block_order:  blockOrder,
            })
            .select()
            .single();

        if (blockError) {
            console.error("Block insert failed", blockError);
            continue;
        }

        // Build set rows — each LocalStorage "row" may represent
        // multiple identical sets (sets × reps × weight), so we
        // expand them into individual DB rows.
        const setRows = [];
        let setNumber = 1;

        for (const s of block.sets) {
            const count = Math.max(1, s.sets ?? 1);
            for (let i = 0; i < count; i++) {
                setRows.push({
                    block_id:   wBlock.id,
                    set_number: setNumber++,
                    reps:       s.reps,
                    weight_kg:  s.weight,
                    rpe:        s.rpe ?? null,
                    // e1rm_kg is a generated column — do NOT insert it
                });
            }
        }

        if (setRows.length > 0) {
            const { error: setsError } = await supabase
                .from("workout_sets")
                .insert(setRows);

            if (setsError) console.error("Sets insert failed", setsError);
        }
    }

    return { session, error: null };
}

/**
 * Fetch paginated session history for the current user.
 * Returns the session_summary view rows.
 *
 * @param {number} limit   Rows per page (default 20)
 * @param {number} offset  Pagination offset (default 0)
 */
export async function fetchSessionHistory(limit = 20, offset = 0) {
    return supabase
        .from("session_summary")
        .select("*")
        .order("session_date", { ascending: false })
        .range(offset, offset + limit - 1);
}

/**
 * Delete a single session (cascades to blocks + sets via FK).
 */
export async function deleteSession(sessionId) {
    return supabase.from("sessions").delete().eq("id", sessionId);
}


// ─────────────────────────────────────────────────────────────
//  Progress / e1RM chart queries
// ─────────────────────────────────────────────────────────────

/**
 * Returns the e1RM history for one exercise (for the chart).
 *
 * @param {string} exerciseName  e.g. "Bench Press"
 * @returns Array of { session_date, best_e1rm_kg, session_name }
 */
export async function fetchE1rmHistory(exerciseName) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { data: [], error: new Error("Not authenticated") };

    return supabase
        .from("e1rm_history")
        .select("session_date, best_e1rm_kg, session_name")
        .eq("user_id",       user.id)
        .eq("exercise_name", exerciseName)
        .order("session_date", { ascending: true });
}

/**
 * Returns a list of unique exercise names the user has ever logged.
 * Used to populate the chart exercise dropdown.
 */
export async function fetchLoggedExercises() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { data: [], error: new Error("Not authenticated") };

    return supabase
        .from("e1rm_history")
        .select("exercise_name, category")
        .eq("user_id", user.id)
        .order("exercise_name");
}

/**
 * Calls the `get_user_prs()` DB function to retrieve all-time
 * PRs without scanning sets on the client.
 *
 * Returns an object shaped like buildHistoricalPRs() output:
 *   { "Bench Press": { maxWeight: 120, maxE1rm: 142 }, ... }
 */
export async function fetchUserPRs() {
    const { data, error } = await supabase.rpc("get_user_prs");
    if (error) return { prs: {}, error };

    const prs = {};
    for (const row of data) {
        prs[row.exercise_name] = {
            maxWeight: Number(row.max_weight_kg),
            maxE1rm:   Number(row.max_e1rm_kg),
        };
    }
    return { prs, error: null };
}


// ─────────────────────────────────────────────────────────────
//  Template queries
// ─────────────────────────────────────────────────────────────

/**
 * Fetch all templates for the current user, newest first.
 */
export async function fetchTemplates() {
    return supabase
        .from("templates")
        .select("id, name, exercises, created_at")
        .order("created_at", { ascending: false });
}

/**
 * Save a new template.
 *
 * @param {string}   name       Template name e.g. "Push Day"
 * @param {Object[]} exercises  Array of { name, category, defaultSets }
 */
export async function saveTemplate(name, exercises) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { data: null, error: new Error("Not authenticated") };

    return supabase
        .from("templates")
        .insert({ user_id: user.id, name, exercises })
        .select()
        .single();
}

/**
 * Delete a template by ID.
 */
export async function deleteTemplate(templateId) {
    return supabase.from("templates").delete().eq("id", templateId);
}


// ─────────────────────────────────────────────────────────────
//  Real-time subscription (optional — for future multiplayer
//  or multi-device sync)
// ─────────────────────────────────────────────────────────────

/**
 * Subscribe to session inserts for the current user.
 * Returns an unsubscribe function.
 *
 * Usage:
 *   const unsub = subscribeToSessions((newSession) => { ... });
 *   // later:
 *   unsub();
 */
export function subscribeToSessions(onInsert) {
    const channel = supabase
        .channel("sessions-realtime")
        .on(
            "postgres_changes",
            {
                event:  "INSERT",
                schema: "public",
                table:  "sessions",
                filter: `user_id=eq.${supabase.auth.getUser()?.id}`,
            },
            (payload) => onInsert(payload.new)
        )
        .subscribe();

    return () => supabase.removeChannel(channel);
}
