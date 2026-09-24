import { randomUUID } from "node:crypto";
import { TutorDatabase } from "./database.js";
import { getLanguagePack, getSkill, skillsForLanguage, LANGUAGE_ALIASES } from "./language-packs.js";
import { usableMastery } from "./adaptive.js";

const iso = () => new Date().toISOString();
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export class LearningStore extends TutorDatabase {
  constructor(filename) {
    super(filename);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  addColumn(table, column, definition) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((entry) => entry.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  migrate() {
    this.addColumn("learner_skills", "emerald_score", "REAL NOT NULL DEFAULT 0.1");
    this.addColumn("learner_skills", "copper_score", "REAL NOT NULL DEFAULT 0.1");
    this.addColumn("activities", "session_id", "TEXT");
    this.addColumn("activities", "phase", "TEXT");
    this.addColumn("activities", "input_text", "TEXT");
    this.addColumn("activities", "options_json", "TEXT");
    this.addColumn("activities", "correct_index", "INTEGER");
    this.addColumn("activities", "model_answer", "TEXT");
    this.addColumn("activities", "status", "TEXT NOT NULL DEFAULT 'open'");
    this.addColumn("activities", "pending_answer", "TEXT");
    this.addColumn("activities", "pending_transfer_source", "TEXT");
    this.addColumn("activities", "pending_interference_source", "TEXT");
    this.addColumn("activities", "pending_input_mode", "TEXT");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS learner_profiles (
        learner_id TEXT PRIMARY KEY REFERENCES learners(id),
        goal TEXT NOT NULL DEFAULT 'conversation',
        minutes_per_day INTEGER NOT NULL DEFAULT 15,
        interests_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS language_enrollments (
        learner_id TEXT NOT NULL REFERENCES learners(id),
        language TEXT NOT NULL,
        target_level TEXT NOT NULL,
        variety TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        PRIMARY KEY (learner_id, language)
      );
      CREATE TABLE IF NOT EXISTS learner_state (
        learner_id TEXT NOT NULL REFERENCES learners(id),
        language TEXT NOT NULL,
        dimensions_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (learner_id, language)
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        learner_id TEXT NOT NULL REFERENCES learners(id),
        language TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        step TEXT NOT NULL,
        current_activity_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_session_per_language
        ON sessions(learner_id, language) WHERE status = 'active';
      CREATE TABLE IF NOT EXISTS learning_events (
        id TEXT PRIMARY KEY,
        learner_id TEXT NOT NULL REFERENCES learners(id),
        session_id TEXT NOT NULL REFERENCES sessions(id),
        activity_id TEXT NOT NULL UNIQUE REFERENCES activities(id),
        language TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        concept_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        input_text TEXT NOT NULL,
        expected_output TEXT NOT NULL,
        actual_output TEXT NOT NULL,
        error_type TEXT,
        mistakes_json TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL,
        correction TEXT,
        transfer_source TEXT,
        interference_source TEXT,
        emerald_score REAL NOT NULL,
        copper_score REAL NOT NULL,
        usable_mastery REAL NOT NULL,
        next_review_at TEXT NOT NULL,
        score INTEGER NOT NULL,
        evidence_source TEXT NOT NULL,
        input_mode TEXT NOT NULL,
        response_time_ms INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS learning_events_learner_language
        ON learning_events(learner_id, language, created_at);
      CREATE TABLE IF NOT EXISTS transfer_signals (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE REFERENCES learning_events(id),
        learner_id TEXT NOT NULL REFERENCES learners(id),
        concept_id TEXT NOT NULL,
        source_language TEXT NOT NULL,
        target_language TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('helped', 'interfered')),
        confidence REAL NOT NULL,
        relation_type TEXT NOT NULL DEFAULT 'observed',
        relation_note TEXT,
        basis TEXT NOT NULL DEFAULT 'learner_report',
        error_type TEXT,
        produced_form TEXT NOT NULL,
        expected_form TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    this.addColumn("transfer_signals", "relation_type", "TEXT NOT NULL DEFAULT 'observed'");
    this.addColumn("transfer_signals", "relation_note", "TEXT");
    this.addColumn("transfer_signals", "basis", "TEXT NOT NULL DEFAULT 'learner_report'");

    for (const [oldCode, canonical] of Object.entries(LANGUAGE_ALIASES)) {
      this.db.prepare("UPDATE learner_skills SET language = ? WHERE language = ?").run(canonical, oldCode);
    }
    // Existing scores came from a permissive substring heuristic. Keep the
    // historical rows, but require fresh evidence for the new two-axis model.
    this.db.exec("UPDATE learner_skills SET mastery = 0.1 WHERE attempts > 0 AND emerald_score = 0.1 AND copper_score = 0.1");
    // A process crash may leave an in-flight model assessment reserved. No
    // requests from that process survive restart, so it is safe to reopen it.
    this.db.exec("UPDATE activities SET status = 'open' WHERE status = 'processing'");
  }

  transaction(work) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  createLearner(name, { goal = "conversation", minutesPerDay = 15, interests = [] } = {}) {
    if (!Number.isInteger(minutesPerDay) || minutesPerDay < 5 || minutesPerDay > 120) {
      throw new Error("minutesPerDay must be between 5 and 120");
    }
    if (!Array.isArray(interests) || interests.some((interest) => typeof interest !== "string")) {
      throw new Error("interests must be a list of strings");
    }
    const learner = super.createLearner(name);
    this.db.prepare("INSERT INTO learner_profiles (learner_id, goal, minutes_per_day, interests_json) VALUES (?, ?, ?, ?)")
      .run(learner.id, String(goal).slice(0, 120), minutesPerDay, JSON.stringify(interests.slice(0, 12).map((item) => item.trim().slice(0, 80))));
    return this.getLearner(learner.id);
  }

  getLearner(learnerId) {
    const learner = super.getLearner(learnerId);
    if (!learner) return null;
    const profile = this.db.prepare("SELECT * FROM learner_profiles WHERE learner_id = ?").get(learnerId);
    const enrollments = this.db.prepare("SELECT language FROM language_enrollments WHERE learner_id = ? ORDER BY created_at").all(learnerId);
    const historical = this.db.prepare("SELECT DISTINCT language FROM learner_skills WHERE learner_id = ? ORDER BY language").all(learnerId);
    return {
      ...learner,
      goal: profile?.goal ?? "conversation",
      minutesPerDay: profile?.minutes_per_day ?? 15,
      interests: parseJson(profile?.interests_json, []),
      enrolledLanguages: [...new Set([...enrollments, ...historical].map((entry) =>
        getLanguagePack(entry.language)?.code).filter(Boolean))],
    };
  }

  listLearners() {
    return this.db.prepare("SELECT id FROM learners ORDER BY created_at DESC").all()
      .map((row) => this.getLearner(row.id));
  }

  enrollLanguage(learnerId, code, { targetLevel, variety, role = "" } = {}) {
    const pack = getLanguagePack(code);
    if (!pack) throw new Error("unsupported language");
    if (!this.getLearner(learnerId)) throw new Error("learner not found");
    const createdAt = iso();
    this.transaction(() => {
      this.db.prepare(`
        INSERT INTO language_enrollments (learner_id, language, target_level, variety, role, created_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(learner_id, language) DO NOTHING
      `).run(learnerId, pack.code, targetLevel || pack.targetLevel, variety || pack.region, role, createdAt);
      const insert = this.db.prepare(`
        INSERT OR IGNORE INTO learner_skills
          (learner_id, skill_id, language, mastery, stability_days, next_review_at, weak_modes, emerald_score, copper_score)
        VALUES (?, ?, ?, 0.1, 1, ?, '[]', 0.1, 0.1)
      `);
      for (const skill of skillsForLanguage(pack.code)) insert.run(learnerId, skill.id, pack.code, createdAt);
      this.refreshLearnerState(learnerId, pack.code);
    });
    return this.getSkills(learnerId, pack.code);
  }

  getSkills(learnerId, code) {
    const language = code ? getLanguagePack(code)?.code : null;
    if (code && !language) return [];
    const rows = language
      ? this.db.prepare("SELECT * FROM learner_skills WHERE learner_id = ? AND language = ?").all(learnerId, language)
      : this.db.prepare("SELECT * FROM learner_skills WHERE learner_id = ?").all(learnerId);
    return rows.map((row) => ({
      ...row,
      language: row.language,
      emeraldScore: Number(row.emerald_score),
      copperScore: Number(row.copper_score),
      mastery: usableMastery(Number(row.emerald_score), Number(row.copper_score)),
      stabilityDays: Number(row.stability_days),
      nextReviewAt: row.next_review_at,
      weakModes: parseJson(row.weak_modes, []),
      catalog: getSkill(row.skill_id),
    })).filter((skill) => skill.catalog);
  }

  createSession({ learnerId, language, skillId, reason, activity }) {
    const existing = this.getActiveSession(learnerId, language);
    if (existing) return existing;
    const sessionId = randomUUID();
    const createdAt = iso();
    return this.transaction(() => {
      this.db.prepare(`
        INSERT INTO sessions (id, learner_id, language, skill_id, reason, step, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'comprehension', ?, ?)
      `).run(sessionId, learnerId, language, skillId, reason, createdAt, createdAt);
      const storedActivity = this.insertActivity(sessionId, learnerId, skillId, activity);
      this.db.prepare("UPDATE sessions SET current_activity_id = ? WHERE id = ?").run(storedActivity.id, sessionId);
      return { session: this.getSession(sessionId), activity: this.publicActivity(storedActivity) };
    });
  }

  insertActivity(sessionId, learnerId, skillId, activity) {
    const id = randomUUID();
    const createdAt = iso();
    this.db.prepare(`
      INSERT INTO activities
        (id, learner_id, skill_id, type, prompt, target, created_at, session_id, phase,
         input_text, options_json, correct_index, model_answer, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
    `).run(id, learnerId, skillId, activity.type, activity.prompt, activity.target, createdAt,
      sessionId, activity.phase, activity.inputText ?? null, JSON.stringify(activity.options ?? []),
      activity.correctIndex ?? null, activity.modelAnswer ?? null);
    return this.getSessionActivity(id);
  }

  getSession(sessionId) {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
    if (!row) return null;
    return {
      id: row.id, learnerId: row.learner_id, language: row.language, skillId: row.skill_id,
      reason: row.reason, status: row.status, step: row.step,
      currentActivityId: row.current_activity_id, createdAt: row.created_at,
      updatedAt: row.updated_at, completedAt: row.completed_at,
    };
  }

  getActiveSession(learnerId, language) {
    const row = this.db.prepare("SELECT id FROM sessions WHERE learner_id = ? AND language = ? AND status = 'active'")
      .get(learnerId, language);
    if (!row) return null;
    const session = this.getSession(row.id);
    return { session, activity: this.publicActivity(this.getSessionActivity(session.currentActivityId)) };
  }

  getSessionActivity(activityId) {
    const row = this.db.prepare("SELECT * FROM activities WHERE id = ? AND session_id IS NOT NULL").get(activityId);
    if (!row) return null;
    return {
      id: row.id, learnerId: row.learner_id, sessionId: row.session_id,
      skillId: row.skill_id, type: row.type, phase: row.phase, prompt: row.prompt,
      target: row.target, inputText: row.input_text, options: parseJson(row.options_json, []),
      correctIndex: row.correct_index, modelAnswer: row.model_answer,
      status: row.status, pendingAnswer: row.pending_answer,
      pendingTransferSource: row.pending_transfer_source,
      pendingInterferenceSource: row.pending_interference_source,
      pendingInputMode: row.pending_input_mode,
      createdAt: row.created_at, completedAt: row.completed_at,
    };
  }

  publicActivity(activity) {
    if (!activity) return null;
    const { id, sessionId, skillId, type, phase, prompt, target, inputText, options, status } = activity;
    return { id, sessionId, skillId, type, phase, prompt, target, inputText, options, status,
      ...(status === "pending_rating" ? { modelAnswer: activity.modelAnswer,
        pendingAnswer: activity.pendingAnswer } : {}) };
  }

  reserveActivity(activityId) {
    const result = this.db.prepare("UPDATE activities SET status = 'processing' WHERE id = ? AND status = 'open'").run(activityId);
    return result.changes === 1;
  }

  setPendingRating(activityId, { answer, transferSource, interferenceSource, inputMode }) {
    const result = this.db.prepare(`
      UPDATE activities SET status = 'pending_rating', pending_answer = ?,
        pending_transfer_source = ?, pending_interference_source = ?, pending_input_mode = ?
      WHERE id = ? AND status = 'processing'
    `).run(answer, transferSource ?? null, interferenceSource ?? null, inputMode, activityId);
    if (result.changes !== 1) throw new Error("Activity is no longer available");
  }

  reserveRating(activityId) {
    const result = this.db.prepare("UPDATE activities SET status = 'processing' WHERE id = ? AND status = 'pending_rating'").run(activityId);
    return result.changes === 1;
  }

  releaseActivity(activityId) {
    this.db.prepare("UPDATE activities SET status = 'open' WHERE id = ? AND status = 'processing'").run(activityId);
  }

  completeActivity({ session, activity, event, updatedSkill, weakModes, nextActivity, transferSignal }) {
    return this.transaction(() => {
      const result = this.db.prepare("UPDATE activities SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'processing'")
        .run(event.createdAt, activity.id);
      if (result.changes !== 1) throw new Error("Activity is no longer available");
      this.db.prepare(`
        INSERT INTO learning_events
          (id, learner_id, session_id, activity_id, language, skill_id, concept_id, phase,
           input_text, expected_output, actual_output, error_type, mistakes_json, confidence, correction,
           transfer_source, interference_source, emerald_score, copper_score, usable_mastery,
           next_review_at, score, evidence_source, input_mode, response_time_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(event.id, event.learnerId, event.sessionId, event.activityId, event.language,
        event.skillId, event.conceptId, event.phase, event.input, event.expectedOutput,
        event.actualOutput, event.errorType, JSON.stringify(event.mistakes ?? []), event.confidence, event.correction,
        event.transferSource, event.interferenceSource, event.emeraldScore, event.copperScore,
        event.usableMastery, event.nextReviewAt, event.score, event.evidenceSource,
        event.inputMode, event.responseTimeMs, event.createdAt);
      this.db.prepare(`
        UPDATE learner_skills SET mastery = ?, emerald_score = ?, copper_score = ?,
          stability_days = ?, next_review_at = ?, weak_modes = ?, attempts = attempts + 1
        WHERE learner_id = ? AND skill_id = ?
      `).run(updatedSkill.mastery, updatedSkill.emeraldScore, updatedSkill.copperScore,
        updatedSkill.stabilityDays, updatedSkill.nextReviewAt.toISOString(), JSON.stringify(weakModes),
        event.learnerId, event.skillId);

      if (transferSignal) {
        this.db.prepare(`
          INSERT INTO transfer_signals
            (id, event_id, learner_id, concept_id, source_language, target_language,
             outcome, confidence, relation_type, relation_note, basis, error_type,
             produced_form, expected_form, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(randomUUID(), event.id, event.learnerId, event.conceptId, transferSignal.sourceLanguage,
          event.language, transferSignal.outcome, transferSignal.confidence,
          transferSignal.relationType, transferSignal.relationNote, transferSignal.basis, event.errorType,
          event.actualOutput, event.expectedOutput, event.createdAt);
      }

      let upcoming = null;
      if (nextActivity) {
        upcoming = this.insertActivity(session.id, event.learnerId, event.skillId, nextActivity);
        this.db.prepare("UPDATE sessions SET step = ?, current_activity_id = ?, updated_at = ? WHERE id = ?")
          .run(nextActivity.phase, upcoming.id, event.createdAt, session.id);
      } else {
        this.db.prepare(`
          UPDATE sessions SET status = 'completed', step = 'complete', current_activity_id = NULL,
            updated_at = ?, completed_at = ? WHERE id = ?
        `).run(event.createdAt, event.createdAt, session.id);
      }
      this.refreshLearnerState(event.learnerId, event.language);
      return { session: this.getSession(session.id), nextActivity: this.publicActivity(upcoming) };
    });
  }

  refreshLearnerState(learnerId, language) {
    const skills = this.getSkills(learnerId, language);
    const byKind = (kind) => mean(skills.filter((skill) => skill.catalog.kind === kind).map((skill) => skill.mastery));
    const signals = this.db.prepare(`
      SELECT outcome, COUNT(*) AS count FROM transfer_signals
      WHERE learner_id = ? AND target_language = ? GROUP BY outcome
    `).all(learnerId, language);
    const signalCount = (outcome) => Number(signals.find((signal) => signal.outcome === outcome)?.count ?? 0);
    const completedSessions = Number(this.db.prepare(`
      SELECT COUNT(*) AS count FROM sessions WHERE learner_id = ? AND language = ? AND status = 'completed'
    `).get(learnerId, language).count);
    const dimensions = {
      vocabulary: byKind("vocabulary"), grammar: byKind("grammar"),
      pronunciation: null, listening: null,
      comprehension: mean(skills.map((skill) => skill.emeraldScore)),
      recall: mean(skills.map((skill) => skill.copperScore)),
      transfer: signalCount("helped"), interference: signalCount("interfered"),
      motivation: { completedSessions }, automaticity: null,
      culturalPragmatics: null, spontaneousInitiation: null, creativity: null, realWorldUse: null,
    };
    this.db.prepare(`
      INSERT INTO learner_state (learner_id, language, dimensions_json, updated_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(learner_id, language) DO UPDATE SET
        dimensions_json = excluded.dimensions_json, updated_at = excluded.updated_at
    `).run(learnerId, language, JSON.stringify(dimensions), iso());
    return dimensions;
  }

  getLearnerState(learnerId, language) {
    const row = this.db.prepare("SELECT * FROM learner_state WHERE learner_id = ? AND language = ?")
      .get(learnerId, language);
    return row ? { dimensions: parseJson(row.dimensions_json, {}), updatedAt: row.updated_at } : null;
  }

  dashboard(learnerId, code) {
    const learner = this.getLearner(learnerId);
    if (!learner) return null;
    const language = code ? getLanguagePack(code)?.code : learner.enrolledLanguages[0];
    const skills = language ? this.getSkills(learnerId, language) : [];
    const dueCount = skills.filter((skill) => skill.attempts > 0 && new Date(skill.nextReviewAt).getTime() <= Date.now()).length;
    const eventCount = Number(this.db.prepare("SELECT COUNT(*) AS count FROM learning_events WHERE learner_id = ?").get(learnerId).count);
    const legacyCount = Number(this.db.prepare("SELECT COUNT(*) AS count FROM attempts WHERE learner_id = ?").get(learnerId).count);
    return {
      learner,
      language,
      skills: skills.map((skill) => ({ id: skill.skill_id, label: skill.catalog.label, kind: skill.catalog.kind,
        emeraldScore: skill.emeraldScore, copperScore: skill.copperScore, mastery: skill.mastery,
        nextReviewAt: skill.nextReviewAt, attempts: skill.attempts })),
      dueCount,
      attemptCount: eventCount + legacyCount,
      averageMastery: mean(skills.map((skill) => skill.mastery)) ?? 0,
      emeraldScore: mean(skills.map((skill) => skill.emeraldScore)) ?? 0,
      copperScore: mean(skills.map((skill) => skill.copperScore)) ?? 0,
      learnerState: language ? this.getLearnerState(learnerId, language) : null,
    };
  }

  constellation(learnerId) {
    const learner = this.getLearner(learnerId);
    if (!learner) return null;
    const nodes = learner.enrolledLanguages.map((language) => {
      const dashboard = this.dashboard(learnerId, language);
      return { language, name: getLanguagePack(language).name, emeraldScore: dashboard.emeraldScore,
        copperScore: dashboard.copperScore, mastery: dashboard.averageMastery };
    });
    const rows = this.db.prepare(`
      SELECT source_language, target_language, outcome, COUNT(*) AS count,
        AVG(confidence) AS confidence, GROUP_CONCAT(DISTINCT relation_type) AS relation_types FROM transfer_signals
      WHERE learner_id = ? GROUP BY source_language, target_language, outcome
    `).all(learnerId);
    return { nodes, edges: rows.map((row) => ({ sourceLanguage: row.source_language,
      targetLanguage: row.target_language, outcome: row.outcome, count: Number(row.count),
      confidence: Number(row.confidence), relationTypes: row.relation_types?.split(",") ?? [] })) };
  }

  recentEvents(learnerId, language, limit = 20) {
    return this.db.prepare(`
      SELECT * FROM learning_events WHERE learner_id = ? AND language = ?
      ORDER BY created_at DESC, rowid DESC LIMIT ?
    `).all(learnerId, language, Math.min(100, Math.max(1, limit)));
  }
}
