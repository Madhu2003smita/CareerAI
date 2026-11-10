const express = require("express");
const cors = require("cors");
const multer = require("multer");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});
const pythonServiceUrl = process.env.PYTHON_SERVICE_URL || "http://127.0.0.1:8000";

app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// SQLite setup
// ---------------------------------------------------------------------------

const db = new Database(path.join(__dirname, "career_ai.db"));
db.pragma("journal_mode = WAL");

// Migrate existing DB: add new columns if they don't exist yet
const existingCols = db.pragma("table_info(resume_customizations)").map((c) => c.name);
if (!existingCols.includes("certifications")) {
  try { db.exec(`ALTER TABLE resume_customizations ADD COLUMN certifications TEXT NOT NULL DEFAULT '[]'`); } catch {}
}
if (!existingCols.includes("projects")) {
  try { db.exec(`ALTER TABLE resume_customizations ADD COLUMN projects TEXT NOT NULL DEFAULT '[]'`); } catch {}
}
if (!existingCols.includes("raw_resume_text")) {
  try { db.exec(`ALTER TABLE resume_customizations ADD COLUMN raw_resume_text TEXT NOT NULL DEFAULT ''`); } catch {}
}

db.exec(`
  CREATE TABLE IF NOT EXISTS resume_customizations (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    candidate_name      TEXT    NOT NULL DEFAULT '',
    job_title           TEXT    NOT NULL DEFAULT '',
    job_description     TEXT    NOT NULL DEFAULT '',
    before_score        INTEGER NOT NULL DEFAULT 0,
    after_score         INTEGER NOT NULL DEFAULT 0,
    summary             TEXT    NOT NULL DEFAULT '',
    skills_prioritised  TEXT    NOT NULL DEFAULT '{}',
    skills_additional   TEXT    NOT NULL DEFAULT '{}',
    skills_missing      TEXT    NOT NULL DEFAULT '[]',
    experience_bullets  TEXT    NOT NULL DEFAULT '[]',
    education           TEXT    NOT NULL DEFAULT '[]',
    certifications      TEXT    NOT NULL DEFAULT '[]',
    projects            TEXT    NOT NULL DEFAULT '[]',
    matched_keywords    TEXT    NOT NULL DEFAULT '[]',
    added_keywords      TEXT    NOT NULL DEFAULT '[]',
    improvements        TEXT    NOT NULL DEFAULT '[]',
    contact_info        TEXT    NOT NULL DEFAULT '',
    years_experience    TEXT    NOT NULL DEFAULT '',
    raw_resume_text     TEXT    NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS job_matches (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    job_title       TEXT    NOT NULL DEFAULT '',
    job_description TEXT    NOT NULL,
    score           INTEGER NOT NULL,
    matched         TEXT    NOT NULL DEFAULT '[]',
    missing         TEXT    NOT NULL DEFAULT '[]',
    partial         TEXT    NOT NULL DEFAULT '[]',
    suggestions     TEXT    NOT NULL DEFAULT '[]',
    job_skills      TEXT    NOT NULL DEFAULT '{}',
    resume_skills   TEXT    NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS interview_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    job_title   TEXT    NOT NULL DEFAULT '',
    difficulty  TEXT    NOT NULL DEFAULT 'intermediate',
    topics      TEXT    NOT NULL DEFAULT '[]',
    total_score INTEGER NOT NULL DEFAULT 0,
    max_score   INTEGER NOT NULL DEFAULT 0,
    completed   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS interview_questions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      INTEGER NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
    position        INTEGER NOT NULL DEFAULT 0,
    topic           TEXT    NOT NULL,
    difficulty      TEXT    NOT NULL,
    question        TEXT    NOT NULL,
    suggested_answer TEXT   NOT NULL,
    key_points      TEXT    NOT NULL DEFAULT '[]',
    candidate_answer TEXT   NOT NULL DEFAULT '',
    score           INTEGER,
    feedback        TEXT    NOT NULL DEFAULT '',
    matched_points  TEXT    NOT NULL DEFAULT '[]',
    missed_points   TEXT    NOT NULL DEFAULT '[]',
    improvement_tips TEXT   NOT NULL DEFAULT '[]',
    answered_at     TEXT
  );
`);

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------

