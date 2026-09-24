import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { chooseNextSkill, scheduleAfterEvidence, usableMastery } from "../src/adaptive.js";
import { createTutorServer } from "../src/server.js";
import { getSkill, LANGUAGE_PACKS } from "../src/language-packs.js";
import { TutorAgent } from "../src/tutor-agent.js";
import { TutorDatabase } from "../src/database.js";
import { LearningStore } from "../src/learning-store.js";
import { deriveTransferSignal, CAPABILITY_CONTRACTS } from "../src/capabilities.js";

test("comprehension evidence cannot raise production mastery", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const skill = { emeraldScore: 0.1, copperScore: 0.1, stabilityDays: 1 };
  const updated = scheduleAfterEvidence(skill, { phase: "comprehension", score: 3, now });
  assert.ok(updated.emeraldScore > skill.emeraldScore);
  assert.equal(updated.copperScore, skill.copperScore);
  assert.equal(updated.mastery, usableMastery(updated.emeraldScore, 0.1));
  const selfRated = scheduleAfterEvidence(skill, { phase: "production", score: 3, source: "self_report", now });
  const assessed = scheduleAfterEvidence(skill, { phase: "production", score: 3, source: "llm", now });
  assert.ok(selfRated.copperScore < assessed.copperScore);
});

test("due review beats a new item; a new item beats an early review", () => {
  const now = new Date("2026-01-10T00:00:00.000Z");
  const catalog = { kind: "grammar" };
  const newSkill = { skill_id: "new", attempts: 0, emeraldScore: 0.1, copperScore: 0.1,
    nextReviewAt: now.toISOString(), weakModes: [], catalog };
  const due = { skill_id: "due", attempts: 3, emeraldScore: 0.6, copperScore: 0.4,
    nextReviewAt: "2026-01-09T00:00:00.000Z", weakModes: [], catalog };
  const early = { skill_id: "early", attempts: 3, emeraldScore: 0.2, copperScore: 0.2,
    nextReviewAt: "2026-01-20T00:00:00.000Z", weakModes: [], catalog };
  assert.equal(chooseNextSkill([newSkill, due, early], now).skill.skill_id, "due");
  assert.equal(chooseNextSkill([newSkill, early], now).skill.skill_id, "new");
});

test("learner interests help select among equally new skills", () => {
  const now = new Date("2026-01-10T00:00:00.000Z");
  const shared = { attempts: 0, emeraldScore: 0.1, copperScore: 0.1,
    nextReviewAt: now.toISOString(), weakModes: [] };
  const choices = [
    { ...shared, skill_id: "a", catalog: { kind: "grammar", tags: ["stories"] } },
    { ...shared, skill_id: "b", catalog: { kind: "grammar", tags: ["travel"] } },
  ];
  assert.equal(chooseNextSkill(choices, now, { goal: "explore", interests: ["travel"] }).skill.skill_id, "b");
});

test("language relationships annotate observed events without guessing etymology", () => {
  const curated = deriveTransferSignal({ transferSource: "pt-BR", targetLanguage: "es-419",
    conceptId: "speak", score: 3, evidenceSource: "self_report" });
  assert.equal(curated.relationType, "cognate");
  const unlisted = deriveTransferSignal({ interferenceSource: "pt-BR", targetLanguage: "es-419",
    conceptId: "ask-directions", score: 0, evidenceSource: "self_report" });
  assert.equal(unlisted.relationType, "observed");
  assert.equal(unlisted.relationNote, null);
  const exact = deriveTransferSignal({ targetLanguage: "es-419", conceptId: "speak", score: 0,
    evidenceSource: "self_report", actualOutput: "Quiero falar contigo.", enrolledLanguages: ["pt-BR", "es-419"] });
  assert.equal(exact.sourceLanguage, "pt-BR");
  assert.equal(exact.basis, "exact_foreign_form");
  assert.equal(exact.relationType, "cognate");
  assert.equal(deriveTransferSignal({ targetLanguage: "es-419", conceptId: "speak", score: 0,
    evidenceSource: "self_report", actualOutput: "Quiero hablar contigo.",
    enrolledLanguages: ["pt-BR", "es-419"] }), null);
  assert.equal(Object.keys(CAPABILITY_CONTRACTS).length, 9);
});

