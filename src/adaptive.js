const DAY_MS = 86_400_000;

export function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function usableMastery(emeraldScore, copperScore) {
  return Math.sqrt(clamp(emeraldScore) * clamp(copperScore));
}

// A rating is evidence about one mode, never proof of another. Self ratings
// receive half the weight of an independently assessed response.
export function updateMastery(skill, { phase, score, source = "assessed" }) {
  if (![0, 1, 2, 3].includes(score)) throw new Error("score must be 0, 1, 2, or 3");
  const dimension = phase === "comprehension" ? "emeraldScore" : "copperScore";
  const weight = source === "self_report" ? 0.5 : 1;
  const rate = (phase === "comprehension" ? 0.28 : 0.34) * weight;
  const oldValue = clamp(Number(skill[dimension] ?? 0.1));
  const next = { emeraldScore: clamp(Number(skill.emeraldScore ?? 0.1)), copperScore: clamp(Number(skill.copperScore ?? 0.1)) };
  next[dimension] = clamp(oldValue * (1 - rate) + (score / 3) * rate);
  next.mastery = usableMastery(next.emeraldScore, next.copperScore);
  return next;
}

export function scheduleAfterEvidence(skill, { phase, score, source = "assessed", now = new Date() }) {
  const mastery = updateMastery(skill, { phase, score, source });
  const priorStability = Math.max(0.25, Number(skill.stabilityDays || 1));
  const multiplier = [0.55, 0.8, 1.4, 1.9][score];
  const stabilityDays = clamp(priorStability * multiplier, 0.25, 180);
  const reviewDays = score === 0 ? 0.25 : score === 1 ? 1 : Math.max(2, stabilityDays * (0.7 + mastery.mastery));
  return {
    ...mastery,
    stabilityDays,
    nextReviewAt: new Date(now.getTime() + reviewDays * DAY_MS),
  };
}

// Existing callers can still use the single-score scheduling helper. New
// sessions use scheduleAfterEvidence so comprehension and production stay apart.
export function scheduleAfterAttempt(skill, score, now = new Date()) {
  return scheduleAfterEvidence(skill, { phase: "production", score, now });
}

export function activityPriority(skill, now = new Date(), goal = "conversation") {
  const nextReviewAt = new Date(skill.nextReviewAt).getTime();
  const due = Number.isFinite(nextReviewAt) && nextReviewAt <= now.getTime();
  const unseen = Number(skill.attempts || 0) === 0;
  const overdueDays = due ? Math.max(0, now.getTime() - nextReviewAt) / DAY_MS : 0;
  const weakest = 1 - usableMastery(skill.emeraldScore ?? 0.1, skill.copperScore ?? 0.1);
  const profile = typeof goal === "string" ? { goal, interests: [] } : goal ?? {};
  const focus = [profile.goal, ...(Array.isArray(profile.interests) ? profile.interests : [])]
    .filter(Boolean).join(" ").toLocaleLowerCase();
  const goalBonus = /conversation|speak|talk|oral|conversa|hablar/.test(focus) &&
    skill.catalog?.kind === "speaking" ? 0.12 : 0;
  const interestBonus = Math.min(0.24, (skill.catalog?.tags ?? [])
    .filter((tag) => focus.includes(tag)).length * 0.12);
  const modeBonus = skill.weakModes?.includes("spontaneous_speaking") ? 0.1 : 0;
  return (due && !unseen ? 4 + Math.min(overdueDays, 14) : unseen ? 2 : 0) +
    weakest + goalBonus + interestBonus + modeBonus;
}

export function chooseNextSkill(skills, now = new Date(), goal = "conversation") {
  if (!skills.length) return null;
  const ranked = skills.map((skill) => ({ skill, priority: activityPriority(skill, now, goal) }))
    .sort((a, b) => b.priority - a.priority || a.skill.skill_id.localeCompare(b.skill.skill_id));
  const chosen = ranked[0];
  const nextReviewAt = new Date(chosen.skill.nextReviewAt).getTime();
  return {
    ...chosen,
    reason: Number(chosen.skill.attempts || 0) === 0 ? "new" : nextReviewAt <= now.getTime() ? "review" : "extra_practice",
  };
}

export function modeToImprove(score, phase, inputMode = "typed") {
  if (score >= 2) return null;
  if (phase === "comprehension") return "comprehension";
  if (inputMode === "speech") return "spontaneous_speaking";
  return "written_production";
}