// Job match
const insertMatch = db.prepare(`
  INSERT INTO job_matches
    (job_title, job_description, score, matched, missing, partial, suggestions, job_skills, resume_skills)
  VALUES
    (@job_title, @job_description, @score, @matched, @missing, @partial, @suggestions, @job_skills, @resume_skills)
`);
const selectHistory = db.prepare(`
  SELECT id, created_at, job_title, score, matched, missing, partial, suggestions, job_skills, resume_skills
  FROM job_matches ORDER BY created_at DESC LIMIT 50
`);
const selectMatchById  = db.prepare(`SELECT * FROM job_matches WHERE id = ?`);
const deleteMatchById  = db.prepare(`DELETE FROM job_matches WHERE id = ?`);

// Interview sessions
const insertSession = db.prepare(`
  INSERT INTO interview_sessions (job_title, difficulty, topics)
  VALUES (@job_title, @difficulty, @topics)
`);
const insertQuestion = db.prepare(`
  INSERT INTO interview_questions
    (session_id, position, topic, difficulty, question, suggested_answer, key_points)
  VALUES
    (@session_id, @position, @topic, @difficulty, @question, @suggested_answer, @key_points)
`);
const selectSessionById = db.prepare(`SELECT * FROM interview_sessions WHERE id = ?`);
const selectSessionHistory = db.prepare(`
  SELECT id, created_at, job_title, difficulty, topics, total_score, max_score, completed
  FROM interview_sessions ORDER BY created_at DESC LIMIT 50
`);
const selectQuestionsBySession = db.prepare(`
  SELECT * FROM interview_questions WHERE session_id = ? ORDER BY position ASC
`);
const updateAnswer = db.prepare(`
  UPDATE interview_questions
  SET candidate_answer = @candidate_answer,
      score            = @score,
      feedback         = @feedback,
      matched_points   = @matched_points,
      missed_points    = @missed_points,
      improvement_tips = @improvement_tips,
      answered_at      = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
  WHERE id = @id
`);
const updateSessionScore = db.prepare(`
  UPDATE interview_sessions
  SET total_score = @total_score,
      max_score   = @max_score,
      completed   = @completed
  WHERE id = @id
`);
const deleteSessionById = db.prepare(`DELETE FROM interview_sessions WHERE id = ?`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function deserialiseMatch(row) {
  return {
    ...row,
    matched:       parseJson(row.matched,       []),
    missing:       parseJson(row.missing,       []),
    partial:       parseJson(row.partial,       []),
    suggestions:   parseJson(row.suggestions,   []),
    job_skills:    parseJson(row.job_skills,    {}),
    resume_skills: parseJson(row.resume_skills, {}),
  };
}

function deserialiseSession(row) {
  return { ...row, topics: parseJson(row.topics, []), completed: Boolean(row.completed) };
}

function deserialiseQuestion(row) {
  return {
    ...row,
    key_points:       parseJson(row.key_points,       []),
    matched_points:   parseJson(row.matched_points,   []),
    missed_points:    parseJson(row.missed_points,    []),
    improvement_tips: parseJson(row.improvement_tips, []),
  };
}

function recalcSessionScore(sessionId) {
  const qs = selectQuestionsBySession.all(sessionId);
  const answered = qs.filter((q) => q.score !== null);
  const totalScore = answered.reduce((sum, q) => sum + (q.score || 0), 0);
  const maxScore   = answered.length * 100;
  const completed  = answered.length === qs.length && qs.length > 0 ? 1 : 0;
  updateSessionScore.run({ id: sessionId, total_score: totalScore, max_score: maxScore, completed });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get("/", (req, res) => res.json({ message: "CareerAI Backend Running!" }));

// ---- Resume analysis -------------------------------------------------------

app.post("/api/analyze-resume", upload.single("file"), async (req, res) => {
  if (!req.file)
    return res.status(400).json({ error: "Select a PDF resume to upload." });
  if (!req.file.originalname.toLowerCase().endsWith(".pdf"))
    return res.status(400).json({ error: "Please upload a PDF file." });

  try {
    const form = new FormData();
    form.append(
      "file",
      new Blob([req.file.buffer], { type: req.file.mimetype || "application/pdf" }),
      req.file.originalname,
    );
    const response = await fetch(`${pythonServiceUrl}/analyze-resume`, { method: "POST", body: form });
    const payload  = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({ error: payload.detail || payload.error || "Resume analysis failed." });
    }
    return res.json(payload);
  } catch (err) {
    console.error("Resume analysis error:", err.message);
    return res.status(502).json({ error: "The resume analysis service is unavailable. Make sure the Python service is running." });
  }
});

// ---- Job matching ----------------------------------------------------------

app.post("/api/match-job", async (req, res) => {
  const { resume_skills, job_description, job_title = "" } = req.body;
  if (!job_description?.trim())
    return res.status(400).json({ error: "Job description is required." });
  if (job_description.trim().length < 30)
    return res.status(400).json({ error: "Job description is too short. Paste the full job posting." });
  if (!resume_skills || !Object.keys(resume_skills).length)
    return res.status(400).json({ error: "Resume skills are missing. Please analyse your resume first." });

  try {
    const response = await fetch(`${pythonServiceUrl}/match-job`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resume_skills, job_description }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      return res.status(response.status).json({ error: payload.detail || payload.error || "Job matching failed." });

    const record = insertMatch.run({
      job_title:       String(job_title).trim().slice(0, 200),
      job_description: job_description.trim(),
      score:           payload.score,
      matched:         JSON.stringify(payload.matched    ?? []),
      missing:         JSON.stringify(payload.missing    ?? []),
      partial:         JSON.stringify(payload.partial    ?? []),
      suggestions:     JSON.stringify(payload.suggestions ?? []),
      job_skills:      JSON.stringify(payload.job_skills  ?? {}),
      resume_skills:   JSON.stringify(resume_skills),
    });
    return res.json({ ...payload, id: record.lastInsertRowid });
  } catch (err) {
    console.error("Job match error:", err.message);
    return res.status(502).json({ error: "The job matching service is unavailable. Make sure the Python service is running." });
  }
});

app.get("/api/job-history", (req, res) => {
  try { return res.json(selectHistory.all().map(deserialiseMatch)); }
  catch (err) { return res.status(500).json({ error: "Could not retrieve job history." }); }
});

app.get("/api/job-history/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID." });
  const row = selectMatchById.get(id);
  if (!row) return res.status(404).json({ error: "Not found." });
  return res.json(deserialiseMatch(row));
});