async function fixture(t) {
  const folder = mkdtempSync(join(tmpdir(), "mercury-polyglot-"));
  const databaseFile = join(folder, "tutor.db");
  let server = createTutorServer({ databaseFile });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const request = async (path, options = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      headers: { "content-type": "application/json" }, ...options,
    });
    return { status: response.status, body: await response.json() };
  };
  const close = async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      server = null;
    }
  };
  const restart = async () => {
    await close();
    server = createTutorServer({ databaseFile });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
  };
  t.after(async () => { await close(); rmSync(folder, { recursive: true, force: true }); });
  return { request, databaseFile, close, restart };
}

const post = (body) => ({ method: "POST", body: JSON.stringify(body) });
const correctChoice = (activity) => String(activity.options.indexOf(
  getSkill(activity.skillId).input.options[getSkill(activity.skillId).input.correctIndex]));

async function createLearner(request, languages) {
  const created = await request("/api/learners", post({
    name: "Alex", goal: "conversation", minutesPerDay: 20, interests: ["travel"],
  }));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  for (const language of languages) {
    const enrolled = await request(`/api/learners/${id}/languages`, post({ language }));
    assert.equal(enrolled.status, 201, JSON.stringify(enrolled.body));
  }
  return id;
}

async function submitAndRate(request, learnerId, session, activity, answer, score, extra = {}) {
  const submitted = await request(`/api/learners/${learnerId}/session/answer`, post({
    sessionId: session.id, activityId: activity.id, answer, ...extra,
  }));
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(submitted.body.status, "needs_self_rating");
  const rated = await request(`/api/learners/${learnerId}/session/rate`, post({
    sessionId: session.id, activityId: activity.id, score,
  }));
  assert.equal(rated.status, 200, JSON.stringify(rated.body));
  return rated.body;
}

test("Portuguese session records comprehension, correction, retry, and unaided reuse", async (t) => {
  const { request } = await fixture(t);
  const learnerId = await createLearner(request, ["pt-BR"]);
  const started = await request(`/api/learners/${learnerId}/session/start`, post({ language: "pt-BR" }));
  assert.equal(started.status, 201, JSON.stringify(started.body));
  const session = started.body.session;
  const comprehension = started.body.activity;
  assert.equal(comprehension.phase, "comprehension");
  assert.equal(comprehension.modelAnswer, undefined);

  const invalid = await request(`/api/learners/${learnerId}/session/answer`, post({
    sessionId: session.id, activityId: comprehension.id, answer: "not an option",
  }));
  assert.equal(invalid.status, 400);
  const understood = await request(`/api/learners/${learnerId}/session/answer`, post({
    sessionId: session.id, activityId: comprehension.id, answer: correctChoice(comprehension),
  }));
  assert.equal(understood.status, 200, JSON.stringify(understood.body));
  assert.equal(understood.body.event.phase, "comprehension");
  assert.ok(understood.body.updatedSkill.emeraldScore > understood.body.updatedSkill.copperScore);

  const production = understood.body.nextActivity;
  assert.equal(production.phase, "production");
  const referenceSkill = getSkill(production.skillId);
  assert.equal(production.prompt, referenceSkill.production.prompt);
  const pending = await request(`/api/learners/${learnerId}/session/answer`, post({
    sessionId: session.id, activityId: production.id, answer: "Eu vou à feira no domingo.",
  }));
  assert.equal(pending.body.status, "needs_self_rating");
  const resumed = await request(`/api/learners/${learnerId}/session/active?language=pt-BR`);
  assert.equal(resumed.body.activity.status, "pending_rating");
  assert.equal(resumed.body.activity.pendingAnswer, "Eu vou à feira no domingo.");
  assert.ok(resumed.body.activity.modelAnswer);
  const ratedProduction = await request(`/api/learners/${learnerId}/session/rate`, post({
    sessionId: session.id, activityId: production.id, score: 1,
  }));
  assert.equal(ratedProduction.body.nextActivity.phase, "retry");
  assert.equal(ratedProduction.body.nextActivity.prompt, `Try again: ${referenceSkill.production.prompt}`);

  const retry = await submitAndRate(request, learnerId, session, ratedProduction.body.nextActivity,
    "Vamos à feira no domingo?", 2);
  assert.equal(retry.nextActivity.phase, "reuse");
  assert.equal(retry.nextActivity.prompt, referenceSkill.reuse.prompt);
  const reused = await submitAndRate(request, learnerId, session, retry.nextActivity,
    "Vamos ao cinema no sábado?", 3);
  assert.equal(reused.session.status, "completed");
  assert.equal(reused.nextActivity, null);
  const dashboard = await request(`/api/learners/${learnerId}/dashboard?language=pt-BR`);
  assert.equal(dashboard.body.attemptCount, 4);
  assert.ok(dashboard.body.emeraldScore > 0.1);
  assert.ok(dashboard.body.copperScore > 0.1);
  assert.equal(dashboard.body.learnerState.dimensions.motivation.completedSessions, 1);
  const events = await request(`/api/learners/${learnerId}/events?language=pt-BR`);
  assert.equal(events.body.events.length, 4);
  assert.equal(events.body.events[0].phase, "reuse");
  assert.equal(events.body.events[0].evidence_source, "self_report");
  assert.ok(events.body.events[0].actual_output);
  assert.ok(events.body.events[0].next_review_at);
});

