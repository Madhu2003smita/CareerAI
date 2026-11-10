import { useState, useEffect, useRef } from 'react'
import './JobMatcher.css'

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Animated circular score dial */
function ScoreDial({ score }) {
  const radius = 54
  const circ = 2 * Math.PI * radius
  const offset = circ - (score / 100) * circ

  const color =
    score >= 75 ? '#278c78' :
    score >= 50 ? '#e6a817' :
    '#c0392b'

  const label =
    score >= 75 ? 'Strong match' :
    score >= 50 ? 'Moderate match' :
    'Weak match'

  return (
    <div className="score-dial-wrap" aria-label={`Match score ${score} out of 100`}>
      <svg className="score-dial" viewBox="0 0 128 128" width="128" height="128">
        {/* track */}
        <circle cx="64" cy="64" r={radius} fill="none" stroke="#e8edf3" strokeWidth="10" />
        {/* progress */}
        <circle
          cx="64" cy="64" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform="rotate(-90 64 64)"
          style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(.4,0,.2,1), stroke 0.4s' }}
        />
        <text x="64" y="58" textAnchor="middle" className="dial-score" fill={color}>{score}</text>
        <text x="64" y="74" textAnchor="middle" className="dial-pct" fill="#8190a0">/ 100</text>
      </svg>
      <span className="dial-label" style={{ color }}>{label}</span>
    </div>
  )
}

/** Linear progress bar used in the scoring breakdown */
function MiniBar({ value, color }) {
  return (
    <div className="mini-bar-track" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div
        className="mini-bar-fill"
        style={{ width: `${value}%`, background: color, transition: 'width 0.7s cubic-bezier(.4,0,.2,1)' }}
      />
    </div>
  )
}

/** Chip with optional colour variant */
function Chip({ label, variant = 'default' }) {
  return <span className={`jm-chip jm-chip--${variant}`}>{label}</span>
}