app.delete("/api/job-history/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID." });
  const info = deleteMatchById.run(id);
  if (!info.changes) return res.status(404).json({ error: "Not found." });
  return res.json({ success: true });
});

// ---- Interview: generate session ------------------------------------------

app.post("/api/interview/generate", async (req, res) => {
  const { resume_skills = {}, job_description = "", job_title = "", difficulty = "intermediate", topics = [] } = req.body;

  const validDifficulties = ["beginner", "intermediate", "advanced"];
  if (!validDifficulties.includes(difficulty))
    return res.status(400).json({ error: "Difficulty must be beginner, intermediate, or advanced." });

  const hasSkills = resume_skills && Object.values(resume_skills).some((a) => a.length > 0);
  if (!hasSkills && !job_description.trim() && !topics.length)
    return res.status(400).json({ error: "Provide resume skills, a job description, or select topics to generate questions." });

  try {
    const response = await fetch(`${pythonServiceUrl}/generate-questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resume_skills, job_description, difficulty, topics }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      return res.status(response.status).json({ error: payload.detail || payload.error || "Question generation failed." });

    // Persist session + questions in a transaction
    const createSession = db.transaction(() => {
      const session = insertSession.run({
        job_title:  String(job_title).trim().slice(0, 200),
        difficulty,
        topics:     JSON.stringify(payload.detected_topics ?? []),
      });
      const sessionId = session.lastInsertRowid;

      for (let i = 0; i < payload.questions.length; i++) {
        const q = payload.questions[i];
        insertQuestion.run({
          session_id:       sessionId,
          position:         i,
          topic:            q.topic,
          difficulty:       q.difficulty,
          question:         q.question,
          suggested_answer: q.suggested_answer,
          key_points:       JSON.stringify(q.key_points ?? []),
        });
      }
      return sessionId;
    });

    const sessionId = createSession();
    const questions = selectQuestionsBySession.all(sessionId).map(deserialiseQuestion);
    const session   = deserialiseSession(selectSessionById.get(sessionId));

    return res.json({ session, questions });
  } catch (err) {
    console.error("Interview generate error:", err.message);
    return res.status(502).json({ error: "The interview service is unavailable. Make sure the Python service is running." });
  }
});

// ---- Interview: submit answer for one question ----------------------------

app.post("/api/interview/answer", async (req, res) => {
  const { question_id, candidate_answer } = req.body;

  if (!Number.isFinite(Number(question_id)))
    return res.status(400).json({ error: "question_id is required." });
  if (!candidate_answer?.trim())
    return res.status(400).json({ error: "Answer cannot be empty." });

  // Load the question from DB to get key_points / suggested_answer
  const qRow = db.prepare("SELECT * FROM interview_questions WHERE id = ?").get(Number(question_id));
  if (!qRow) return res.status(404).json({ error: "Question not found." });

  const q = deserialiseQuestion(qRow);

  try {
    const response = await fetch(`${pythonServiceUrl}/evaluate-answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question:         q.question,
        suggested_answer: q.suggested_answer,
        key_points:       q.key_points,
        candidate_answer: candidate_answer.trim(),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      return res.status(response.status).json({ error: payload.detail || payload.error || "Evaluation failed." });

    // Persist evaluated answer
    updateAnswer.run({
      id:               q.id,
      candidate_answer: candidate_answer.trim(),
      score:            payload.score,
      feedback:         payload.feedback,
      matched_points:   JSON.stringify(payload.matched_points  ?? []),
      missed_points:    JSON.stringify(payload.missed_points   ?? []),
      improvement_tips: JSON.stringify(payload.improvement_tips ?? []),
    });

    recalcSessionScore(q.session_id);

    const updatedSession = deserialiseSession(selectSessionById.get(q.session_id));
    return res.json({ ...payload, session: updatedSession });
  } catch (err) {
    console.error("Answer evaluation error:", err.message);
    return res.status(502).json({ error: "The evaluation service is unavailable. Make sure the Python service is running." });
  }
});

// ---- Interview: get full session with answers -----------------------------

app.get("/api/interview/session/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid session ID." });
  const session = selectSessionById.get(id);
  if (!session) return res.status(404).json({ error: "Session not found." });
  const questions = selectQuestionsBySession.all(id).map(deserialiseQuestion);
  return res.json({ session: deserialiseSession(session), questions });
});