test("Janus records only reported directional evidence from real attempts", async (t) => {
  const { request } = await fixture(t);
  const learnerId = await createLearner(request, ["pt-BR", "es-419"]);
  const started = await request(`/api/learners/${learnerId}/session/start`, post({ language: "es-419" }));
  const { session } = started.body;
  const first = await request(`/api/learners/${learnerId}/session/answer`, post({
    sessionId: session.id, activityId: started.body.activity.id, answer: correctChoice(started.body.activity),
  }));
  const production = first.body.nextActivity;
  await submitAndRate(request, learnerId, session, production,
    "Eu quero falar contigo.", 0, { interferenceSource: "pt-BR" });
  const constellation = await request(`/api/learners/${learnerId}/constellation`);
  assert.equal(constellation.body.nodes.length, 2);
  assert.deepEqual(constellation.body.edges.map((edge) => [edge.sourceLanguage, edge.targetLanguage, edge.outcome, edge.count]),
    [["pt-BR", "es-419", "interfered", 1]]);
  assert.deepEqual(constellation.body.edges[0].relationTypes, ["observed"]);
});

test("a duplicate answer produces one event", async (t) => {
  const { request } = await fixture(t);
  const learnerId = await createLearner(request, ["pt-BR"]);
  const { body: started } = await request(`/api/learners/${learnerId}/session/start`, post({ language: "pt-BR" }));
  const body = { sessionId: started.session.id, activityId: started.activity.id,
    answer: correctChoice(started.activity) };
  const results = await Promise.all([
    request(`/api/learners/${learnerId}/session/answer`, post(body)),
    request(`/api/learners/${learnerId}/session/answer`, post(body)),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const events = await request(`/api/learners/${learnerId}/events?language=pt-BR`);
  assert.equal(events.body.events.length, 1);
});

test("all seven language packs can enter the shared session flow", async (t) => {
  const { request } = await fixture(t);
  const languages = Object.keys(LANGUAGE_PACKS);
  assert.equal(languages.length, 7);
  const learnerId = await createLearner(request, languages);
  for (const language of languages) {
    const started = await request(`/api/learners/${learnerId}/session/start`, post({ language }));
    assert.equal(started.status, 201, JSON.stringify(started.body));
    assert.equal(started.body.session.language, language);
    assert.equal(started.body.activity.phase, "comprehension");
    assert.equal(started.body.activity.options.length, 3);
  }
  const packs = await request("/api/language-packs");
  assert.equal(packs.status, 200);
  assert.equal(packs.body.length, 7);
  assert.ok(packs.body.every((pack) => pack.sttLocale && pack.ttsLocale));
});

test("malformed model feedback falls back to a reference and self rating", async () => {
  const agent = new TutorAgent({ apiUrl: "http://example.invalid", apiKey: "test", model: "test",
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"score": 3}' } }] }) }) });
  const skill = getSkill("pt-BR-conversation-plans");
  const activity = agent.createActivity({ skill, phase: "production" });
  const result = await agent.evaluateProduction({ learner: { goal: "conversation" }, skill, activity, answer: "test" });
  assert.equal(result.status, "needs_self_rating");
  assert.equal(result.feedback.correctedAnswer, skill.production.modelAnswer);
});

test("valid model feedback supplies a classified correction", async () => {
  const content = JSON.stringify({ score: 2, correctedAnswer: "Vamos ao mercado no domingo?",
    explanation: "The invitation is understandable; add the article.", errorType: "grammar",
    mistakes: [{ category: "article", description: "Use ao before mercado." }],
    retryPrompt: "Invite a different friend.", confidence: 0.85 });
  const agent = new TutorAgent({ apiUrl: "http://example.invalid", apiKey: "test", model: "test",
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) }) });
  const skill = getSkill("pt-BR-conversation-plans");
  const activity = agent.createActivity({ skill, phase: "production" });
  const result = await agent.evaluateProduction({ learner: { goal: "conversation" }, skill,
    activity, answer: "Vamos mercado domingo?" });
  assert.equal(result.status, "rated");
  assert.equal(result.feedback.errorType, "grammar");
  assert.equal(result.feedback.mistakes[0].category, "article");
});

