import { randomUUID } from "node:crypto";
import { chooseNextSkill, modeToImprove, scheduleAfterEvidence } from "./adaptive.js";
import { getLanguagePack, getSkill } from "./language-packs.js";
import { assessComprehension, deriveTransferSignal } from "./capabilities.js";

function requireSession(store, learnerId, sessionId, activityId, expectedStatus) {
  const session = store.getSession(sessionId);
  const activity = store.getSessionActivity(activityId);
  if (!session || session.learnerId !== learnerId || !activity || activity.sessionId !== sessionId) {
    throw new Error("Active session activity not found");
  }
  if (session.status !== "active" || session.currentActivityId !== activityId) {
    throw new Error("Activity has already been submitted");
  }
  if (activity.status !== expectedStatus) throw new Error("Activity has already been submitted");
  return { session, activity };
}

function normalizeSource(store, learnerId, targetLanguage, code) {
  if (!code) return null;
  const source = getLanguagePack(code)?.code;
  const enrolled = store.getLearner(learnerId)?.enrolledLanguages ?? [];
  if (!source || source === targetLanguage || !enrolled.includes(source)) {
    throw new Error("Transfer source must be another enrolled language");
  }
  return source;
}

function nextPhase(phase, score) {
  if (phase === "comprehension") return "production";
  if (phase === "production") return score < 2 ? "retry" : "reuse";
  if (phase === "retry") return "reuse";
  return null;
}

// One orchestrator invokes bounded capabilities. Mercury records interaction,
// Emerald assesses, Saturn updates memory, Mars chooses retrieval, Venus supplies
// pack-specific usage, Jupiter owns new-domain content, and Janus records only
// directional transfer/interference backed by a real learner event.
export class TutorOrchestrator {
  constructor({ store, agent }) {
    this.store = store;
    this.agent = agent;
  }

  start(learnerId, languageCode) {
    const pack = getLanguagePack(languageCode);
    if (!pack) throw new Error("Choose a supported language");
    const existing = this.store.getActiveSession(learnerId, pack.code);
    if (existing) return existing;
    this.store.enrollLanguage(learnerId, pack.code);
    const skills = this.store.getSkills(learnerId, pack.code);
    const learner = this.store.getLearner(learnerId);
    const selected = chooseNextSkill(skills, new Date(), learner);
    if (!selected) throw new Error("No skills are available for this language");
    const activity = this.agent.createActivity({ skill: selected.skill.catalog,
      phase: "comprehension", attempts: selected.skill.attempts });
    return this.store.createSession({ learnerId, language: pack.code,
      skillId: selected.skill.skill_id, reason: selected.reason, activity });
  }

  active(learnerId, languageCode) {
    const pack = getLanguagePack(languageCode);
    if (!pack) throw new Error("Choose a supported language");
    return this.store.getActiveSession(learnerId, pack.code) ?? { session: null, activity: null };
  }

  async answer(learnerId, { sessionId, activityId, answer, transferSource,
    interferenceSource, inputMode = "typed" }) {
    if (typeof answer !== "string" || !answer.trim() || answer.length > 3000) {
      throw new Error("Answer must contain 1 to 3000 characters");
    }
    if (!["typed", "speech"].includes(inputMode)) throw new Error("inputMode must be typed or speech");
    const { session, activity } = requireSession(this.store, learnerId, sessionId, activityId, "open");
    const normalizedTransfer = normalizeSource(this.store, learnerId, session.language, transferSource);
    const normalizedInterference = normalizeSource(this.store, learnerId, session.language, interferenceSource);
    if (normalizedTransfer && normalizedInterference) throw new Error("Choose one cross-language signal");
    if (!this.store.reserveActivity(activityId)) throw new Error("Activity has already been submitted");
    try {
      let feedback;
      if (activity.phase === "comprehension") {
        const skill = getSkill(activity.skillId);
        feedback = assessComprehension({ activity, answer, explanation: skill.input.explanation });
      } else {
        const assessed = await this.agent.evaluateProduction({
          learner: this.store.getLearner(learnerId), skill: getSkill(activity.skillId), activity, answer: answer.trim(),
        });
        if (assessed.status === "needs_self_rating") {
          this.store.setPendingRating(activityId, {
            answer: answer.trim(), transferSource: normalizedTransfer,
            interferenceSource: normalizedInterference, inputMode,
          });
          return { status: "needs_self_rating", feedback: assessed.feedback,
            session: this.store.getSession(session.id) };
        }
        feedback = assessed.feedback;
      }
      return this.finish({ session, activity, answer: answer.trim(), feedback,
        transferSource: normalizedTransfer, interferenceSource: normalizedInterference, inputMode });
    } catch (error) {
      this.store.releaseActivity(activityId);
      throw error;
    }
  }