// ---- Interview: list history ----------------------------------------------

app.get("/api/interview/history", (req, res) => {
  try {
    return res.json(selectSessionHistory.all().map(deserialiseSession));
  } catch (err) {
    return res.status(500).json({ error: "Could not retrieve interview history." });
  }
});

// ---- Interview: delete session --------------------------------------------

app.delete("/api/interview/session/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid session ID." });
  const info = deleteSessionById.run(id);
  if (!info.changes) return res.status(404).json({ error: "Session not found." });
  return res.json({ success: true });
});

// ===========================================================================
// Resume Customizer routes
// ===========================================================================

const insertCustomization = db.prepare(`
  INSERT INTO resume_customizations
    (candidate_name, job_title, job_description, before_score, after_score,
     summary, skills_prioritised, skills_additional, skills_missing,
     experience_bullets, education, certifications, projects,
     matched_keywords, added_keywords,
     improvements, contact_info, years_experience, raw_resume_text)
  VALUES
    (@candidate_name, @job_title, @job_description, @before_score, @after_score,
     @summary, @skills_prioritised, @skills_additional, @skills_missing,
     @experience_bullets, @education, @certifications, @projects,
     @matched_keywords, @added_keywords,
     @improvements, @contact_info, @years_experience, @raw_resume_text)
`);

const updateCustomization = db.prepare(`
  UPDATE resume_customizations
  SET summary            = @summary,
      skills_prioritised = @skills_prioritised,
      skills_additional  = @skills_additional,
      experience_bullets = @experience_bullets,
      education          = @education,
      certifications     = @certifications,
      projects           = @projects,
      contact_info       = @contact_info
  WHERE id = @id
`);

const selectCustomizationHistory = db.prepare(`
  SELECT id, created_at, candidate_name, job_title, before_score, after_score
  FROM resume_customizations ORDER BY created_at DESC LIMIT 50
`);

const selectCustomizationById = db.prepare(`SELECT * FROM resume_customizations WHERE id = ?`);
const deleteCustomizationById = db.prepare(`DELETE FROM resume_customizations WHERE id = ?`);