test("an unfinished rating and learner state survive a server restart", async (t) => {
  const { request, restart } = await fixture(t);
  const learnerId = await createLearner(request, ["pt-BR"]);
  const started = await request(`/api/learners/${learnerId}/session/start`, post({ language: "pt-BR" }));
  const understood = await request(`/api/learners/${learnerId}/session/answer`, post({
    sessionId: started.body.session.id, activityId: started.body.activity.id,
    answer: correctChoice(started.body.activity),
  }));
  const production = understood.body.nextActivity;
  const pending = await request(`/api/learners/${learnerId}/session/answer`, post({
    sessionId: started.body.session.id, activityId: production.id, answer: "Vamos no domingo?",
  }));
  assert.equal(pending.body.status, "needs_self_rating");
  await restart();
  const active = await request(`/api/learners/${learnerId}/session/active?language=pt-BR`);
  assert.equal(active.body.activity.pendingAnswer, "Vamos no domingo?");
  const rated = await request(`/api/learners/${learnerId}/session/rate`, post({
    sessionId: started.body.session.id, activityId: production.id, score: 2,
  }));
  assert.equal(rated.body.status, "rated");
  const dashboard = await request(`/api/learners/${learnerId}/dashboard?language=pt-BR`);
  assert.ok(dashboard.body.learnerState.dimensions.comprehension > 0.1);
  assert.ok(dashboard.body.learnerState.dimensions.recall > 0.1);
});

test("legacy learners and skills migrate without losing their rows", () => {
  const folder = mkdtempSync(join(tmpdir(), "mercury-migration-"));
  const databaseFile = join(folder, "legacy.db");
  try {
    const legacy = new TutorDatabase(databaseFile);
    const learner = legacy.createLearner("Legacy learner");
    legacy.db.prepare(`
      INSERT INTO learner_skills
        (learner_id, skill_id, language, mastery, stability_days, next_review_at, weak_modes, attempts)
      VALUES (?, 'fr-passe-compose', 'fr', 0.8, 8, ?, '[]', 4)
    `).run(learner.id, new Date("2026-01-01").toISOString());
    legacy.close();
    const upgraded = new LearningStore(databaseFile);
    assert.equal(upgraded.getSkills(learner.id, "fr-FR").length, 1);
    assert.equal(upgraded.getSkills(learner.id, "fr-FR")[0].attempts, 4);
    assert.equal(upgraded.getSkills(learner.id, "fr-FR")[0].emeraldScore, 0.1);
    upgraded.enrollLanguage(learner.id, "fr-FR");
    assert.equal(upgraded.getSkills(learner.id, "fr-FR").length, 3);
    upgraded.close();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
