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
// ─────────────────────────────────────────────────────────────
//  Nutrition helpers
//  Append these to the bottom of src/lib/supabase.js
// ─────────────────────────────────────────────────────────────

/**
 * Upsert (insert or update) a daily nutrition log entry.
 *
 * Because the table has a UNIQUE(user_id, log_date) constraint,
 * calling this twice on the same date simply updates the row —
 * no need for a separate "edit" function.
 *
 * @param {Object} payload
 * @param {string} payload.log_date   ISO date string "YYYY-MM-DD"
 * @param {number} payload.calories
 * @param {number} payload.protein_g
 * @param {number} payload.carbs_g
 * @param {number} payload.fats_g
 * @param {string} [payload.notes]    Optional free-text note
 *
 * @returns {{ data, error }}
 */
export async function saveDailyNutrition({ log_date, calories, protein_g, carbs_g, fats_g, notes = null }) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { data: null, error: new Error("Not authenticated") };

    return supabase
        .from("daily_nutrition")
        .upsert(
            {
                user_id:   user.id,
                log_date,
                calories,
                protein_g,
                carbs_g,
                fats_g,
                notes,
            },
            {
                // Match on the unique key — if a row already exists for
                // this user + date it will be updated, otherwise inserted.
                onConflict: "user_id,log_date",
                ignoreDuplicates: false,
            }
        )
        .select()
        .single();
}

/**
 * Fetch nutrition history for the current user.
 *
 * @param {number} days   How many days back to fetch (default 30)
 * @returns {{ data: Array<DailyNutrition>, error }}
 *
 * Each row shape:
 *   { id, user_id, log_date, calories, protein_g, carbs_g, fats_g, notes, created_at, updated_at }
 */
export async function fetchNutritionHistory(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const iso = since.toISOString().split("T")[0]; // "YYYY-MM-DD"

    return supabase
        .from("daily_nutrition")
        .select("id, log_date, calories, protein_g, carbs_g, fats_g, notes, updated_at")
        .gte("log_date", iso)
        .order("log_date", { ascending: false });
}

/**
 * Delete a single daily_nutrition row by its primary key.
 *
 * @param {string} id   UUID of the row to delete
 * @returns {{ error }}
 */
export async function deleteNutritionEntry(id) {
    return supabase
        .from("daily_nutrition")
        .delete()
        .eq("id", id);
}
// ─────────────────────────────────────────────────────────────
//  Analytics helpers
//  Append these to the bottom of src/lib/supabase.js
// ─────────────────────────────────────────────────────────────

/**
 * Fetch all data needed by AnalyticsDashboard in a single call.
 *
 * Returns two parallel arrays that the component joins by date
 * on the client — keeping the query simple and avoiding a
 * server-side JOIN across user-owned tables.
 *
 * @param {number} days  Look-back window in days (default 60)
 *
 * @returns {{
 *   sessions:  Array<{ session_date, total_volume_kg, sleep_hours, name }>,
 *   nutrition: Array<{ log_date, calories, protein_g, carbs_g, fats_g }>,
 *   error:     Error | null
 * }}
 */
export async function fetchAnalyticsData(days = 60) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const isoSince = since.toISOString(); // full ISO for timestamptz comparison

    // Run both queries in parallel
    const [sessionsResult, nutritionResult] = await Promise.all([
        supabase
            .from("sessions")
            .select("session_date, total_volume_kg, sleep_hours, name")
            .gte("session_date", isoSince)
            .order("session_date", { ascending: true }),

        supabase
            .from("daily_nutrition")
            .select("log_date, calories, protein_g, carbs_g, fats_g")
            .gte("log_date", isoSince.split("T")[0]) // date column needs "YYYY-MM-DD"
            .order("log_date", { ascending: true }),
    ]);

    // Surface the first error encountered, if any
    const error = sessionsResult.error ?? nutritionResult.error ?? null;

    return {
        sessions:  sessionsResult.data  ?? [],
        nutrition: nutritionResult.data ?? [],
        error,
    };
}
// ─────────────────────────────────────────────────────────────
//  Leaderboard helpers
//  Append these to the bottom of src/lib/supabase.js
// ─────────────────────────────────────────────────────────────

/**
 * Fetch the global leaderboard for a specific exercise by
 * calling the `get_global_leaderboard` SECURITY DEFINER function.
 *
 * @param {string} exerciseName
 *   One of: 'Back Squat' | 'Bench Press' | 'Conventional Deadlift'
 *   (or any exercise name in the exercises table)
 *
 * @returns {{
 *   data: Array<{
 *     rank:            number,
 *     user_id:         string,   // uuid
 *     display_name:    string,
 *     best_e1rm_kg:    number,
 *     best_weight_kg:  number,
 *     total_sets:      number,
 *   }>,
 *   error: Error | null
 * }}
 *
 * Usage:
 *   const { data, error } = await fetchLeaderboardData('Bench Press');
 */
export async function fetchLeaderboardData(exerciseName) {
    const { data, error } = await supabase.rpc("get_global_leaderboard", {
        p_exercise_name: exerciseName,
    });

    if (error) return { data: [], error };

    // Coerce Postgres numeric strings to JS numbers for chart / display use
    const rows = (data ?? []).map(row => ({
        rank:           Number(row.rank),
        user_id:        row.user_id,
        display_name:   row.display_name ?? "Anonymous",
        best_e1rm_kg:   row.best_e1rm_kg  != null ? Number(row.best_e1rm_kg)  : null,
        best_weight_kg: row.best_weight_kg != null ? Number(row.best_weight_kg) : null,
        total_sets:     Number(row.total_sets),
    }));

    return { data: rows, error: null };
}
// ─────────────────────────────────────────────────────────────
//  Dynamic Exercise Library helpers
//  Append these to the bottom of src/lib/supabase.js
// ─────────────────────────────────────────────────────────────

/**
 * Fetch the combined exercise library for the current user:
 * all global exercises (user_id IS NULL) plus all exercises
 * the user has created themselves.
 *
 * The RLS policy on the exercises table enforces this filter
 * server-side, so a simple select(*) is all we need here.
 *
 * Returns rows shaped as:
 *   { id, name, category, tags, user_id }
 * where user_id === null means it's a global/seeded exercise.
 *
 * @returns {{ data: Array<Exercise>, error: Error | null }}
 */
export async function fetchExerciseLibrary() {
    return supabase
        .from("exercises")
        .select("id, name, category, tags, user_id")
        .order("name", { ascending: true });
}

/**
 * Insert a new custom exercise owned by the current user.
 *
 * The RLS INSERT policy enforces that user_id must equal
 * auth.uid(), so we set it explicitly here.
 *
 * @param {string} name      Display name, e.g. "Zercher Squat"
 * @param {string} category  One of: Legs | Posterior | Push | Pull | Core
 * @param {string[]} [tags]  Optional tag array, defaults to ["custom"]
 *
 * @returns {{ data: Exercise | null, error: Error | null }}
 */
export async function addCustomExercise(name, category, tags = ["custom"]) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { data: null, error: new Error("Not authenticated") };

    return supabase
        .from("exercises")
        .insert({
            user_id:  user.id,
            name:     name.trim(),
            category,
            tags,
        })
        .select("id, name, category, tags, user_id")
        .single();
}