function deserialiseCustomization(row) {
  if (!row) return null;
  return {
    ...row,
    skills_prioritised: parseJson(row.skills_prioritised, {}),
    skills_additional:  parseJson(row.skills_additional,  {}),
    skills_missing:     parseJson(row.skills_missing,     []),
    experience_bullets: parseJson(row.experience_bullets, []),
    education:          parseJson(row.education,          []),
    certifications:     parseJson(row.certifications,     []),
    projects:           parseJson(row.projects,           []),
    matched_keywords:   parseJson(row.matched_keywords,   []),
    added_keywords:     parseJson(row.added_keywords,     []),
    improvements:       parseJson(row.improvements,       []),
    raw_resume_text:    row.raw_resume_text || "",
  };
}

// POST /api/customize  — run customization through Python, persist, return result
app.post("/api/customize", upload.single("file"), async (req, res) => {
  // Accept resume PDF directly OR resume_text from prior analysis
  const {
    resume_text       = "",
    resume_skills     = "{}",
    resume_education  = "[]",
    resume_experience = "[]",
    job_description   = "",
    job_title         = "",
    candidate_name    = "",
    years_experience  = "",
    contact_info      = "",
  } = req.body;

  // Parse JSON strings sent as form fields
  let parsedSkills, parsedEducation, parsedExperience;
  try {
    parsedSkills     = typeof resume_skills     === "string" ? JSON.parse(resume_skills)     : resume_skills;
    parsedEducation  = typeof resume_education  === "string" ? JSON.parse(resume_education)  : resume_education;
    parsedExperience = typeof resume_experience === "string" ? JSON.parse(resume_experience) : resume_experience;
  } catch {
    return res.status(400).json({ error: "Invalid JSON in resume fields." });
  }

  if (!job_description.trim())
    return res.status(400).json({ error: "Job description is required." });
  if (job_description.trim().length < 30)
    return res.status(400).json({ error: "Job description is too short." });

  // If a PDF is uploaded, extract text via Python first
  let resolvedText = resume_text;
  if (req.file) {
    try {
      const form = new FormData();
      form.append(
        "file",
        new Blob([req.file.buffer], { type: req.file.mimetype || "application/pdf" }),
        req.file.originalname,
      );
      const analyseRes = await fetch(`${pythonServiceUrl}/analyze-resume`, { method: "POST", body: form });
      const analysed   = await analyseRes.json().catch(() => ({}));
      if (!analyseRes.ok)
        return res.status(analyseRes.status).json({ error: analysed.detail || "Resume analysis failed." });
      // Use the extracted data to populate fields if not already provided
      resolvedText     = resolvedText || analysed.resume_text || "";
      if (!Object.keys(parsedSkills).length)    parsedSkills     = analysed.skills     || {};
      if (!parsedEducation.length)              parsedEducation  = analysed.education  || [];
      if (!parsedExperience.length)             parsedExperience = analysed.experience || [];
    } catch (err) {
      console.error("Re-analysis error:", err.message);
    }
  }

  if (!resolvedText && !Object.keys(parsedSkills).length)
    return res.status(400).json({ error: "Resume content is required. Upload a PDF or analyse your resume first." });

  // If no text but we have skills/experience, reconstruct minimal text
  if (!resolvedText) {
    const skillsList = Object.values(parsedSkills).flat().join(", ");
    resolvedText = [
      candidate_name ? `Name: ${candidate_name}` : "",
      job_title      ? `Title: ${job_title}`      : "",
      skillsList     ? `Skills: ${skillsList}`    : "",
      parsedExperience.join("\n"),
      parsedEducation.join("\n"),
    ].filter(Boolean).join("\n");
  }

  try {
    const response = await fetch(`${pythonServiceUrl}/customize-resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resume_text:       resolvedText,
        resume_skills:     parsedSkills,
        resume_education:  parsedEducation,
        resume_experience: parsedExperience,
        job_description,
        job_title,
        candidate_name,
        years_experience,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      return res.status(response.status).json({ error: payload.detail || payload.error || "Customization failed." });

    // Persist
    const record = insertCustomization.run({
      candidate_name,
      job_title,
      job_description:    job_description.trim(),
      before_score:       payload.before_score,
      after_score:        payload.after_score,
      summary:            payload.summary,
      skills_prioritised: JSON.stringify(payload.skills_prioritised ?? {}),
      skills_additional:  JSON.stringify(payload.skills_additional  ?? {}),
      skills_missing:     JSON.stringify(payload.skills_missing     ?? []),
      experience_bullets: JSON.stringify(payload.experience_bullets ?? []),
      education:          JSON.stringify(payload.education          ?? []),
      certifications:     JSON.stringify(payload.certifications     ?? []),
      projects:           JSON.stringify(payload.projects           ?? []),
      matched_keywords:   JSON.stringify(payload.matched_keywords   ?? []),
      added_keywords:     JSON.stringify(payload.added_keywords     ?? []),
      improvements:       JSON.stringify(payload.improvements       ?? []),
      contact_info,
      years_experience,
      raw_resume_text:    resolvedText,
    });

    return res.json({ ...payload, id: record.lastInsertRowid, contact_info, raw_resume_text: resolvedText });
  } catch (err) {
    console.error("Customization error:", err.message);
    return res.status(502).json({ error: "The customization service is unavailable. Make sure the Python service is running." });
  }
});

// PATCH /api/customize/:id — save user edits to a customization
app.patch("/api/customize/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID." });

  const { summary, skills_prioritised, skills_additional, experience_bullets, education, certifications, projects, contact_info } = req.body;
  try {
    updateCustomization.run({
      id,
      summary:            summary            ?? "",
      skills_prioritised: JSON.stringify(skills_prioritised ?? {}),
      skills_additional:  JSON.stringify(skills_additional  ?? {}),
      experience_bullets: JSON.stringify(experience_bullets ?? []),
      education:          JSON.stringify(education          ?? []),
      certifications:     JSON.stringify(certifications     ?? []),
      projects:           JSON.stringify(projects           ?? []),
      contact_info:       contact_info       ?? "",
    });
    const updated = selectCustomizationById.get(id);
    return res.json(deserialiseCustomization(updated));
  } catch (err) {
    console.error("Update customization error:", err.message);
    return res.status(500).json({ error: "Could not update customization." });
  }
});

// GET /api/customize/history
app.get("/api/customize/history", (req, res) => {
  try { return res.json(selectCustomizationHistory.all()); }
  catch (err) { return res.status(500).json({ error: "Could not retrieve history." }); }
});

// GET /api/customize/:id
app.get("/api/customize/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID." });
  const row = selectCustomizationById.get(id);
  if (!row) return res.status(404).json({ error: "Not found." });
  return res.json(deserialiseCustomization(row));
});

// DELETE /api/customize/:id
app.delete("/api/customize/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID." });
  const info = deleteCustomizationById.run(id);
  if (!info.changes) return res.status(404).json({ error: "Not found." });
  return res.json({ success: true });
});

// POST /api/customize/:id/download — proxy PDF generation to Python
app.post("/api/customize/:id/download", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID." });

  // Allow caller to send edits; fall back to saved version
  let row = deserialiseCustomization(selectCustomizationById.get(id));
  if (!row) return res.status(404).json({ error: "Customization not found." });

  // Merge any in-request overrides (for live editor download without saving first)
  const overrides = req.body || {};
  const pdfPayload = {
    candidate_name:     overrides.candidate_name     ?? row.candidate_name,
    summary:            overrides.summary            ?? row.summary,
    skills_prioritised: overrides.skills_prioritised ?? row.skills_prioritised,
    skills_additional:  overrides.skills_additional  ?? row.skills_additional,
    experience_bullets: overrides.experience_bullets ?? row.experience_bullets,
    education:          overrides.education          ?? row.education,
    certifications:     overrides.certifications     ?? row.certifications,
    projects:           overrides.projects           ?? row.projects,
    contact_info:       overrides.contact_info       ?? row.contact_info,
    raw_resume_text:    row.raw_resume_text           ?? "",
  };

  try {
    const response = await fetch(`${pythonServiceUrl}/generate-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pdfPayload),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.detail || "PDF generation failed." });
    }
    const pdfBuffer = Buffer.from(await response.arrayBuffer());
    const safeName  = (pdfPayload.candidate_name || "resume").replace(/[^\w-]/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}_resume.pdf"`);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error("PDF generation error:", err.message);
    return res.status(502).json({ error: "PDF generation service is unavailable." });
  }
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE")
    return res.status(413).json({ error: "PDF must be 10 MB or smaller." });
  console.error(error);
  return res.status(400).json({ error: "Could not process the request." });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`CareerAI backend running on port ${port}`);
  console.log(`SQLite DB: ${path.join(__dirname, "career_ai.db")}`);
});
