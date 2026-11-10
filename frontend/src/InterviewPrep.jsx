import { useState, useEffect, useRef } from 'react'
import './InterviewPrep.css'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DIFFICULTIES = [
  { value: 'beginner',     label: 'Beginner',     desc: '0–1 yr experience' },
  { value: 'intermediate', label: 'Intermediate',  desc: '1–3 yrs experience' },
  { value: 'advanced',     label: 'Advanced',      desc: '3+ yrs experience' },
]

const ALL_TOPICS = [
  'React', 'JavaScript', 'Node.js', 'Python', 'SQL', 'Full Stack', 'HR & Behavioral',
]

// ---------------------------------------------------------------------------
// Small sub-components
// ---------------------------------------------------------------------------

function ScoreRing({ score, size = 72 }) {
  const r = (size / 2) - 6
  const circ = 2 * Math.PI * r
  const offset = circ - (score / 100) * circ
  const color = score >= 75 ? '#278c78' : score >= 50 ? '#d97706' : '#c0392b'
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`Score ${score}`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e8edf3" strokeWidth="6" />
      <circle
        cx={size/2} cy={size/2} r={r}
        fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={offset}
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition: 'stroke-dashoffset 0.8s ease' }}
      />
      <text x={size/2} y={size/2 + 5} textAnchor="middle" fill={color}
        style={{ font: `800 ${size < 60 ? 13 : 16}px Manrope, sans-serif` }}>
        {score}
      </text>
    </svg>
  )
}

function DifficultyPill({ value }) {
  const map = { beginner: 'ip-pill--green', intermediate: 'ip-pill--amber', advanced: 'ip-pill--red' }
  return <span className={`ip-pill ${map[value] || ''}`}>{value}</span>
}

function TopicBadge({ topic }) {
  return <span className="ip-topic-badge">{topic}</span>
}

