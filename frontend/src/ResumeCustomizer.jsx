import { useState, useEffect, useRef } from 'react'
import './ResumeCustomizer.css'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ScoreBadge({ score }) {
  const color = score >= 75 ? '#278c78' : score >= 50 ? '#d97706' : '#c0392b'
  return (
    <span style={{ color, fontWeight: 800, fontSize: 15, fontFamily: 'Manrope, sans-serif' }}>
      {score}%
    </span>
  )
}

function ScoreComparison({ before, after }) {
  const delta = after - before
  return (
    <div className="rc-score-row">
      <div className="rc-score-box rc-score-box--before">
        <span className="rc-score-num">{before}%</span>
        <span className="rc-score-lbl">ORIGINAL ATS SCORE</span>
      </div>
      <div>
        <div className="rc-score-arrow">→</div>
        <div className="rc-score-delta" style={{ color: delta >= 0 ? '#278c78' : '#c0392b' }}>
          {delta >= 0 ? `+${delta}` : delta}
        </div>
      </div>
      <div className="rc-score-box rc-score-box--after">
        <span className="rc-score-num">{after}%</span>
        <span className="rc-score-lbl">CUSTOMISED ATS SCORE</span>
      </div>
    </div>
  )
}

function Chip({ label, variant = 'neutral' }) {
  return <span className={`rc-chip rc-chip--${variant}`}>{label}</span>
}

function Steps({ current }) {
  const steps = ['Input', 'Customizing', 'Review & Edit', 'Download']
  return (
    <div className="rc-steps" aria-label="Progress">
      {steps.map((s, i) => {
        const done   = i < current
        const active = i === current
        return (
          <div key={s} style={{ display: 'flex', alignItems: 'center' }}>
            <div className={`rc-step ${active ? 'rc-step--active' : ''} ${done ? 'rc-step--done' : ''}`}>
              <span className="rc-step-num">{done ? '✓' : i + 1}</span>
              {s}
            </div>
            {i < steps.length - 1 && <div className="rc-step-sep" />}
          </div>
        )
      })}
    </div>
  )
}

