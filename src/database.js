import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { skillsForLanguage, findSkill } from "./catalog.js";

function nowIso() {
  return new Date().toISOString();
}

function parseSkill(row) {
  return {
    ...row,
    mastery: Number(row.mastery),
    stabilityDays: Number(row.stability_days),
    nextReviewAt: row.next_review_at,
    weakModes: JSON.parse(row.weak_modes),
  };
}

export class TutorDatabase {
  constructor(filename) {
    mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS learners (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS learner_skills (
        learner_id TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        language TEXT NOT NULL,
        mastery REAL NOT NULL,
        stability_days REAL NOT NULL,
        next_review_at TEXT NOT NULL,
        weak_modes TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (learner_id, skill_id),
        FOREIGN KEY (learner_id) REFERENCES learners(id)
      );
      CREATE INDEX IF NOT EXISTS learner_skills_next_review
        ON learner_skills(learner_id, language, next_review_at);
      CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY,
        learner_id TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        type TEXT NOT NULL,
        prompt TEXT NOT NULL,
        target TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY,
        learner_id TEXT NOT NULL,
        activity_id TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        answer TEXT NOT NULL,
        score INTEGER NOT NULL,
        mistakes TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  createLearner(name) {
    const learner = { id: randomUUID(), name: name.trim(), createdAt: nowIso() };
    if (!learner.name) throw new Error("name is required");
    this.db.prepare("INSERT INTO learners (id, name, created_at) VALUES (?, ?, ?)")
      .run(learner.id, learner.name, learner.createdAt);
    return learner;
  }

  getLearner(learnerId) {
    const row = this.db.prepare("SELECT id, name, created_at FROM learners WHERE id = ?").get(learnerId);
    return row ? { id: row.id, name: row.name, createdAt: row.created_at } : null;
  }

  enrollLanguage(learnerId, language) {
    const learner = this.getLearner(learnerId);
    if (!learner) throw new Error("learner not found");
    const starterSkills = skillsForLanguage(language);
    if (!starterSkills.length) throw new Error("unsupported language");
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO learner_skills
        (learner_id, skill_id, language, mastery, stability_days, next_review_at, weak_modes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const dueNow = nowIso();
    for (const skill of starterSkills) {
      insert.run(learnerId, skill.id, language, 0.15, 1, dueNow, JSON.stringify(["guided_production"]));
    }
    return this.getSkills(learnerId, language);
  }

  getSkills(learnerId, language) {
    const query = language
      ? this.db.prepare("SELECT * FROM learner_skills WHERE learner_id = ? AND language = ?")
      : this.db.prepare("SELECT * FROM learner_skills WHERE learner_id = ?");
    const rows = language ? query.all(learnerId, language) : query.all(learnerId);
    return rows.map((row) => ({ ...parseSkill(row), catalog: findSkill(row.skill_id) })).filter((skill) => skill.catalog);
  }

  createActivity({ learnerId, skillId, type, prompt, target }) {
    const activity = {
      id: randomUUID(), learnerId, skillId, type, prompt, target, createdAt: nowIso(), completedAt: null,
    };
    this.db.prepare(`
      INSERT INTO activities (id, learner_id, skill_id, type, prompt, target, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(activity.id, activity.learnerId, activity.skillId, activity.type, activity.prompt, activity.target, activity.createdAt);
    return activity;
  }

  getActivity(activityId) {
    const row = this.db.prepare("SELECT * FROM activities WHERE id = ?").get(activityId);
    if (!row) return null;
    return {
      id: row.id, learnerId: row.learner_id, skillId: row.skill_id, type: row.type,
      prompt: row.prompt, target: row.target, createdAt: row.created_at, completedAt: row.completed_at,
    };
  }

  saveAttempt({ learnerId, activityId, skillId, answer, score, mistakes, updatedSkill }) {
    const createdAt = nowIso();
    this.db.prepare(`
      INSERT INTO attempts (id, learner_id, activity_id, skill_id, answer, score, mistakes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), learnerId, activityId, skillId, answer, score, JSON.stringify(mistakes), createdAt);
    this.db.prepare(`
      UPDATE learner_skills
      SET mastery = ?, stability_days = ?, next_review_at = ?, weak_modes = ?, attempts = attempts + 1
      WHERE learner_id = ? AND skill_id = ?
    `).run(
      updatedSkill.mastery,
      updatedSkill.stabilityDays,
      updatedSkill.nextReviewAt.toISOString(),
      JSON.stringify(updatedSkill.weakModes),
      learnerId,
      skillId,
    );
    this.db.prepare("UPDATE activities SET completed_at = ? WHERE id = ?").run(createdAt, activityId);
  }

  dashboard(learnerId, language) {
    const learner = this.getLearner(learnerId);
    if (!learner) return null;
    const skills = this.getSkills(learnerId, language);
    const now = Date.now();
    const due = skills.filter((skill) => new Date(skill.nextReviewAt).getTime() <= now);
    const attempts = this.db.prepare("SELECT COUNT(*) AS count FROM attempts WHERE learner_id = ?")
      .get(learnerId).count;
    const averageMastery = skills.length
      ? skills.reduce((total, skill) => total + skill.mastery, 0) / skills.length
      : 0;
    return { learner, skills, dueCount: due.length, attemptCount: Number(attempts), averageMastery };
  }

  close() {
    this.db.close();
  }
}