/** Single history row */
function HistoryRow({ entry, onLoad, onDelete }) {
  const date = new Date(entry.created_at).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  })
  const color =
    entry.score >= 75 ? 'var(--green)' :
    entry.score >= 50 ? 'var(--amber)' :
    'var(--red)'

  return (
    <div className="history-row">
      <div className="history-row-left">
        <span className="history-score" style={{ color }}>{entry.score}%</span>
        <div className="history-meta">
          <span className="history-title">{entry.job_title || 'Untitled role'}</span>
          <span className="history-date">{date}</span>
        </div>
      </div>
      <div className="history-row-actions">
        <button className="btn-ghost btn-sm" onClick={() => onLoad(entry)} title="Reload this result">
          Load
        </button>
        <button className="btn-ghost btn-sm btn-danger" onClick={() => onDelete(entry.id)} title="Delete">
          ✕
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function JobMatcher({ resumeAnalysis }) {
  const [jobTitle, setJobTitle]         = useState('')
  const [jobDesc, setJobDesc]           = useState('')
  const [result, setResult]             = useState(null)
  const [error, setError]               = useState('')
  const [loading, setLoading]           = useState(false)
  const [history, setHistory]           = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [activeTab, setActiveTab]       = useState('overview') // overview | breakdown | suggestions | history
  const resultsRef                      = useRef(null)

  // Fetch history on mount
  useEffect(() => {
    fetchHistory()
  }, [])

  // Scroll results into view after a successful match
  useEffect(() => {
    if (result && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [result])

  async function fetchHistory() {
    setHistoryLoading(true)
    try {
      const res = await fetch('/api/job-history')
      if (res.ok) {
        const data = await res.json()
        setHistory(data)
      }
    } catch {
      // non-critical — history panel will just be empty
    } finally {
      setHistoryLoading(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!resumeAnalysis) {
      setError('No resume analysed yet. Go to the Resume Analyzer tab and upload your resume first.')
      return
    }

    const hasSkills = resumeAnalysis.skills &&
      Object.values(resumeAnalysis.skills).some((arr) => arr.length > 0)

    if (!hasSkills) {
      setError('No skills were extracted from your resume. Try uploading a text-selectable PDF.')
      return
    }

    if (!jobDesc.trim()) {
      setError('Paste a job description before matching.')
      return
    }
    if (jobDesc.trim().length < 30) {
      setError('Job description is too short. Paste the full posting for accurate results.')
      return
    }

    setLoading(true)
    setResult(null)

    try {
      const res = await fetch('/api/match-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resume_skills: resumeAnalysis.skills,
          job_description: jobDesc,
          job_title: jobTitle,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Job matching failed.')
      setResult(data)
      setActiveTab('overview')
      fetchHistory()   // refresh sidebar
    } catch (err) {
      setError(err.message || 'Could not connect to the backend.')
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteHistory(id) {
    try {
      await fetch(`/api/job-history/${id}`, { method: 'DELETE' })
      setHistory((prev) => prev.filter((h) => h.id !== id))
      // If the displayed result is the deleted one, clear it
      if (result?.id === id) setResult(null)
    } catch {
      // silent
    }
  }

  function handleLoadHistory(entry) {
    setResult(entry)
    setJobTitle(entry.job_title || '')
    setActiveTab('overview')
    if (resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  // Scoring breakdown stats
  const totalJobSkills = result
    ? (result.matched.length + result.missing.length + result.partial.length)
    : 0

  const matchedPct = totalJobSkills ? Math.round((result.matched.length / totalJobSkills) * 100) : 0
  const partialPct = totalJobSkills ? Math.round((result.partial.length / totalJobSkills) * 100) : 0
  const missingPct = totalJobSkills ? Math.round((result.missing.length / totalJobSkills) * 100) : 0

  return (
    <div className="jm-shell">

      {/* ---------------------------------------------------------------- */}
      {/* Input panel                                                       */}
      {/* ---------------------------------------------------------------- */}
      <div className="jm-eyebrow">
        <span className="eyebrow-dot" />
        AI JOB MATCHER
      </div>
      <h2 className="jm-heading">Match your resume to any role</h2>
      <p className="jm-subheading">
        Paste a job description below. We'll compare it against your resume skills and show you exactly where you stand.
      </p>

      {/* Resume status banner */}
      {resumeAnalysis ? (
        <div className="jm-banner jm-banner--ok" role="status">
          <span className="jm-banner-icon">✓</span>
          Resume loaded — <strong>{resumeAnalysis.filename}</strong>
          &nbsp;·&nbsp;
          {Object.values(resumeAnalysis.skills || {}).flat().length} skills extracted
        </div>
      ) : (
        <div className="jm-banner jm-banner--warn" role="status">
          <span className="jm-banner-icon">⚠</span>
          No resume analysed yet. Switch to the <strong>Resume Analyzer</strong> tab first.
        </div>
      )}

      <form className="jm-form" onSubmit={handleSubmit} noValidate>
        <div className="jm-field">
          <label className="jm-label" htmlFor="job-title">Job title <span className="jm-optional">(optional)</span></label>
          <input
            id="job-title"
            className="jm-input"
            type="text"
            placeholder="e.g. Senior Frontend Engineer"
            value={jobTitle}
            maxLength={200}
            onChange={(e) => setJobTitle(e.target.value)}
          />
        </div>

        <div className="jm-field">
          <label className="jm-label" htmlFor="job-desc">
            Job description <span className="jm-required">*</span>
          </label>
          <textarea
            id="job-desc"
            className="jm-textarea"
            placeholder="Paste the full job description here…"
            value={jobDesc}
            rows={9}
            onChange={(e) => { setJobDesc(e.target.value); setError('') }}
            required
            aria-required="true"
          />
          <span className="jm-char-count">{jobDesc.length} characters</span>
        </div>

        {error && (
          <p className="jm-error" role="alert">{error}</p>
        )}

        <button className="jm-submit" type="submit" disabled={loading || !resumeAnalysis}>
          {loading
            ? <><span className="spinner" /> Analysing match…</>
            : <>Match resume to job <span aria-hidden="true">→</span></>}
        </button>
      </form>

      {/* ---------------------------------------------------------------- */}
      {/* Results panel                                                     */}
      {/* ---------------------------------------------------------------- */}
      {result && (
        <section className="jm-results" ref={resultsRef} aria-live="polite">

          {/* Header row */}
          <div className="jm-results-header">
            <div>
              <div className="eyebrow" style={{ justifyContent: 'flex-start' }}>
                <span className="eyebrow-dot" /> MATCH RESULTS
              </div>
              <h3 className="jm-results-title">
                {result.job_title || 'Job description analysis'}
              </h3>
            </div>
            <ScoreDial score={result.score} />
          </div>

          {/* Quick stat row */}
          <div className="jm-stat-row">
            <div className="jm-stat jm-stat--green">
              <span className="jm-stat-num">{result.matched.length}</span>
              <span className="jm-stat-lbl">Matched</span>
            </div>
            <div className="jm-stat jm-stat--amber">
              <span className="jm-stat-num">{result.partial.length}</span>
              <span className="jm-stat-lbl">Partial</span>
            </div>
            <div className="jm-stat jm-stat--red">
              <span className="jm-stat-num">{result.missing.length}</span>
              <span className="jm-stat-lbl">Missing</span>
            </div>
            <div className="jm-stat jm-stat--neutral">
              <span className="jm-stat-num">{totalJobSkills}</span>
              <span className="jm-stat-lbl">Total required</span>
            </div>
          </div>

          {/* Tab bar */}
          <div className="jm-tabs" role="tablist">
            {[
              { id: 'overview',     label: 'Overview'     },
              { id: 'breakdown',    label: 'Breakdown'    },
              { id: 'suggestions',  label: `Suggestions (${result.suggestions.length})` },
              { id: 'history',      label: `History (${history.length})` },
            ].map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`jm-tab ${activeTab === tab.id ? 'jm-tab--active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ---- Overview tab ---- */}
          {activeTab === 'overview' && (
            <div className="jm-tab-panel" role="tabpanel">
              <div className="jm-overview-grid">

                {/* Matched skills */}
                <article className="jm-card">
                  <h4 className="jm-card-title">
                    <span className="jm-dot jm-dot--green" />
                    Matched skills
                    <span className="jm-card-count">{result.matched.length}</span>
                  </h4>
                  {result.matched.length ? (
                    <div className="jm-chips">
                      {result.matched.map((s) => <Chip key={s} label={s} variant="matched" />)}
                    </div>
                  ) : <p className="jm-empty">None matched exactly.</p>}
                </article>

                {/* Partial matches */}
                <article className="jm-card">
                  <h4 className="jm-card-title">
                    <span className="jm-dot jm-dot--amber" />
                    Partial matches
                    <span className="jm-card-count">{result.partial.length}</span>
                  </h4>
                  <p className="jm-card-hint">Your resume touches these skills but doesn't use the exact terminology.</p>
                  {result.partial.length ? (
                    <div className="jm-chips">
                      {result.partial.map((s) => <Chip key={s} label={s} variant="partial" />)}
                    </div>
                  ) : <p className="jm-empty">No partial matches.</p>}
                </article>

                {/* Missing skills */}
                <article className="jm-card jm-card--wide">
                  <h4 className="jm-card-title">
                    <span className="jm-dot jm-dot--red" />
                    Missing skills
                    <span className="jm-card-count">{result.missing.length}</span>
                  </h4>
                  <p className="jm-card-hint">These are required by the job but were not found in your resume.</p>
                  {result.missing.length ? (
                    <div className="jm-chips">
                      {result.missing.map((s) => <Chip key={s} label={s} variant="missing" />)}
                    </div>
                  ) : (
                    <p className="jm-empty jm-empty--positive">No missing skills — great coverage!</p>
                  )}
                </article>

              </div>
            </div>
          )}

          {/* ---- Breakdown tab ---- */}
          {activeTab === 'breakdown' && (
            <div className="jm-tab-panel" role="tabpanel">
              {/* Scoring explainer */}
              <div className="jm-explainer">
                <strong>How the score is calculated:</strong> each required skill is worth 2 points.
                Exact matches earn 2 pts · Partial matches earn 1 pt · Missing earn 0 pts.
                Score = achieved ÷ maximum × 100.
              </div>

              {/* Bar summary */}
              <div className="jm-bar-summary">
                <div className="jm-bar-row">
                  <span className="jm-bar-label">Matched ({result.matched.length})</span>
                  <MiniBar value={matchedPct} color="var(--green)" />
                  <span className="jm-bar-pct">{matchedPct}%</span>
                </div>
                <div className="jm-bar-row">
                  <span className="jm-bar-label">Partial ({result.partial.length})</span>
                  <MiniBar value={partialPct} color="var(--amber)" />
                  <span className="jm-bar-pct">{partialPct}%</span>
                </div>
                <div className="jm-bar-row">
                  <span className="jm-bar-label">Missing ({result.missing.length})</span>
                  <MiniBar value={missingPct} color="var(--red)" />
                  <span className="jm-bar-pct">{missingPct}%</span>
                </div>
              </div>

              {/* Per-category breakdown */}
              <div className="jm-breakdown-grid">
                {Object.entries(result.breakdown || {}).map(([cat, data]) => {
                  const total = data.matched.length + data.partial.length + data.missing.length
                  if (total === 0) return null
                  const pct = Math.round(
                    ((data.matched.length * 2 + data.partial.length) / (total * 2)) * 100
                  )
                  return (
                    <article key={cat} className="jm-breakdown-card">
                      <div className="jm-breakdown-header">
                        <span className="jm-breakdown-cat">{cat}</span>
                        <span
                          className="jm-breakdown-pct"
                          style={{ color: pct >= 75 ? 'var(--green)' : pct >= 40 ? 'var(--amber)' : 'var(--red)' }}
                        >
                          {pct}%
                        </span>
                      </div>
                      {data.matched.length > 0 && (
                        <div className="jm-breakdown-row">
                          <span className="jm-breakdown-row-label jm-breakdown-row-label--green">✓ Matched</span>
                          <div className="jm-chips jm-chips--sm">
                            {data.matched.map((s) => <Chip key={s} label={s} variant="matched" />)}
                          </div>
                        </div>
                      )}
                      {data.partial.length > 0 && (
                        <div className="jm-breakdown-row">
                          <span className="jm-breakdown-row-label jm-breakdown-row-label--amber">~ Partial</span>
                          <div className="jm-chips jm-chips--sm">
                            {data.partial.map((s) => <Chip key={s} label={s} variant="partial" />)}
                          </div>
                        </div>
                      )}
                      {data.missing.length > 0 && (
                        <div className="jm-breakdown-row">
                          <span className="jm-breakdown-row-label jm-breakdown-row-label--red">✗ Missing</span>
                          <div className="jm-chips jm-chips--sm">
                            {data.missing.map((s) => <Chip key={s} label={s} variant="missing" />)}
                          </div>
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            </div>
          )}

          {/* ---- Suggestions tab ---- */}
          {activeTab === 'suggestions' && (
            <div className="jm-tab-panel" role="tabpanel">
              {result.suggestions.length ? (
                <ul className="jm-suggestions-list">
                  {result.suggestions.map((s, i) => (
                    <li key={i} className="jm-suggestion-item">
                      <span className="jm-suggestion-icon" aria-hidden="true">💡</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="jm-empty jm-empty--positive">No specific suggestions — your resume looks great for this role!</p>
              )}
            </div>
          )}

          {/* ---- History tab ---- */}
          {activeTab === 'history' && (
            <div className="jm-tab-panel" role="tabpanel">
              {historyLoading ? (
                <p className="jm-empty">Loading history…</p>
              ) : history.length ? (
                <div className="jm-history-list">
                  {history.map((entry) => (
                    <HistoryRow
                      key={entry.id}
                      entry={entry}
                      onLoad={handleLoadHistory}
                      onDelete={handleDeleteHistory}
                    />
                  ))}
                </div>
              ) : (
                <p className="jm-empty">No previous matches saved yet.</p>
              )}
            </div>
          )}

        </section>
      )}

      {/* History panel when no result is showing yet */}
      {!result && (
        <section className="jm-history-standalone" aria-label="Previous matches">
          <div className="jm-history-standalone-header">
            <span className="jm-history-standalone-title">Previous matches</span>
            <button className="btn-ghost btn-sm" onClick={fetchHistory} title="Refresh history">↺</button>
          </div>
          {historyLoading ? (
            <p className="jm-empty">Loading…</p>
          ) : history.length ? (
            <div className="jm-history-list">
              {history.map((entry) => (
                <HistoryRow
                  key={entry.id}
                  entry={entry}
                  onLoad={(e) => { handleLoadHistory(e); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                  onDelete={handleDeleteHistory}
                />
              ))}
            </div>
          ) : (
            <p className="jm-empty">No previous matches yet. Run your first analysis above.</p>
          )}
        </section>
      )}

    </div>
  )
}
