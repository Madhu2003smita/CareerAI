import { useState } from 'react'
import './App.css'
import JobMatcher from './JobMatcher.jsx'
import InterviewPrep from './InterviewPrep.jsx'
import ResumeCustomizer from './ResumeCustomizer.jsx'

const SKILL_CATEGORIES = [
  'Frontend',
  'Backend',
  'Database',
  'Programming Languages',
  'Tools',
]

// ---------------------------------------------------------------------------
// Resume Analyzer page
// ---------------------------------------------------------------------------

function ResumeAnalyzer({ analysis, onAnalysisComplete }) {
  const [file, setFile]       = useState(null)
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    if (!file) { setError('Choose a PDF resume first.'); return }

    setLoading(true)
    setError('')
    const form = new FormData()
    form.append('file', file)

    try {
      const response = await fetch('/api/analyze-resume', { method: 'POST', body: form })
      const result   = await response.json()
      if (!response.ok) throw new Error(result.error || 'Resume analysis failed.')
      onAnalysisComplete(result)
    } catch (err) {
      setError(err.message || 'Could not connect to the backend.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <section className="hero">
        <div className="eyebrow"><span className="eyebrow-dot" /> AI RESUME ANALYZER</div>
        <h1>Make your next move<br /><span>with confidence.</span></h1>
        <p className="hero-copy">
          Upload your resume to extract skills, education, and experience.
          Then use <strong>Job Matcher</strong>, <strong>Interview Prep</strong>, or <strong>Resume Customizer</strong>.
        </p>

        <form className="upload-card" onSubmit={handleSubmit}>
          <label className={`dropzone ${file ? 'has-file' : ''}`} htmlFor="resume-file">
            <span className="upload-icon" aria-hidden="true">↑</span>
            <span className="drop-title">{file ? file.name : 'Choose your resume'}</span>
            <span className="drop-subtitle">PDF format · up to 10 MB</span>
            <input
              id="resume-file"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => { setFile(e.target.files?.[0] || null); setError('') }}
            />
          </label>
          <button className="analyze-button" type="submit" disabled={loading}>
            {loading
              ? <><span className="spinner" /> Analyzing resume…</>
              : <>Analyze resume <span aria-hidden="true">→</span></>}
          </button>
          {error && <p className="error-message" role="alert">{error}</p>}
        </form>
      </section>

      {analysis && (
        <section className="results" aria-live="polite">
          <div className="results-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-dot" /> YOUR RESUME SNAPSHOT</div>
              <h2>Here's what we found</h2>
            </div>
            <span className="file-badge">PDF · {analysis.filename}</span>
          </div>

          {!analysis.has_text && <p className="notice">{analysis.message}</p>}

          <div className="result-grid">
            <article className="result-card skills-card">
              <h3>
                Skills{' '}
                <span className="subtle">
                  {Object.values(analysis.skills || {}).flat().length} found
                </span>
              </h3>
              <div className="skill-categories">
                {SKILL_CATEGORIES.map((category) => {
                  const skills = analysis.skills?.[category] || []
                  return (
                    <div className="skill-row" key={category}>
                      <h4>{category}</h4>
                      {skills.length
                        ? <div className="chips">{skills.map((s) => <span className="chip" key={s}>{s}</span>)}</div>
                        : <span className="empty-value">No skills detected</span>}
                    </div>
                  )
                })}
              </div>
            </article>

            <article className="result-card">
              <h3>Education <span className="subtle">{analysis.education?.length || 0} entries</span></h3>
              {analysis.education?.length
                ? <ul className="detail-list">{analysis.education.map((item, i) => <li key={i}>{item}</li>)}</ul>
                : <p className="empty-state">No education section detected.</p>}
            </article>

            <article className="result-card">
              <h3>Work experience <span className="subtle">{analysis.experience?.length || 0} entries</span></h3>
              {analysis.experience?.length
                ? <ul className="detail-list">{analysis.experience.map((item, i) => <li key={i}>{item}</li>)}</ul>
                : <p className="empty-state">No experience section detected.</p>}
            </article>
          </div>

          <p className="disclaimer">
            Resume details are automatically detected from selectable PDF text and may need review.
          </p>
        </section>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Root App — shared state + four-tab navigation
// ---------------------------------------------------------------------------

export default function App() {
  const [analysis, setAnalysis] = useState(null)
  const [page, setPage]         = useState('analyzer')

  const NAV = [
    { id: 'analyzer',   label: 'Resume Analyzer'  },
    { id: 'matcher',    label: 'Job Matcher'       },
    { id: 'interview',  label: 'Interview Prep'    },
    { id: 'customizer', label: 'Resume Customizer' },
  ]

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="CareerAI home">
          <span className="brand-mark">C</span> Career<span>AI</span>
        </a>

        <nav className="topbar-nav" aria-label="Main navigation">
          {NAV.map((n) => (
            <button
              key={n.id}
              className={`nav-tab ${page === n.id ? 'nav-tab--active' : ''}`}
              onClick={() => setPage(n.id)}
              aria-current={page === n.id ? 'page' : undefined}
            >
              {n.label}
              {analysis && n.id !== 'analyzer' && (
                <span className="nav-badge" aria-label="Resume loaded" />
              )}
            </button>
          ))}
        </nav>
      </header>

      {page === 'analyzer'   && <ResumeAnalyzer analysis={analysis} onAnalysisComplete={setAnalysis} />}
      {page === 'matcher'    && <JobMatcher resumeAnalysis={analysis} />}
      {page === 'interview'  && <InterviewPrep resumeAnalysis={analysis} />}
      {page === 'customizer' && <ResumeCustomizer resumeAnalysis={analysis} />}

      <footer>CareerAI <span>·</span> Your next opportunity starts here.</footer>
    </main>
  )
}