function HistoryRow({ entry, onLoad, onDelete }) {
  const date = new Date(entry.created_at).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  })
  const delta = entry.after_score - entry.before_score
  return (
    <div className="rc-history-row">
      <div className="rc-history-left">
        <span className="rc-history-score">
          <ScoreBadge score={entry.after_score} />
        </span>
        <div className="rc-history-meta">
          <span className="rc-history-name">
            {entry.job_title || 'Untitled role'}{entry.candidate_name ? ` · ${entry.candidate_name}` : ''}
          </span>
          <span className="rc-history-sub">
            {date} · {entry.before_score}% → {entry.after_score}% ({delta >= 0 ? '+' : ''}{delta})
          </span>
        </div>
      </div>
      <div className="rc-history-actions">
        <button className="rc-btn-ghost rc-btn-sm" onClick={() => onLoad(entry.id)}>Load</button>
        <button className="rc-btn-ghost rc-btn-sm rc-btn-ghost--danger" onClick={() => onDelete(entry.id)}>✕</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section editors
// ---------------------------------------------------------------------------

function SummaryEditor({ value, original, onChange, onRegenerate, regenerating }) {
  return (
    <div className="rc-section-card">
      <div className="rc-section-header">
        <span className="rc-section-title">Professional Summary</span>
        <div className="rc-section-actions">
          <button className="rc-btn-secondary" onClick={onRegenerate} disabled={regenerating}>
            {regenerating ? '…' : '↺ Regenerate'}
          </button>
        </div>
      </div>
      <div className="rc-section-card--compare">
        <div className="rc-compare-col rc-compare-col--original">
          <h4>Original</h4>
          <div className="rc-original-text">{original || '(none detected)'}</div>
        </div>
        <div className="rc-compare-col rc-compare-col--custom">
          <h4>Customised — editable</h4>
          <textarea
            className="rc-editable-area"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label="Customised professional summary"
          />
        </div>
      </div>
    </div>
  )
}

function ExperienceEditor({ bullets, originalBullets, onChange }) {
  return (
    <div className="rc-section-card">
      <div className="rc-section-header">
        <span className="rc-section-title">Work Experience Bullets</span>
        <span style={{ color: '#9aa6b1', fontSize: 12 }}>Edit each bullet individually</span>
      </div>
      <div className="rc-section-card--compare">
        <div className="rc-compare-col rc-compare-col--original">
          <h4>Original</h4>
          {originalBullets.length
            ? originalBullets.map((b, i) => (
                <div key={i} className="rc-original-text" style={{ marginBottom: 8 }}>• {b}</div>
              ))
            : <div className="rc-original-text">(none detected)</div>}
        </div>
        <div className="rc-compare-col rc-compare-col--custom">
          <h4>Customised — editable</h4>
          {bullets.map((bullet, i) => (
            <textarea
              key={i}
              className="rc-editable-area rc-editable-area--bullets"
              style={{ marginBottom: 8, minHeight: 56 }}
              value={bullet}
              onChange={(e) => {
                const updated = [...bullets]
                updated[i] = e.target.value
                onChange(updated)
              }}
              aria-label={`Experience bullet ${i + 1}`}
            />
          ))}
          {bullets.length === 0 && (
            <p className="rc-empty">No experience bullets extracted from resume.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function SkillsEditor({ prioritised, additional, missing, onChange }) {
  // Flatten for editing — user edits comma-separated strings per category
  const allCats = [...new Set([
    ...Object.keys(prioritised),
    ...Object.keys(additional),
  ])]

  function updateCat(cat, value, isPrioritised) {
    const skills = value.split(',').map((s) => s.trim()).filter(Boolean)
    if (isPrioritised) {
      onChange({ prioritised: { ...prioritised, [cat]: skills }, additional })
    } else {
      onChange({ prioritised, additional: { ...additional, [cat]: skills } })
    }
  }

  return (
    <div className="rc-section-card">
      <div className="rc-section-header">
        <span className="rc-section-title">Skills</span>
        <span style={{ color: '#9aa6b1', fontSize: 12 }}>Comma-separated · never add skills you don't have</span>
      </div>

      {allCats.map((cat) => (
        <div key={cat} style={{ marginBottom: 18 }}>
          <div className="rc-label" style={{ marginBottom: 6 }}>
            {cat}
            {prioritised[cat]?.length ? (
              <span style={{ marginLeft: 8, color: '#278c78', fontSize: 11, fontWeight: 600 }}>
                ★ Relevant to this role
              </span>
            ) : null}
          </div>
          <input
            className="rc-input"
            value={[
              ...(prioritised[cat] || []),
              ...(additional[cat]  || []),
            ].join(', ')}
            onChange={(e) => updateCat(cat, e.target.value, Boolean(prioritised[cat]?.length))}
            aria-label={`${cat} skills`}
          />
        </div>
      ))}

      {missing.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="rc-label" style={{ color: '#c0392b', marginBottom: 6 }}>
            Missing from resume (do not add unless you have this experience)
          </div>
          <div className="rc-chips">
            {missing.map((s) => <Chip key={s} label={s} variant="red" />)}
          </div>
        </div>
      )}
    </div>
  )
}

function EducationEditor({ education, onChange }) {
  return (
    <div className="rc-section-card">
      <div className="rc-section-header">
        <span className="rc-section-title">Education</span>
        <span style={{ color: '#9aa6b1', fontSize: 12 }}>One entry per line</span>
      </div>
      <textarea
        className="rc-editable-area"
        value={education.join('\n')}
        rows={Math.max(3, education.length + 1)}
        onChange={(e) => onChange(e.target.value.split('\n').filter((l) => l.trim()))}
        aria-label="Education entries"
      />
    </div>
  )
}

function CertificationsEditor({ certifications, onChange }) {
  return (
    <div className="rc-section-card">
      <div className="rc-section-header">
        <span className="rc-section-title">Certifications</span>
        <span style={{ color: '#9aa6b1', fontSize: 12 }}>One certification per line</span>
      </div>
      <textarea
        className="rc-editable-area"
        value={certifications.join('\n')}
        rows={Math.max(3, certifications.length + 1)}
        onChange={(e) => onChange(e.target.value.split('\n').filter((l) => l.trim()))}
        aria-label="Certification entries"
        placeholder="e.g. AWS Certified Solutions Architect – Associate (2024)"
      />
    </div>
  )
}

function ProjectsEditor({ projects, onChange }) {
  return (
    <div className="rc-section-card">
      <div className="rc-section-header">
        <span className="rc-section-title">Projects</span>
        <span style={{ color: '#9aa6b1', fontSize: 12 }}>One project per line</span>
      </div>
      <textarea
        className="rc-editable-area"
        value={projects.join('\n')}
        rows={Math.max(3, projects.length + 1)}
        onChange={(e) => onChange(e.target.value.split('\n').filter((l) => l.trim()))}
        aria-label="Project entries"
        placeholder="e.g. E-commerce platform built with React.js and Node.js — increased conversion by 15%"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ResumeCustomizer({ resumeAnalysis }) {
  // Input state
  const [jobTitle, setJobTitle]           = useState('')
  const [jobDesc, setJobDesc]             = useState('')
  const [candidateName, setCandidateName] = useState('')
  const [contactInfo, setContactInfo]     = useState('')
  const [yearsExp, setYearsExp]           = useState('')
  const [extraFile, setExtraFile]         = useState(null)

  // Flow state
  const [step, setStep]           = useState(0)   // 0=input 1=loading 2=review 3=done
  const [result, setResult]       = useState(null)
  const [savedId, setSavedId]     = useState(null)
  const [error, setError]         = useState('')
  const [activeTab, setActiveTab] = useState('summary')

  // Editable customized content
  const [editSummary,        setEditSummary]        = useState('')
  const [editBullets,        setEditBullets]        = useState([])
  const [editSkills,         setEditSkills]         = useState({ prioritised: {}, additional: {} })
  const [editEducation,      setEditEducation]      = useState([])
  const [editCertifications, setEditCertifications] = useState([])
  const [editProjects,       setEditProjects]       = useState([])
  const [editContact,        setEditContact]        = useState('')

  // Raw resume text — preserved so the PDF endpoint can re-classify sections
  const [rawResumeText, setRawResumeText] = useState('')

  // Loading states
  const [downloading,  setDownloading]  = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  // History
  const [history,     setHistory]     = useState([])
  const [histLoading, setHistLoading] = useState(false)

  const topRef = useRef(null)

  useEffect(() => { fetchHistory() }, [])

  function scrollTop() {
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function fetchHistory() {
    setHistLoading(true)
    try {
      const res = await fetch('/api/customize/history')
      if (res.ok) setHistory(await res.json())
    } catch { /* silent */ }
    finally { setHistLoading(false) }
  }

  function populateEditors(data) {
    setEditSummary(data.summary   || '')
    setEditBullets(data.experience_bullets || [])
    setEditSkills({ prioritised: data.skills_prioritised || {}, additional: data.skills_additional || {} })
    setEditEducation(data.education || [])
    setEditCertifications(data.certifications || [])
    setEditProjects(data.projects || [])
    setEditContact(data.contact_info || data.contact_info_parsed || contactInfo)
    if (data.raw_resume_text) setRawResumeText(data.raw_resume_text)
  }

  async function handleCustomize(e) {
    e.preventDefault()
    setError('')

    const hasAnalysis = resumeAnalysis && Object.values(resumeAnalysis.skills || {}).some((a) => a.length > 0)
    if (!hasAnalysis && !extraFile) {
      setError('Upload a PDF resume or analyse your resume on the Resume Analyzer tab first.')
      return
    }
    if (!jobDesc.trim() || jobDesc.trim().length < 30) {
      setError('Paste a complete job description (at least 30 characters).')
      return
    }

    setStep(1)
    scrollTop()

    try {
      const form = new FormData()
      if (extraFile) form.append('file', extraFile)

      // If we already have analysis, send it directly (no re-upload needed)
      if (resumeAnalysis) {
        form.append('resume_text',       '')
        form.append('resume_skills',     JSON.stringify(resumeAnalysis.skills     || {}))
        form.append('resume_education',  JSON.stringify(resumeAnalysis.education  || []))
        form.append('resume_experience', JSON.stringify(resumeAnalysis.experience || []))
      }

      form.append('job_description',  jobDesc)
      form.append('job_title',        jobTitle)
      form.append('candidate_name',   candidateName)
      form.append('contact_info',     contactInfo)
      form.append('years_experience', yearsExp)

      const res  = await fetch('/api/customize', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Customization failed.')

      setResult(data)
      setSavedId(data.id)
      populateEditors(data)
      setStep(2)
      setActiveTab('summary')
      fetchHistory()
      scrollTop()
    } catch (err) {
      setError(err.message)
      setStep(0)
    }
  }

  async function handleSaveEdits() {
    if (!savedId) return
    setSaving(true)
    try {
      const res = await fetch(`/api/customize/${savedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary:            editSummary,
          skills_prioritised: editSkills.prioritised,
          skills_additional:  editSkills.additional,
          experience_bullets: editBullets,
          education:          editEducation,
          certifications:     editCertifications,
          projects:           editProjects,
          contact_info:       editContact,
        }),
      })
      if (!res.ok) throw new Error('Save failed.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDownload() {
    if (!savedId) return
    setDownloading(true)
    setError('')
    try {
      const res = await fetch(`/api/customize/${savedId}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate_name:     candidateName,
          summary:            editSummary,
          skills_prioritised: editSkills.prioritised,
          skills_additional:  editSkills.additional,
          experience_bullets: editBullets,
          education:          editEducation,
          certifications:     editCertifications,
          projects:           editProjects,
          contact_info:       editContact,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Download failed.')
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `${(candidateName || 'resume').replace(/\s+/g, '_')}_resume.pdf`
      a.click()
      URL.revokeObjectURL(url)
      setStep(3)
    } catch (err) {
      setError(err.message)
    } finally {
      setDownloading(false)
    }
  }

  async function handleLoadHistory(id) {
    setError('')
    try {
      const res  = await fetch(`/api/customize/${id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load.')
      setResult(data)
      setSavedId(data.id)
      setJobTitle(data.job_title || '')
      setCandidateName(data.candidate_name || '')
      setContactInfo(data.contact_info || '')
      populateEditors(data)
      setStep(2)
      setActiveTab('summary')
      scrollTop()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDeleteHistory(id) {
    try {
      await fetch(`/api/customize/${id}`, { method: 'DELETE' })
      setHistory((prev) => prev.filter((h) => h.id !== id))
      if (savedId === id) { setStep(0); setResult(null); setSavedId(null) }
    } catch { /* silent */ }
  }

  function handleNewCustomization() {
    setStep(0); setResult(null); setSavedId(null)
    setEditSummary(''); setEditBullets([])
    setEditSkills({ prioritised: {}, additional: {} })
    setEditEducation([]); setEditCertifications([])
    setEditProjects([]); setRawResumeText('')
    setError('')
  }

  // ---- Render ----
  return (
    <div className="rc-shell" ref={topRef}>

      <div className="rc-eyebrow"><span className="eyebrow-dot" /> AI RESUME CUSTOMIZER</div>
      <h2 className="rc-heading">Tailor your resume to any job</h2>
      <p className="rc-subheading">
        Paste a job description and we'll rewrite your summary, prioritise relevant skills, and
        strengthen your experience bullets — then generate a downloadable ATS-friendly PDF.
      </p>

      <Steps current={step} />

      {/* ---- Step 0: Input form ---- */}
      {step === 0 && (
        <>
          {/* Resume status */}
          {resumeAnalysis ? (
            <div className="rc-banner rc-banner--ok">
              <span>✓</span>
              Resume loaded — <strong>{resumeAnalysis.filename}</strong>
              &nbsp;·&nbsp;{Object.values(resumeAnalysis.skills || {}).flat().length} skills
            </div>
          ) : (
            <div className="rc-banner rc-banner--warn">
              <span>⚠</span>
              No resume analysed. Analyse your resume first, or upload a PDF below.
            </div>
          )}

          <form className="rc-input-card" onSubmit={handleCustomize}>
            <div className="rc-input-grid">

              {/* Upload a fresh PDF (optional override) */}
              <div className="rc-field">
                <label className="rc-label">
                  Resume PDF <span className="rc-label-hint">(optional — uses analyzed resume if omitted)</span>
                </label>
                <label className={`rc-upload-zone ${extraFile ? 'has-file' : ''}`} htmlFor="rc-file-input">
                  <span className="rc-upload-icon" aria-hidden="true">↑</span>
                  <span className="rc-upload-title">{extraFile ? extraFile.name : 'Upload a PDF'}</span>
                  <span className="rc-upload-sub">PDF · up to 10 MB</span>
                  <input
                    id="rc-file-input" type="file" accept="application/pdf,.pdf"
                    onChange={(e) => { setExtraFile(e.target.files?.[0] || null); setError('') }}
                  />
                </label>
              </div>

              {/* Job description */}
              <div className="rc-field">
                <label className="rc-label" htmlFor="rc-job-desc">
                  Job description <span style={{ color: '#c0392b' }}>*</span>
                </label>
                <textarea
                  id="rc-job-desc" className="rc-textarea"
                  placeholder="Paste the full job description here…"
                  value={jobDesc} rows={8}
                  onChange={(e) => { setJobDesc(e.target.value); setError('') }}
                  required aria-required="true"
                />
              </div>

              <div className="rc-field">
                <label className="rc-label" htmlFor="rc-job-title">
                  Job title <span className="rc-label-hint">(optional)</span>
                </label>
                <input
                  id="rc-job-title" className="rc-input" type="text"
                  placeholder="e.g. Senior Full Stack Developer"
                  value={jobTitle} maxLength={200}
                  onChange={(e) => setJobTitle(e.target.value)}
                />
              </div>

              <div className="rc-field">
                <label className="rc-label" htmlFor="rc-name">
                  Your name <span className="rc-label-hint">(for the PDF header)</span>
                </label>
                <input
                  id="rc-name" className="rc-input" type="text"
                  placeholder="e.g. Alex Johnson"
                  value={candidateName} maxLength={100}
                  onChange={(e) => setCandidateName(e.target.value)}
                />
              </div>

              <div className="rc-field">
                <label className="rc-label" htmlFor="rc-contact">
                  Contact info <span className="rc-label-hint">(email · phone · LinkedIn)</span>
                </label>
                <input
                  id="rc-contact" className="rc-input" type="text"
                  placeholder="alex@email.com · +1 555 000 0000"
                  value={contactInfo} maxLength={300}
                  onChange={(e) => setContactInfo(e.target.value)}
                />
              </div>

              <div className="rc-field">
                <label className="rc-label" htmlFor="rc-years">
                  Years of experience <span className="rc-label-hint">(optional)</span>
                </label>
                <input
                  id="rc-years" className="rc-input" type="text"
                  placeholder="e.g. 3"
                  value={yearsExp} maxLength={3}
                  onChange={(e) => setYearsExp(e.target.value.replace(/\D/g, ''))}
                />
              </div>
            </div>

            {error && <p className="rc-error" role="alert">{error}</p>}

            <div style={{ marginTop: 24 }}>
              <button className="rc-btn-primary rc-btn-primary--full" type="submit">
                Customise resume →
              </button>
            </div>
          </form>

          {/* History */}
          <div className="rc-history">
            <div className="rc-history-header">
              <span className="rc-history-title">Previous customizations</span>
              <button className="rc-btn-ghost rc-btn-sm" onClick={fetchHistory}>↺</button>
            </div>
            {histLoading
              ? <p className="rc-empty">Loading…</p>
              : history.length
                ? history.map((h) => (
                    <HistoryRow key={h.id} entry={h}
                      onLoad={handleLoadHistory} onDelete={handleDeleteHistory} />
                  ))
                : <p className="rc-empty">No previous customizations yet.</p>
            }
          </div>
        </>
      )}

      {/* ---- Step 1: Loading ---- */}
      {step === 1 && (
        <div className="rc-loading-wrap">
          <div className="rc-loading-spinner" />
          <p className="rc-loading-text">Customising your resume…</p>
          <p className="rc-loading-sub">Analysing job requirements · Rewriting content · Scoring ATS fit</p>
        </div>
      )}

      {/* ---- Step 2: Review & Edit ---- */}
      {step >= 2 && result && (
        <div className="rc-results">

          {/* Score comparison */}
          <ScoreComparison before={result.before_score} after={result.after_score} />

          {/* ATS disclaimer */}
          <div className="rc-ats-explainer">
            <strong>ATS score estimate:</strong> based on keyword matching between your resume and the job description.
            Scores are indicative — different ATS systems use different algorithms. Always review content before applying.
          </div>

          {/* Tabs */}
          <div className="rc-tabs" role="tablist">
            {[
              { id: 'summary',          label: 'Summary'        },
              { id: 'experience',       label: 'Experience'     },
              { id: 'skills',           label: 'Skills'         },
              { id: 'education',        label: 'Education'      },
              { id: 'certifications',   label: 'Certifications' },
              { id: 'projects',         label: 'Projects'       },
              { id: 'keywords',         label: 'Keywords'       },
              { id: 'improvements',     label: 'What changed'   },
            ].map((t) => (
              <button
                key={t.id} role="tab"
                aria-selected={activeTab === t.id}
                className={`rc-tab ${activeTab === t.id ? 'rc-tab--active' : ''}`}
                onClick={() => setActiveTab(t.id)}
              >{t.label}</button>
            ))}
          </div>

          {error && <p className="rc-error" role="alert">{error}</p>}

          {/* ---- Summary tab ---- */}
          {activeTab === 'summary' && (
            <SummaryEditor
              value={editSummary}
              original="(extracted from your resume)"
              onChange={setEditSummary}
              onRegenerate={() => {/* already set from result */}}
              regenerating={regenerating}
            />
          )}

          {/* ---- Experience tab ---- */}
          {activeTab === 'experience' && (
            <ExperienceEditor
              bullets={editBullets}
              originalBullets={resumeAnalysis?.experience || result.experience_bullets}
              onChange={setEditBullets}
            />
          )}

          {/* ---- Skills tab ---- */}
          {activeTab === 'skills' && (
            <SkillsEditor
              prioritised={editSkills.prioritised}
              additional={editSkills.additional}
              missing={result.skills_missing || []}
              onChange={setEditSkills}
            />
          )}

          {/* ---- Education tab ---- */}
          {activeTab === 'education' && (
            <EducationEditor
              education={editEducation}
              onChange={setEditEducation}
            />
          )}

          {/* ---- Certifications tab ---- */}
          {activeTab === 'certifications' && (
            <CertificationsEditor
              certifications={editCertifications}
              onChange={setEditCertifications}
            />
          )}

          {/* ---- Projects tab ---- */}
          {activeTab === 'projects' && (
            <ProjectsEditor
              projects={editProjects}
              onChange={setEditProjects}
            />
          )}

          {/* ---- Keywords tab ---- */}
          {activeTab === 'keywords' && (
            <div className="rc-section-card">
              <div className="rc-section-header">
                <span className="rc-section-title">ATS Keyword Analysis</span>
              </div>
              <div className="rc-kw-grid">
                <div className="rc-kw-col rc-kw-col--present">
                  <h4>✓ Matched ({result.matched_keywords?.length || 0})</h4>
                  <div className="rc-chips">
                    {(result.matched_keywords || []).map((k) => (
                      <Chip key={k} label={k} variant="green" />
                    ))}
                    {!result.matched_keywords?.length && <span className="rc-empty">None</span>}
                  </div>
                </div>
                <div className="rc-kw-col rc-kw-col--added">
                  <h4>+ Added by summary ({result.added_keywords?.length || 0})</h4>
                  <div className="rc-chips">
                    {(result.added_keywords || []).map((k) => (
                      <Chip key={k} label={k} variant="amber" />
                    ))}
                    {!result.added_keywords?.length && <span className="rc-empty">None</span>}
                  </div>
                </div>
                <div className="rc-kw-col rc-kw-col--missing">
                  <h4>✗ Missing ({result.missing_keywords?.length || 0})</h4>
                  <div className="rc-chips">
                    {(result.missing_keywords || []).map((k) => (
                      <Chip key={k} label={k} variant="red" />
                    ))}
                    {!result.missing_keywords?.length && <span className="rc-empty">None</span>}
                  </div>
                  {result.missing_keywords?.length > 0 && (
                    <p style={{ marginTop: 10, fontSize: 12, color: '#9aa6b1' }}>
                      Only add these to your resume if you genuinely have this experience.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ---- What changed tab ---- */}
          {activeTab === 'improvements' && (
            <div className="rc-section-card">
              <div className="rc-section-header">
                <span className="rc-section-title">What the customiser changed</span>
              </div>
              <div className="rc-improvements">
                {(result.improvements || []).map((item, i) => (
                  <div key={i} className="rc-improvement-item">
                    <span className="rc-improvement-icon">✓</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Download bar */}
          <div className="rc-download-bar">
            <div className="rc-download-info">
              <h3>Ready to download</h3>
              <p>Save your edits then generate a clean, ATS-friendly PDF.</p>
            </div>
            <div className="rc-download-actions">
              <button
                className="rc-btn-secondary"
                onClick={handleSaveEdits}
                disabled={saving || !savedId}
              >
                {saving ? 'Saving…' : '💾 Save edits'}
              </button>
              <button
                className="rc-btn-download"
                onClick={handleDownload}
                disabled={downloading || !savedId}
              >
                {downloading
                  ? <><span className="spinner" /> Generating…</>
                  : <><span>↓</span> Download PDF</>}
              </button>
              <button className="rc-btn-secondary" onClick={handleNewCustomization}>
                + New customization
              </button>
            </div>
          </div>

        </div>
      )}

      {/* ---- Step 3: Done ---- */}
      {step === 3 && (
        <div className="rc-results">
          <div className="rc-banner rc-banner--ok" style={{ marginBottom: 20 }}>
            <span>✓</span>
            <strong>PDF downloaded!</strong> Your customised resume has been saved to your downloads folder.
          </div>
          <ScoreComparison before={result?.before_score || 0} after={result?.after_score || 0} />
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <button className="rc-btn-primary" onClick={() => setStep(2)}>← Back to editor</button>
            <button className="rc-btn-secondary" onClick={handleNewCustomization}>+ New customization</button>
          </div>
        </div>
      )}

    </div>
  )
}
