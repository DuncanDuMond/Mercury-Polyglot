const PROFILE_KEY = "mercury-polyglot-profile-v1";
const state = {
  learner: null,
  language: null,
  languages: {},
  languagePacks: {},
  dashboard: null,
  session: null,
  activity: null,
  pendingNext: null,
  busy: false,
  recognition: null,
  speechTranscript: null,
  lastSubmittedAnswer: null,
};

const $ = (id) => document.getElementById(id);
const show = (id, visible) => $(id).classList.toggle("hidden", !visible);

function make(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined && content !== null) element.textContent = String(content);
  return element;
}

function setMessage(message = "") {
  $("global-message").textContent = message;
  show("global-message", Boolean(message));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) },
  });
  let data;
  try { data = await response.json(); }
  catch { throw new Error("The tutor returned an unreadable response. Please try again."); }
  if (!response.ok) {
    const error = new Error(data.error || "The tutor could not complete that request.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function urlForLearner(suffix) {
  return `/api/learners/${encodeURIComponent(state.learner.id)}${suffix}`;
}

function languageName(code) {
  return state.languages[code] || code || "Unknown language";
}

function percent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(Math.max(0, Math.min(100, number <= 1 ? number * 100 : number)));
}

function saveProfile() {
  localStorage.setItem(PROFILE_KEY, JSON.stringify({ learner: state.learner, language: state.language }));
}

function restoreProfile() {
  try {
    const stored = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
    if (stored?.learner?.id && stored?.language) {
      state.learner = stored.learner;
      state.language = stored.language;
      return true;
    }
  } catch { /* Corrupt browser storage should not prevent onboarding. */ }
  return false;
}

function fillLanguageSelect(select, selected) {
  select.replaceChildren();
  for (const [code, name] of Object.entries(state.languages)) {
    const option = make("option", "", name);
    option.value = code;
    select.append(option);
  }
  if (selected && state.languages[selected]) select.value = selected;
}

function setBusy(busy) {
  state.busy = busy;
  for (const id of ["create-profile", "continue-learner", "session-action", "submit-answer", "continue-activity", "start-another", "active-language"]) {
    $(id).disabled = busy;
  }
  for (const button of $("self-rating").querySelectorAll("button")) button.disabled = busy;
}

function showOnboarding() {
  show("onboarding", true);
  show("tutor", false);
  $("name").focus();
}

function showTutor() {
  show("onboarding", false);
  show("tutor", true);
  $("learner-label").textContent = state.learner.name ? `${state.learner.name}'s practice` : "Your practice";
  fillLanguageSelect($("active-language"), state.language);
}

async function enrollLanguage(language) {
  return api(urlForLearner("/languages"), {
    method: "POST",
    body: JSON.stringify({ language }),
  });
}

async function refreshExistingLearners() {
  const data = await api("/api/learners");
  const learners = Array.isArray(data.learners) ? data.learners : [];
  const select = $("existing-learner");
  select.replaceChildren();
  for (const learner of learners) {
    const option = make("option", "", learner.name);
    option.value = learner.id;
    option.learner = learner;
    select.append(option);
  }
  show("existing-profiles", learners.length > 0);
}

async function continueExistingLearner() {
  if (state.busy) return;
  const selected = $("existing-learner").selectedOptions[0];
  if (!selected?.learner) return;
  setMessage();
  setBusy(true);
  try {
    state.learner = selected.learner;
    state.language = state.learner.enrolledLanguages?.[0] || $("language").value;
    if (!state.learner.enrolledLanguages?.length) await enrollLanguage(state.language);
    saveProfile();
    showTutor();
    await refreshDashboard();
    await Promise.all([refreshConstellation(), loadActiveSession()]);
  } catch (error) { setMessage(error.message); }
  finally { setBusy(false); }
}

