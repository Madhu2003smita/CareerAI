# CareerAI

A full-stack AI-powered career assistant that helps job seekers tailor their resumes, match skills to job descriptions, generate interview questions, and produce ATS-friendly PDF resumes.

---

## Features

### Resume Analyzer
- Upload a PDF resume and extract skills, education, and work experience
- Categorises skills into Frontend, Backend, Database, Programming Languages, and Tools
- Detects education entries and employment history automatically

### Job Matcher
- Paste any job description and compare it against your resume
- Synonym-normalised ATS keyword matching (React / React.js, Node / Node.js, REST / REST API, etc.)
- Shows matched, partially matched, and missing skills with a percentage score
- Provides actionable suggestions to improve your match rate

### Resume Customizer
- Generates a targeted professional summary based on the actual job description
- Rewrites experience bullets with strong action verbs
- Prioritises relevant skills from the job description
- Calculates independent before and after ATS scores
- Correctly classifies resume sections: Summary, Skills, Experience, Projects, Education, Certifications
- Downloads a clean, single-column ATS-friendly PDF via ReportLab

### Interview Prep
- Generates personalised interview questions based on your resume skills and the job description
- Covers React, JavaScript, Node.js, Python, SQL, Full Stack, and HR & Behavioral topics
- Supports beginner, intermediate, and advanced difficulty levels
- Evaluates your answers and returns a score with feedback and improvement tips

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, CSS |
| Backend | Node.js, Express.js, SQLite (better-sqlite3) |
| Python Service | FastAPI, pypdf, ReportLab |
| PDF Generation | ReportLab |
| PDF Parsing | pypdf |

---

## Project Structure

```
career-ai/
├── frontend/               # React + Vite SPA
│   └── src/
│       ├── App.jsx
│       ├── ResumeCustomizer.jsx
│       ├── JobMatcher.jsx
│       └── InterviewPrep.jsx
├── backend/                # Express.js API + SQLite
│   ├── server.js
│   └── package.json
└── python-service/         # FastAPI microservice
    ├── main.py
    └── requirements.txt
```

---

## Getting Started

### Prerequisites
- Node.js 18+
- Python 3.11+

### 1. Python Service

```bash
cd python-service
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 2. Backend

```bash
cd backend
npm install
node server.js
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Environment

The backend proxies requests to the Python service. By default:

| Service | Port |
|---|---|
| Frontend (Vite) | 5173 |
| Backend (Express) | 5000 |
| Python (FastAPI) | 8000 |

---

## API Endpoints

### Python Service (`/`)
| Method | Path | Description |
|---|---|---|
| POST | `/analyze-resume` | Extract skills, education, experience from PDF |
| POST | `/match-job` | Compare resume skills to a job description |
| POST | `/customize-resume` | Generate customised resume content |
| POST | `/generate-pdf` | Build and return ATS-friendly PDF |
| POST | `/generate-questions` | Generate interview questions |
| POST | `/evaluate-answer` | Score a candidate answer |

### Backend (`/api`)
| Method | Path | Description |
|---|---|---|
| POST | `/api/analyze` | Upload and analyse a resume PDF |
| POST | `/api/match` | Match resume to a job description |
| POST | `/api/customize` | Run resume customisation |
| PATCH | `/api/customize/:id` | Save edited customisation |
| GET | `/api/customize/history` | List past customisations |
| GET | `/api/customize/:id` | Load a specific customisation |
| DELETE | `/api/customize/:id` | Delete a customisation |
| POST | `/api/customize/:id/download` | Generate and download PDF |

---

## License

MIT
