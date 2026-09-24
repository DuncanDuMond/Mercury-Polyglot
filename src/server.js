import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { LearningStore } from "./learning-store.js";
import { getLanguagePack, LANGUAGE_PACKS, listLanguages } from "./language-packs.js";
import { TutorAgent } from "./tutor-agent.js";
import { TutorOrchestrator } from "./orchestrator.js";
import { CAPABILITY_CONTRACTS } from "./capabilities.js";

const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir = join(projectDir, "public");
const defaultDatabaseFile = process.env.TUTOR_DB_FILE || join(projectDir, "data", "tutor.db");
const mimeTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 20_000) throw new Error("Request is too large");
  }
  if (!body) return {};
  try { return JSON.parse(body); }
  catch { throw new Error("Request body must be valid JSON"); }
}

async function serveStatic(response, pathname) {
  const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const filePath = resolve(publicDir, relativePath);
  const outside = relative(publicDir, filePath);
  if (outside.startsWith(`..${sep}`) || outside === ".." || outside === "" || outside.includes("\0")) {
    return sendJson(response, 404, { error: "Not found" });
  }
  try {
    const content = await readFile(filePath);
    response.writeHead(200, { "content-type": mimeTypes[extname(filePath)] ?? "application/octet-stream" });
    response.end(content);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

function errorStatus(message) {
  if (/not found/i.test(message)) return 404;
  if (/already|no longer|active session/i.test(message)) return 409;
  return 400;
}

export function createTutorServer({ databaseFile = defaultDatabaseFile, agent = new TutorAgent() } = {}) {
  const store = new LearningStore(databaseFile);
  const tutor = new TutorOrchestrator({ store, agent });
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] !== "api") {
        if (request.method !== "GET") return sendJson(response, 405, { error: "Method not allowed" });
        return serveStatic(response, url.pathname);
      }

      if (request.method === "GET" && url.pathname === "/api/languages") {
        return sendJson(response, 200, Object.fromEntries(
          Object.values(LANGUAGE_PACKS).map((pack) => [pack.code, pack.name]),
        ));
      }
      if (request.method === "GET" && url.pathname === "/api/language-packs") {
        return sendJson(response, 200, listLanguages());
      }
      if (request.method === "GET" && url.pathname === "/api/health") {
        return sendJson(response, 200, { ok: true, assessor: agent.hasModel ? "model" : "self_rating" });
      }
      if (request.method === "GET" && url.pathname === "/api/capabilities") {
        return sendJson(response, 200, CAPABILITY_CONTRACTS);
      }
      if (request.method === "POST" && url.pathname === "/api/learners") {
        const { name, goal, minutesPerDay, interests } = await readJson(request);
        return sendJson(response, 201, store.createLearner(name ?? "", { goal, minutesPerDay, interests }));
      }
      if (request.method === "GET" && url.pathname === "/api/learners") {
        return sendJson(response, 200, { learners: store.listLearners() });
      }

      if (parts[1] !== "learners" || !parts[2]) return sendJson(response, 404, { error: "Not found" });
      const learnerId = parts[2];
      if (!store.getLearner(learnerId)) return sendJson(response, 404, { error: "Learner not found" });

      if (request.method === "GET" && parts[3] === "profile") {
        return sendJson(response, 200, store.getLearner(learnerId));
      }
      if (request.method === "POST" && parts[3] === "languages") {
        const { language, targetLevel, variety, role } = await readJson(request);
        return sendJson(response, 201, { skills: store.enrollLanguage(learnerId, language,
          { targetLevel, variety, role }) });
      }
      if (request.method === "GET" && parts[3] === "dashboard") {
        const language = url.searchParams.get("language") || undefined;
        if (language && !getLanguagePack(language)) return sendJson(response, 400, { error: "Unsupported language" });
        return sendJson(response, 200, store.dashboard(learnerId, language));
      }
      if (request.method === "GET" && parts[3] === "constellation") {
        return sendJson(response, 200, store.constellation(learnerId));
      }
      if (request.method === "GET" && parts[3] === "events") {
        const language = getLanguagePack(url.searchParams.get("language"))?.code;
        if (!language) return sendJson(response, 400, { error: "Choose a supported language" });
        const limit = Number(url.searchParams.get("limit") ?? 20);
        return sendJson(response, 200, { events: store.recentEvents(learnerId, language, limit) });
      }
      if (parts[3] === "session") {
        if (request.method === "POST" && parts[4] === "start") {
          const { language } = await readJson(request);
          return sendJson(response, 201, tutor.start(learnerId, language));
        }
        if (request.method === "GET" && parts[4] === "active") {
          return sendJson(response, 200, tutor.active(learnerId, url.searchParams.get("language")));
        }
        if (request.method === "POST" && parts[4] === "answer") {
          return sendJson(response, 200, await tutor.answer(learnerId, await readJson(request)));
        }
        if (request.method === "POST" && parts[4] === "rate") {
          return sendJson(response, 200, tutor.rate(learnerId, await readJson(request)));
        }
      }
      return sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      return sendJson(response, errorStatus(error.message || ""), { error: error.message || "Unable to process request" });
    }
  });
  server.on("close", () => store.close());
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT ?? 3000);
  const server = createTutorServer();
  server.listen(port, "127.0.0.1", () => console.log(`Mercury Polyglot is running at http://127.0.0.1:${port}`));
}