  rate(learnerId, { sessionId, activityId, score }) {
    if (!Number.isInteger(score) || score < 0 || score > 3) throw new Error("Rating must be 0, 1, 2, or 3");
    const { session, activity } = requireSession(this.store, learnerId, sessionId, activityId, "pending_rating");
    if (!this.store.reserveRating(activityId)) throw new Error("Activity has already been rated");
    const feedback = {
      score,
      correctedAnswer: activity.modelAnswer,
      explanation: score >= 2
        ? "Recorded as a self-rated successful response. The next task checks transfer to a new situation."
        : "Recorded as a gap. Try again, then use it once more without a hint.",
      errorType: score >= 2 ? "none" : "self_reported_gap",
      mistakes: score >= 2 ? [] : [{ category: "self_reported_gap", description: "The learner reported needing help." }],
      retryPrompt: score >= 2 ? "Continue to a new situation." : "Try the same idea once more.",
      confidence: 0.5,
      source: "self_report",
    };
    try {
      return this.finish({ session, activity, answer: activity.pendingAnswer, feedback,
        transferSource: activity.pendingTransferSource,
        interferenceSource: activity.pendingInterferenceSource,
        inputMode: activity.pendingInputMode || "typed" });
    } catch (error) {
      this.store.db.prepare("UPDATE activities SET status = 'pending_rating' WHERE id = ? AND status = 'processing'").run(activityId);
      throw error;
    }
  }

  finish({ session, activity, answer, feedback, transferSource, interferenceSource, inputMode }) {
    const skill = getSkill(activity.skillId);
    const current = this.store.getSkills(session.learnerId, session.language)
      .find((item) => item.skill_id === activity.skillId);
    const updatedSkill = scheduleAfterEvidence(current, {
      phase: activity.phase, score: feedback.score, source: feedback.source,
    });
    const weakMode = modeToImprove(feedback.score, activity.phase, inputMode);
    const weakModes = weakMode
      ? [...new Set([...current.weakModes, weakMode])]
      : current.weakModes.filter((mode) => mode !== (activity.phase === "comprehension" ? "comprehension" :
        inputMode === "speech" ? "spontaneous_speaking" : "written_production"));
    const next = nextPhase(activity.phase, feedback.score);
    const nextActivity = next ? this.agent.createActivity({ skill, phase: next,
      attempts: session.reason === "new" ? 0 : 1 }) : null;
    const createdAt = new Date().toISOString();
    const transferSignal = deriveTransferSignal({ transferSource, interferenceSource,
      targetLanguage: session.language, conceptId: skill.conceptId,
      score: feedback.score, evidenceSource: feedback.source, actualOutput: answer,
      enrolledLanguages: this.store.getLearner(session.learnerId).enrolledLanguages });
    const event = {
      id: randomUUID(), learnerId: session.learnerId, sessionId: session.id, activityId: activity.id,
      language: session.language, skillId: skill.id, conceptId: skill.conceptId, phase: activity.phase,
      input: activity.inputText || activity.prompt,
      expectedOutput: activity.modelAnswer,
      actualOutput: answer,
      errorType: feedback.errorType ?? "other",
      mistakes: feedback.mistakes ?? [], confidence: feedback.confidence ?? 0.5,
      correction: feedback.correctedAnswer ?? activity.modelAnswer,
      transferSource: transferSource || (transferSignal?.outcome === "helped" ? transferSignal.sourceLanguage : null),
      interferenceSource: interferenceSource || (transferSignal?.outcome === "interfered" ? transferSignal.sourceLanguage : null),
      emeraldScore: updatedSkill.emeraldScore, copperScore: updatedSkill.copperScore,
      usableMastery: updatedSkill.mastery, nextReviewAt: updatedSkill.nextReviewAt.toISOString(),
      score: feedback.score, evidenceSource: feedback.source, inputMode,
      responseTimeMs: Math.max(0, Date.now() - new Date(activity.createdAt).getTime()), createdAt,
    };
    const transition = this.store.completeActivity({ session, activity, event,
      updatedSkill, weakModes, nextActivity, transferSignal });
    return {
      status: "rated", feedback, event,
      updatedSkill: { id: skill.id, emeraldScore: updatedSkill.emeraldScore,
        copperScore: updatedSkill.copperScore, usableMastery: updatedSkill.mastery,
        nextReviewAt: updatedSkill.nextReviewAt.toISOString() },
      ...transition,
    };
  }
}