async function refreshDashboard() {
  const dashboard = await api(urlForLearner(`/dashboard?language=${encodeURIComponent(state.language)}`));
  state.dashboard = dashboard;
  if (dashboard.learner) {
    state.learner = dashboard.learner;
    saveProfile();
  }
  $("due-count").textContent = String(dashboard.dueCount ?? 0);
  $("attempt-count").textContent = String(dashboard.attemptCount ?? 0);
  const emerald = percent(dashboard.emeraldScore);
  const copper = percent(dashboard.copperScore);
  $("emerald-value").textContent = `${emerald}%`;
  $("copper-value").textContent = `${copper}%`;
  $("emerald-meter").value = emerald;
  $("copper-meter").value = copper;
  const due = Number(dashboard.dueCount || 0);
  $("today-summary").textContent = due > 0
    ? `${due} review${due === 1 ? " is" : "s are"} ready. We’ll weave them into a focused round of practice.`
    : "One focused activity at a time. We’ll bring back what needs practice.";
  renderSourceLanguages();
}

function renderSourceLanguages() {
  const source = $("source-language");
  source.replaceChildren();
  const prompt = make("option", "", "Choose a language");
  prompt.value = "";
  source.append(prompt);
  const enrolled = state.dashboard?.learner?.enrolledLanguages || [];
  for (const code of enrolled) {
    if (code === state.language || !state.languages[code]) continue;
    const option = make("option", "", languageName(code));
    option.value = code;
    source.append(option);
  }
  const hasSource = source.options.length > 1;
  const production = state.activity && state.activity.phase !== "comprehension";
  show("language-relation", Boolean(production && hasSource));
  $("relation-type").value = "none";
  source.disabled = true;
  if (!hasSource) $("relation-note").textContent = "Add another language to track helpful or interfering connections.";
  else $("relation-note").textContent = "Your observation helps track connections between languages.";
}

async function refreshConstellation() {
  const data = await api(urlForLearner("/constellation"));
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const edges = Array.isArray(data.edges) ? data.edges : [];
  const nodeArea = $("constellation-nodes");
  const edgeArea = $("constellation-edges");
  nodeArea.replaceChildren();
  edgeArea.replaceChildren();

  for (const node of nodes) {
    const card = make("div", `language-node${node.language === state.language ? " current" : ""}`);
    card.append(make("span", "node-spark", "✦"));
    const text = make("div");
    text.append(make("strong", "", node.name || languageName(node.language)));
    text.append(make("span", "", `${percent(node.emeraldScore)}% understanding · ${percent(node.copperScore)}% expression`));
    card.append(text);
    nodeArea.append(card);
  }
  if (!nodes.length) nodeArea.append(make("p", "muted", "Your languages will appear here as you begin practicing."));

  const observedEdges = edges.filter((edge) => Number(edge.count) > 0 &&
    (edge.outcome === "helped" || edge.outcome === "interfered"));
  if (!observedEdges.length) {
    edgeArea.append(make("p", "constellation-empty", "No connections observed yet. Practice in more than one language and note when one helps or interferes."));
    return;
  }
  edgeArea.append(make("h3", "", "Connections you’ve noticed"));
  const list = make("ul", "edge-list");
  for (const edge of observedEdges) {
    const item = make("li", `edge-row ${edge.outcome}`);
    const description = make("span", "edge-description");
    description.append(make("strong", "", languageName(edge.sourceLanguage)));
    description.append(document.createTextNode(edge.outcome === "helped" ? " helped with " : " interfered with "));
    description.append(make("strong", "", languageName(edge.targetLanguage)));
    item.append(description);
    item.append(make("span", "edge-count", `${edge.count} observation${edge.count === 1 ? "" : "s"}`));
    list.append(item);
  }
  edgeArea.append(list);
}

function setJourney(stage) {
  for (const item of $("journey-steps").children) {
    const active = item.dataset.stage === stage;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
  }
}

function activityStage(phase) {
  if (phase === "comprehension") return "understand";
  if (phase === "retry") return "retry";
  if (phase === "reuse") return "reuse";
  return "speak";
}

function activityLabel(phase) {
  return ({ comprehension: "Understand", production: "Respond", retry: "Try again", reuse: "Use it again" })[phase] || "Practice";
}

function skillLabel(activity) {
  const skill = (state.dashboard?.skills || []).find((item) =>
    item.id === activity.skillId || item.skillId === activity.skillId);
  return skill?.label || activity.skillLabel || "A useful language skill";
}

function renderOptions(options) {
  const container = $("answer-options");
  container.replaceChildren();
  const hasOptions = Array.isArray(options) && options.length > 0;
  show("options-field", hasOptions);
  show("written-answer", !hasOptions);
  for (const [index, option] of (hasOptions ? options : []).entries()) {
    const label = make("label", "option-row");
    const radio = make("input");
    radio.type = "radio";
    radio.name = "answer-option";
    radio.value = String(index);
    radio.required = true;
    const text = typeof option === "string" ? option : option?.text || option?.label || String(option?.value ?? index);
    label.append(radio, make("span", "", text));
    container.append(label);
  }
}