function ProgressBar({ current, total }) {
  const pct = total ? Math.round((current / total) * 100) : 0
  return (
    <div className="ip-progress-wrap" role="progressbar" aria-valuenow={current} aria-valuemax={total}>
      <div className="ip-progress-track">
        <div className="ip-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="ip-progress-label">{current} / {total}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Setup screen
// ---------------------------------------------------------------------------

function SetupScreen({ resumeAnalysis, onStart, loading, error }) {
  const [difficulty, setDifficulty] = useState('intermediate')
  const [jobTitle, setJobTitle]     = useState('')
  const [jobDesc, setJobDesc]       = useState('')
  const [topics, setTopics]         = useState([])

  function toggleTopic(t) {
    setTopics((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])
  }

  function handleSubmit(e) {
    e.preventDefault()
    onStart({
      resume_skills:   resumeAnalysis?.skills || {},
      job_description: jobDesc,
      job_title:       jobTitle,
      difficulty,
      topics,
    })
  }

  return (
    <div className="ip-setup">
      <div className="ip-eyebrow"><span className="eyebrow-dot" /> AI INTERVIEW PREP</div>
      <h2 className="ip-heading">Prepare for your interview</h2>
      <p className="ip-subheading">
        Get personalised questions based on your resume and target role. Submit answers and receive instant AI feedback.
      </p>

      {resumeAnalysis ? (
        <div className="ip-banner ip-banner--ok">
          <span>✓</span>
          Resume loaded — <strong>{resumeAnalysis.filename}</strong>
          &nbsp;·&nbsp;{Object.values(resumeAnalysis.skills || {}).flat().length} skills
        </div>
      ) : (
        <div className="ip-banner ip-banner--warn">
          <span>⚠</span>
          No resume loaded. Questions will be generated from your selected topics.
          Switch to <strong>Resume Analyzer</strong> for personalised questions.
        </div>
      )}

      <form className="ip-setup-form" onSubmit={handleSubmit}>
        {/* Difficulty */}
        <div className="ip-field">
          <label className="ip-label">Experience level</label>
          <div className="ip-difficulty-grid">
            {DIFFICULTIES.map((d) => (
              <button
                key={d.value}
                type="button"
                className={`ip-diff-card ${difficulty === d.value ? 'ip-diff-card--active' : ''}`}
                onClick={() => setDifficulty(d.value)}
              >
                <span className="ip-diff-label">{d.label}</span>
                <span className="ip-diff-desc">{d.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Job title */}
        <div className="ip-field">
          <label className="ip-label" htmlFor="ip-job-title">
            Job title <span className="ip-optional">(optional)</span>
          </label>
          <input
            id="ip-job-title"
            className="ip-input"
            type="text"
            placeholder="e.g. Junior Full Stack Developer"
            value={jobTitle}
            maxLength={200}
            onChange={(e) => setJobTitle(e.target.value)}
          />
        </div>

        {/* Job description */}
        <div className="ip-field">
          <label className="ip-label" htmlFor="ip-job-desc">
            Job description <span className="ip-optional">(optional — improves relevance)</span>
          </label>
          <textarea
            id="ip-job-desc"
            className="ip-textarea"
            placeholder="Paste the job description to get role-specific questions…"
            value={jobDesc}
            rows={5}
            onChange={(e) => setJobDesc(e.target.value)}
          />
        </div>

        {/* Topic override */}
        <div className="ip-field">
          <label className="ip-label">
            Topics <span className="ip-optional">(leave blank to auto-detect from resume)</span>
          </label>
          <div className="ip-topics-grid">
            {ALL_TOPICS.map((t) => (
              <button
                key={t}
                type="button"
                className={`ip-topic-btn ${topics.includes(t) ? 'ip-topic-btn--active' : ''}`}
                onClick={() => toggleTopic(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="ip-error" role="alert">{error}</p>}

        <button className="ip-start-btn" type="submit" disabled={loading}>
          {loading
            ? <><span className="spinner" /> Generating questions…</>
            : <>Start interview <span aria-hidden="true">→</span></>}
        </button>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Question card (single question + answer input)
// ---------------------------------------------------------------------------

function QuestionCard({ question, index, total, onSubmit, submitting }) {
  const [answer, setAnswer] = useState(question.candidate_answer || '')
  const [showAnswer, setShowAnswer] = useState(false)
  const isAnswered = question.score !== null && question.score !== undefined

  function handleSubmit(e) {
    e.preventDefault()
    if (!answer.trim()) return
    onSubmit(question.id, answer)
  }

  return (
    <article className="ip-q-card">
      {/* Header */}
      <div className="ip-q-header">
        <div className="ip-q-meta">
          <span className="ip-q-num">Q{index + 1} of {total}</span>
          <TopicBadge topic={question.topic} />
          <DifficultyPill value={question.difficulty} />
        </div>
        {isAnswered && <ScoreRing score={question.score} size={56} />}
      </div>

      {/* Question text */}
      <p className="ip-q-text">{question.question}</p>

      {/* If already answered — show feedback */}
      {isAnswered ? (
        <div className="ip-feedback-wrap">
          <div className={`ip-feedback-banner ip-feedback-banner--${question.score >= 75 ? 'good' : question.score >= 50 ? 'ok' : 'low'}`}>
            {question.feedback}
          </div>

          <div className="ip-feedback-grid">
            {question.matched_points?.length > 0 && (
              <div className="ip-feedback-section">
                <span className="ip-feedback-section-title ip-feedback-section-title--green">✓ Covered</span>
                <div className="ip-chips">
                  {question.matched_points.map((p) => (
                    <span key={p} className="ip-chip ip-chip--green">{p}</span>
                  ))}
                </div>
              </div>
            )}
            {question.missed_points?.length > 0 && (
              <div className="ip-feedback-section">
                <span className="ip-feedback-section-title ip-feedback-section-title--red">✗ Missed</span>
                <div className="ip-chips">
                  {question.missed_points.map((p) => (
                    <span key={p} className="ip-chip ip-chip--red">{p}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {question.improvement_tips?.length > 0 && (
            <div className="ip-tips-list">
              {question.improvement_tips.map((tip, i) => (
                <div key={i} className="ip-tip">
                  <span className="ip-tip-icon">💡</span>
                  <span>{tip}</span>
                </div>
              ))}
            </div>
          )}

          <div className="ip-your-answer-wrap">
            <span className="ip-your-answer-label">Your answer:</span>
            <p className="ip-your-answer-text">{question.candidate_answer}</p>
          </div>

          <button
            className="ip-reveal-btn"
            type="button"
            onClick={() => setShowAnswer((v) => !v)}
          >
            {showAnswer ? 'Hide suggested answer ↑' : 'Show suggested answer ↓'}
          </button>
          {showAnswer && (
            <div className="ip-suggested-answer">
              <span className="ip-suggested-label">Suggested answer</span>
              <p>{question.suggested_answer}</p>
            </div>
          )}
        </div>
      ) : (
        /* Answer form */
        <form onSubmit={handleSubmit}>
          <label className="ip-label" htmlFor={`answer-${question.id}`}>Your answer</label>
          <textarea
            id={`answer-${question.id}`}
            className="ip-textarea ip-answer-textarea"
            placeholder="Type your answer here — be as detailed as you can…"
            value={answer}
            rows={6}
            onChange={(e) => setAnswer(e.target.value)}
            required
          />
          <div className="ip-answer-footer">
            <span className="ip-word-count">{answer.trim().split(/\s+/).filter(Boolean).length} words</span>
            <div className="ip-answer-actions">
              <button
                type="button"
                className="ip-reveal-btn"
                onClick={() => setShowAnswer((v) => !v)}
              >
                {showAnswer ? 'Hide hint ↑' : 'Need a hint? ↓'}
              </button>
              <button
                className="ip-submit-btn"
                type="submit"
                disabled={submitting || !answer.trim()}
              >
                {submitting ? <><span className="spinner" /> Evaluating…</> : 'Submit answer →'}
              </button>
            </div>
          </div>
          {showAnswer && (
            <div className="ip-suggested-answer">
              <span className="ip-suggested-label">Suggested answer</span>
              <p>{question.suggested_answer}</p>
            </div>
          )}
        </form>
      )}
    </article>
  )
}

// ---------------------------------------------------------------------------
// Session summary panel
// ---------------------------------------------------------------------------

function SessionSummary({ session, questions, onNewSession }) {
  const answered     = questions.filter((q) => q.score !== null)
  const avgScore     = answered.length
    ? Math.round(answered.reduce((s, q) => s + q.score, 0) / answered.length)
    : 0
  const topicScores  = {}
  for (const q of answered) {
    if (!topicScores[q.topic]) topicScores[q.topic] = []
    topicScores[q.topic].push(q.score)
  }

  const scoreColor = avgScore >= 75 ? '#278c78' : avgScore >= 50 ? '#d97706' : '#c0392b'
  const scoreLabel = avgScore >= 75 ? 'Great job!' : avgScore >= 50 ? 'Good effort' : 'Keep practising'

  return (
    <div className="ip-summary">
      <div className="ip-summary-header">
        <div>
          <div className="ip-eyebrow"><span className="eyebrow-dot" /> SESSION COMPLETE</div>
          <h2 className="ip-heading" style={{ marginBottom: 4 }}>Interview results</h2>
          <p className="ip-subheading" style={{ marginBottom: 0 }}>
            {session.job_title || 'Practice session'} · <DifficultyPill value={session.difficulty} />
          </p>
        </div>
        <div className="ip-summary-score">
          <ScoreRing score={avgScore} size={96} />
          <span className="ip-summary-score-label" style={{ color: scoreColor }}>{scoreLabel}</span>
        </div>
      </div>

      <div className="ip-summary-stats">
        <div className="ip-stat-box">
          <span className="ip-stat-box-num">{answered.length}</span>
          <span className="ip-stat-box-lbl">Answered</span>
        </div>
        <div className="ip-stat-box">
          <span className="ip-stat-box-num">{questions.length - answered.length}</span>
          <span className="ip-stat-box-lbl">Skipped</span>
        </div>
        <div className="ip-stat-box">
          <span className="ip-stat-box-num" style={{ color: scoreColor }}>{avgScore}%</span>
          <span className="ip-stat-box-lbl">Avg score</span>
        </div>
        <div className="ip-stat-box">
          <span className="ip-stat-box-num">{answered.filter((q) => q.score >= 75).length}</span>
          <span className="ip-stat-box-lbl">Strong answers</span>
        </div>
      </div>

      {/* Per-topic breakdown */}
      {Object.keys(topicScores).length > 0 && (
        <div className="ip-topic-breakdown">
          <h3 className="ip-section-title">Score by topic</h3>
          <div className="ip-topic-breakdown-grid">
            {Object.entries(topicScores).map(([topic, scores]) => {
              const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
              const col = avg >= 75 ? '#278c78' : avg >= 50 ? '#d97706' : '#c0392b'
              return (
                <div key={topic} className="ip-topic-breakdown-item">
                  <div className="ip-topic-breakdown-top">
                    <TopicBadge topic={topic} />
                    <span style={{ color: col, fontWeight: 700, fontSize: 14 }}>{avg}%</span>
                  </div>
                  <div className="ip-mini-bar-track">
                    <div className="ip-mini-bar-fill" style={{ width: `${avg}%`, background: col }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <button className="ip-start-btn" style={{ marginTop: 28 }} onClick={onNewSession}>
        Start new session →
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// History sidebar row
// ---------------------------------------------------------------------------

function HistoryRow({ session, onLoad, onDelete }) {
  const date = new Date(session.created_at).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  })
  const avg = session.max_score
    ? Math.round((session.total_score / session.max_score) * 100)
    : 0
  const col = avg >= 75 ? '#278c78' : avg >= 50 ? '#d97706' : '#c0392b'

  return (
    <div className="ip-history-row">
      <div className="ip-history-left">
        <span className="ip-history-score" style={{ color: col }}>{avg}%</span>
        <div className="ip-history-meta">
          <span className="ip-history-title">{session.job_title || 'Practice session'}</span>
          <span className="ip-history-sub">
            {date} · <DifficultyPill value={session.difficulty} />
            {session.completed ? ' · ✓ Complete' : ' · In progress'}
          </span>
        </div>
      </div>
      <div className="ip-history-actions">
        <button className="ip-btn-ghost ip-btn-sm" onClick={() => onLoad(session.id)}>Load</button>
        <button className="ip-btn-ghost ip-btn-sm ip-btn-danger" onClick={() => onDelete(session.id)}>✕</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function InterviewPrep({ resumeAnalysis }) {
  const [view, setView]           = useState('setup')   // setup | session | summary | history
  const [session, setSession]     = useState(null)
  const [questions, setQuestions] = useState([])
  const [currentQ, setCurrentQ]   = useState(0)
  const [loading, setLoading]     = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]         = useState('')
  const [history, setHistory]     = useState([])
  const [histLoading, setHistLoading] = useState(false)
  const topRef = useRef(null)

  useEffect(() => { fetchHistory() }, [])

  function scrollTop() {
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function fetchHistory() {
    setHistLoading(true)
    try {
      const res = await fetch('/api/interview/history')
      if (res.ok) setHistory(await res.json())
    } catch { /* silent */ }
    finally { setHistLoading(false) }
  }

  async function handleStart(params) {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/interview/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to generate questions.')
      setSession(data.session)
      setQuestions(data.questions)
      setCurrentQ(0)
      setView('session')
      fetchHistory()
      scrollTop()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmitAnswer(questionId, candidateAnswer) {
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/interview/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_id: questionId, candidate_answer: candidateAnswer }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Evaluation failed.')

      // Merge updated eval into questions array
      setQuestions((prev) => prev.map((q) =>
        q.id === questionId
          ? {
              ...q,
              candidate_answer: candidateAnswer,
              score:            data.score,
              feedback:         data.feedback,
              matched_points:   data.matched_points,
              missed_points:    data.missed_points,
              improvement_tips: data.improvement_tips,
            }
          : q
      ))
      setSession(data.session)
      fetchHistory()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleLoadSession(id) {
    setLoading(true)
    try {
      const res = await fetch(`/api/interview/session/${id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load session.')
      setSession(data.session)
      setQuestions(data.questions)
      setCurrentQ(0)
      setView(data.session.completed ? 'summary' : 'session')
      scrollTop()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteSession(id) {
    try {
      await fetch(`/api/interview/session/${id}`, { method: 'DELETE' })
      setHistory((prev) => prev.filter((s) => s.id !== id))
      if (session?.id === id) { setView('setup'); setSession(null); setQuestions([]) }
    } catch { /* silent */ }
  }

  function handleNewSession() {
    setView('setup'); setSession(null); setQuestions([]); setError('')
  }

  const answeredCount = questions.filter((q) => q.score !== null).length

  // ---- Render ----
  return (
    <div className="ip-shell" ref={topRef}>

      {/* ---- Setup ---- */}
      {view === 'setup' && (
        <>
          <SetupScreen
            resumeAnalysis={resumeAnalysis}
            onStart={handleStart}
            loading={loading}
            error={error}
          />

          {/* History panel on setup screen */}
          <div className="ip-history-panel">
            <div className="ip-history-panel-header">
              <span className="ip-section-title">Previous sessions</span>
              <button className="ip-btn-ghost ip-btn-sm" onClick={fetchHistory}>↺ Refresh</button>
            </div>
            {histLoading
              ? <p className="ip-empty">Loading…</p>
              : history.length
                ? history.map((s) => (
                    <HistoryRow key={s.id} session={s} onLoad={handleLoadSession} onDelete={handleDeleteSession} />
                  ))
                : <p className="ip-empty">No previous sessions yet.</p>
            }
          </div>
        </>
      )}

      {/* ---- Active session ---- */}
      {view === 'session' && session && (
        <div className="ip-session">
          {/* Session toolbar */}
          <div className="ip-session-toolbar">
            <div className="ip-session-info">
              <span className="ip-session-title">{session.job_title || 'Interview session'}</span>
              <DifficultyPill value={session.difficulty} />
              {session.topics?.map((t) => <TopicBadge key={t} topic={t} />)}
            </div>
            <div className="ip-session-controls">
              <ProgressBar current={answeredCount} total={questions.length} />
              <button className="ip-btn-ghost ip-btn-sm" onClick={handleNewSession}>✕ Exit</button>
            </div>
          </div>

          {error && <p className="ip-error" role="alert">{error}</p>}

          {/* Question navigator */}
          <div className="ip-q-nav">
            {questions.map((q, i) => (
              <button
                key={q.id}
                className={`ip-q-nav-dot ${i === currentQ ? 'ip-q-nav-dot--active' : ''} ${q.score !== null ? (q.score >= 75 ? 'ip-q-nav-dot--good' : q.score >= 50 ? 'ip-q-nav-dot--ok' : 'ip-q-nav-dot--low') : ''}`}
                onClick={() => setCurrentQ(i)}
                aria-label={`Question ${i + 1}${q.score !== null ? ` — scored ${q.score}` : ' — not answered'}`}
                title={`Q${i + 1}: ${q.topic}`}
              >
                {i + 1}
              </button>
            ))}
          </div>

          {/* Active question */}
          {questions[currentQ] && (
            <QuestionCard
              key={questions[currentQ].id}
              question={questions[currentQ]}
              index={currentQ}
              total={questions.length}
              onSubmit={handleSubmitAnswer}
              submitting={submitting}
            />
          )}

          {/* Prev / Next nav */}
          <div className="ip-q-pagination">
            <button
              className="ip-btn-ghost"
              disabled={currentQ === 0}
              onClick={() => { setCurrentQ((p) => p - 1); scrollTop() }}
            >
              ← Previous
            </button>
            {currentQ < questions.length - 1 ? (
              <button
                className="ip-start-btn ip-start-btn--sm"
                onClick={() => { setCurrentQ((p) => p + 1); scrollTop() }}
              >
                Next question →
              </button>
            ) : (
              <button
                className="ip-start-btn ip-start-btn--sm"
                onClick={() => { setView('summary'); scrollTop() }}
              >
                View results →
              </button>
            )}
          </div>
        </div>
      )}

      {/* ---- Summary ---- */}
      {view === 'summary' && session && (
        <SessionSummary
          session={session}
          questions={questions}
          onNewSession={handleNewSession}
        />
      )}

      {/* Floating finish button during session */}
      {view === 'session' && answeredCount > 0 && (
        <div className="ip-finish-bar">
          <span>{answeredCount}/{questions.length} answered</span>
          <button className="ip-start-btn ip-start-btn--sm" onClick={() => { setView('summary'); scrollTop() }}>
            Finish &amp; see results
          </button>
        </div>
      )}

    </div>
  )
}