function stopSpeech() {
  if (state.recognition) {
    state.recognition.abort();
    state.recognition = null;
  }
  $("dictate-button").textContent = "Dictate answer";
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

function renderActivity(activity) {
  stopSpeech();
  state.activity = activity;
  state.pendingNext = null;
  state.speechTranscript = null;
  state.lastSubmittedAnswer = null;
  show("session-empty", false);
  show("session-complete", false);
  show("activity-content", true);
  show("feedback", false);
  show("self-rating", false);
  show("continue-activity", false);
  show("answer-form", true);
  $("feedback").replaceChildren();
  $("answer").value = "";
  $("phase-label").textContent = activityLabel(activity.phase);
  $("activity-type").textContent = String(activity.type || "activity").replaceAll("_", " ");
  $("skill-label").textContent = skillLabel(activity);
  const context = typeof activity.context === "string" ? activity.context : activity.context?.scene || "";
  $("activity-context").textContent = context;
  show("activity-context", Boolean(context));
  $("activity-prompt").textContent = activity.prompt || "Respond in the language you are learning.";
  const inputText = activity.inputText || "";
  $("input-text").textContent = inputText;
  show("input-card", Boolean(inputText));
  show("listen-button", Boolean(inputText && "speechSynthesis" in window));
  renderOptions(activity.options);
  show("dictate-button", Boolean(!activity.options?.length && (window.SpeechRecognition || window.webkitSpeechRecognition)));
  $("modality-note").textContent = window.SpeechRecognition || window.webkitSpeechRecognition
    ? "Written and dictated answers show language production. Pronunciation is not scored here."
    : "Written answers show language production. Pronunciation is not scored here.";
  renderSourceLanguages();
  setJourney(activityStage(activity.phase));
  $("session-action").textContent = "Continue this activity →";
}

function showEmptySession(completed = false) {
  state.activity = null;
  state.pendingNext = null;
  stopSpeech();
  show("session-empty", !completed);
  show("session-complete", completed);
  show("activity-content", false);
  setJourney(completed ? "remember" : "");
  $("session-action").textContent = completed ? "Continue today's session →" : "Begin today's session →";
}

async function loadActiveSession() {
  const data = await api(urlForLearner(`/session/active?language=${encodeURIComponent(state.language)}`));
  state.session = data.session || null;
  if (data.activity) {
    renderActivity(data.activity);
    if (data.activity.status === "pending_rating") {
      renderFeedback({ status: "needs_self_rating", feedback: {
        explanation: "Your answer was saved. Compare it with the example, then rate how independently you produced it.",
        correctedAnswer: data.activity.modelAnswer,
      } }, data.activity.pendingAnswer);
    }
  }
  else showEmptySession(false);
}

async function startSession() {
  if (state.busy) return;
  setMessage();
  setBusy(true);
  try {
    if (state.activity) {
      $("activity-content").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const data = await api(urlForLearner("/session/start"), {
      method: "POST", body: JSON.stringify({ language: state.language }),
    });
    state.session = data.session;
    if (data.activity) renderActivity(data.activity);
    else showEmptySession(true);
    $("activity-content").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) { setMessage(error.message); }
  finally { setBusy(false); }
}

function answerValue() {
  if (Array.isArray(state.activity?.options) && state.activity.options.length) {
    return $("answer-options").querySelector('input[name="answer-option"]:checked')?.value || "";
  }
  return $("answer").value.trim();
}

function relationPayload() {
  if ($("language-relation").classList.contains("hidden")) return {};
  const relation = $("relation-type").value;
  const source = $("source-language").value;
  if (relation === "none") return {};
  if (!source || source === state.language) throw new Error("Choose the other language, or select ‘No other language’.");
  return relation === "helped" ? { transferSource: source } : { interferenceSource: source };
}

function addFeedbackLine(container, label, value) {
  if (!value) return;
  const paragraph = make("p");
  if (label) paragraph.append(make("strong", "", `${label} `));
  paragraph.append(document.createTextNode(String(value)));
  container.append(paragraph);
}

function renderFeedback(result, submittedAnswer) {
  const feedback = result.feedback || {};
  const box = $("feedback");
  box.replaceChildren();
  const score = feedback.score ?? result.event?.score;
  const actualAnswer = submittedAnswer ?? state.activity?.pendingAnswer ?? state.lastSubmittedAnswer;
  const visibleAnswer = state.activity?.phase === "comprehension"
    ? state.activity.options?.[Number(actualAnswer)] ?? actualAnswer
    : actualAnswer;
  if (result.status === "needs_self_rating") {
    box.append(make("h3", "", "Compare your answer"));
    setJourney("correct");
  } else {
    box.append(make("h3", "", result.session?.status === "completed" ? "Session complete" : "Answer saved. Continue."));
    if (Number.isInteger(score)) addFeedbackLine(box, "Evidence score:", `${score}/3`);
    setJourney(result.session?.status === "completed" ? "remember" : "correct");
  }
  addFeedbackLine(box, "Your answer:", visibleAnswer);
  addFeedbackLine(box, "Feedback:", feedback.explanation);
  addFeedbackLine(box, "Natural example:", feedback.correctedAnswer || feedback.modelAnswer || state.activity?.modelAnswer);
  addFeedbackLine(box, "Try next:", feedback.retryPrompt);
  if (!box.querySelector("p")) box.append(make("p", "", "Your response has been reviewed."));
  show("feedback", true);
  show("answer-form", false);
  show("self-rating", result.status === "needs_self_rating");
  show("continue-activity", result.status === "rated");
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function updateAfterRating() {
  const updates = await Promise.allSettled([refreshDashboard(), refreshConstellation()]);
  for (const update of updates) {
    if (update.status === "rejected") setMessage(update.reason.message || "Progress could not be refreshed.");
  }
}

async function submitAnswer(event) {
  event.preventDefault();
  if (state.busy || !state.activity || !state.session) return;
  setMessage();
  const answer = answerValue();
  if (!answer) {
    setMessage("Choose or write an answer before continuing.");
    return;
  }
  let relation;
  try { relation = relationPayload(); }
  catch (error) { setMessage(error.message); return; }
  setBusy(true);
  try {
    const result = await api(urlForLearner("/session/answer"), {
      method: "POST",
      body: JSON.stringify({
        sessionId: state.session.id,
        activityId: state.activity.id,
        answer,
        inputMode: state.speechTranscript && answer === state.speechTranscript ? "speech" : "typed",
        ...relation,
      }),
    });
    state.session = result.session || state.session;
    state.pendingNext = result.nextActivity || null;
    state.lastSubmittedAnswer = answer;
    renderFeedback(result, answer);
    if (result.status === "rated") await updateAfterRating();
  } catch (error) { setMessage(error.message); }
  finally { setBusy(false); }
}

async function rateAnswer(score) {
  if (state.busy || !state.activity || !state.session) return;
  setMessage();
  setBusy(true);
  try {
    const result = await api(urlForLearner("/session/rate"), {
      method: "POST",
      body: JSON.stringify({ sessionId: state.session.id, activityId: state.activity.id, score }),
    });
    state.session = result.session || state.session;
    state.pendingNext = result.nextActivity || null;
    renderFeedback(result);
    await updateAfterRating();
  } catch (error) { setMessage(error.message); }
  finally { setBusy(false); }
}

function continueActivity() {
  if (state.pendingNext) renderActivity(state.pendingNext);
  else showEmptySession(true);
}

async function switchLanguage(event) {
  const nextLanguage = event.target.value;
  if (!nextLanguage || nextLanguage === state.language || state.busy) return;
  const previousLanguage = state.language;
  setMessage();
  setBusy(true);
  try {
    await enrollLanguage(nextLanguage);
    state.language = nextLanguage;
    saveProfile();
    showEmptySession(false);
    await refreshDashboard();
    await Promise.all([refreshConstellation(), loadActiveSession()]);
  } catch (error) {
    state.language = previousLanguage;
    event.target.value = previousLanguage;
    setMessage(error.message);
  } finally { setBusy(false); }
}

function dictate() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return;
  if (state.recognition) { state.recognition.stop(); return; }
  setMessage();
  const recognition = new Recognition();
  recognition.lang = state.languagePacks[state.language]?.sttLocale || state.language;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript?.trim();
    if (transcript) {
      const existing = $("answer").value.trim();
      $("answer").value = [existing, transcript].filter(Boolean).join(" ");
      state.speechTranscript = existing ? null : transcript;
    }
    $("answer").focus();
  };
  recognition.onerror = () => setMessage("Dictation was unavailable. You can type your answer instead.");
  recognition.onend = () => {
    state.recognition = null;
    $("dictate-button").textContent = "Dictate answer";
  };
  state.recognition = recognition;
  $("dictate-button").textContent = "Stop dictation";
  try { recognition.start(); }
  catch { recognition.onend(); setMessage("Dictation was unavailable. You can type your answer instead."); }
}

function speakInput() {
  if (!("speechSynthesis" in window) || !state.activity?.inputText) return;
  const utterance = new SpeechSynthesisUtterance(state.activity.inputText);
  const locale = state.languagePacks[state.language]?.ttsLocale || state.language;
  utterance.lang = locale;
  utterance.rate = 0.88;
  const voice = window.speechSynthesis.getVoices().find((candidate) =>
    candidate.lang.toLowerCase() === locale.toLowerCase());
  if (voice) utterance.voice = voice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

async function createProfile(event) {
  event.preventDefault();
  if (state.busy) return;
  setMessage();
  setBusy(true);
  try {
    const interests = $("interests").value.split(",").map((interest) => interest.trim()).filter(Boolean);
    state.learner = await api("/api/learners", {
      method: "POST",
      body: JSON.stringify({
        name: $("name").value.trim(),
        goal: $("goal").value.trim() || "Everyday conversation",
        minutesPerDay: Number($("minutes-per-day").value),
        interests,
      }),
    });
    state.language = $("language").value;
    await enrollLanguage(state.language);
    saveProfile();
    showTutor();
    await refreshDashboard();
    await Promise.all([refreshConstellation(), loadActiveSession()]);
  } catch (error) {
    setMessage(error.message);
    if (state.learner?.id) saveProfile();
  } finally { setBusy(false); }
}

async function initialize() {
  try {
    state.languages = await api("/api/languages");
    const packs = await api("/api/language-packs");
    state.languagePacks = Object.fromEntries(packs.map((pack) => [pack.code, pack]));
    fillLanguageSelect($("language"));
    await refreshExistingLearners();
    if (!restoreProfile()) { showOnboarding(); return; }
    if (!state.languages[state.language]) state.language = Object.keys(state.languages)[0];
    showTutor();
    await refreshDashboard();
    await Promise.all([refreshConstellation(), loadActiveSession()]);
  } catch (error) {
    if (error.status === 404 && state.learner) {
      localStorage.removeItem(PROFILE_KEY);
      state.learner = null;
      state.language = null;
      showOnboarding();
      setMessage("That saved learner profile is no longer available. Please start a new one.");
    } else {
      setMessage(error.message);
      if (!state.learner) showOnboarding();
    }
  }
}

$("profile-form").addEventListener("submit", createProfile);
$("continue-learner").addEventListener("click", continueExistingLearner);
$("active-language").addEventListener("change", switchLanguage);
$("session-action").addEventListener("click", startSession);
$("start-another").addEventListener("click", startSession);
$("answer-form").addEventListener("submit", submitAnswer);
$("continue-activity").addEventListener("click", continueActivity);
$("dictate-button").addEventListener("click", dictate);
$("answer").addEventListener("input", () => {
  if ($("answer").value.trim() !== state.speechTranscript) state.speechTranscript = null;
});
$("listen-button").addEventListener("click", speakInput);
$("relation-type").addEventListener("change", () => {
  const related = $("relation-type").value !== "none";
  $("source-language").disabled = !related;
  $("source-language").required = related;
  if (!related) $("source-language").value = "";
});
$("self-rating").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-score]");
  if (button) rateAnswer(Number(button.dataset.score));
});
$("new-learner").addEventListener("click", () => {
  stopSpeech();
  localStorage.removeItem(PROFILE_KEY);
  state.learner = null;
  state.language = null;
  state.dashboard = null;
  state.session = null;
  state.activity = null;
  setMessage();
  showOnboarding();
  refreshExistingLearners().catch((error) => setMessage(error.message));
});

initialize();
