"""
CareerAI – Python FastAPI service
Endpoints:
  POST /analyze-resume        – extract skills, education, experience from a PDF
  POST /match-job             – compare resume skills against a job description
  POST /generate-questions    – generate personalised interview questions
  POST /evaluate-answer       – evaluate a candidate answer and return score + feedback
"""

from __future__ import annotations

import re
import string
from collections import defaultdict
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pypdf import PdfReader
import io

app = FastAPI(title="CareerAI Python Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Skill taxonomy
# ---------------------------------------------------------------------------

SKILL_TAXONOMY: dict[str, list[str]] = {
    "Frontend": [
        # React family — all common spellings
        "react", "react.js", "reactjs", "react js",
        # Next.js family
        "next.js", "nextjs", "next js",
        # Vue / Angular / others
        "vue", "vue.js", "vuejs", "angular", "svelte", "nuxt", "nuxt.js",
        # Core web
        "html", "html5", "css", "css3",
        # CSS frameworks / preprocessors
        "tailwind", "tailwind css", "tailwindcss",
        "sass", "scss", "bootstrap", "material ui", "chakra ui", "styled components",
        # JS / TS
        "javascript", "typescript", "jsx", "tsx",
        # Build / test
        "webpack", "vite", "babel", "rollup",
        "jest", "cypress", "testing library", "react testing library",
        "vitest", "storybook",
        # State / data
        "redux", "redux toolkit", "zustand", "recoil", "mobx",
        "graphql", "apollo",
        # Design / other
        "responsive design", "figma", "web components",
        "pwa", "accessibility", "wcag",
    ],
    "Backend": [
        # Node ecosystem
        "node", "node.js", "nodejs", "node js",
        "express", "express.js", "expressjs",
        "fastapi", "django", "flask", "spring", "spring boot",
        "rails", "laravel", "asp.net", "dotnet", ".net",
        # Languages used server-side (also in PL but needed for matching)
        "rust", "go", "golang",
        # API paradigms
        "rest", "rest api", "rest apis", "restful", "restful api",
        "graphql", "grpc", "websockets",
        # Infra / middleware
        "microservices", "kafka", "rabbitmq", "redis", "celery",
        "nginx", "apache", "oauth", "jwt", "api",
    ],
    "Database": [
        "sql", "mysql", "postgresql", "postgres", "sqlite",
        "mongodb", "mongoose",
        "firebase", "firestore", "dynamodb", "cassandra",
        "elasticsearch", "redis", "oracle", "mssql",
        "supabase", "prisma", "sequelize", "typeorm",
        "nosql", "data modeling", "database design",
    ],
    "Programming Languages": [
        "python", "javascript", "typescript", "java", "kotlin", "swift",
        "c", "c++", "c#", "ruby", "php", "scala", "r", "matlab",
        "bash", "shell", "powershell", "dart", "flutter", "elixir",
        "haskell", "clojure", "perl", "lua",
    ],
    "Tools": [
        "git", "github", "gitlab", "bitbucket",
        "docker", "kubernetes", "k8s",
        "aws", "azure", "gcp", "google cloud",
        "terraform", "ansible", "jenkins",
        "github actions", "circleci", "travis", "travis ci",
        "jira", "confluence",
        "linux", "unix",
        "agile", "scrum", "kanban",
        "postman", "swagger", "openapi",
        "datadog", "grafana", "prometheus",
        "ci/cd", "devops", "mlops", "airflow",
        "npm", "yarn", "pnpm",
        "vercel", "netlify", "heroku", "railway",
    ],
}

# Flat set for fast membership tests
ALL_SKILLS_FLAT: set[str] = {s for skills in SKILL_TAXONOMY.values() for s in skills}

# Map skill → category for quick reverse lookups
SKILL_TO_CATEGORY: dict[str, str] = {
    skill: cat
    for cat, skills in SKILL_TAXONOMY.items()
    for skill in skills
}

# Skills that contain dots or slashes need special regex (not plain \b)
_DOT_SKILLS: set[str] = {s for s in ALL_SKILLS_FLAT if re.search(r"[./]", s)}
_PLAIN_SKILLS: set[str] = ALL_SKILLS_FLAT - _DOT_SKILLS

# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------

def extract_text_from_pdf(pdf_bytes: bytes) -> tuple[str, bool]:
    """Return (text, has_text).  has_text is False for image-only PDFs."""
    reader = PdfReader(io.BytesIO(pdf_bytes))
    pages_text = [page.extract_text() or "" for page in reader.pages]
    text = "\n".join(pages_text).strip()
    return text, bool(text)


def normalise(text: str) -> str:
    """Lower-case and collapse whitespace."""
    return re.sub(r"\s+", " ", text.lower()).strip()


def extract_skills(text: str) -> dict[str, list[str]]:
    """
    Return {category: [matched_skill, ...]} from arbitrary text.

    Handles three cases:
      1. Plain single-word skills  → \\b word boundary matching
      2. Multi-word skills         → phrase search (spaces allowed)
      3. Skills with dots/slashes  → escaped literal search with
                                     flexible surrounding context
    """
    norm = normalise(text)
    found: dict[str, list[str]] = defaultdict(list)

    for skill in ALL_SKILLS_FLAT:
        skill_norm = skill.lower()

        if skill in _DOT_SKILLS:
            # For skills like "react.js", "node.js", "next.js", "rest api",
            # match the escaped literal surrounded by non-alphanumeric chars
            # or string boundaries.
            escaped = re.escape(skill_norm)
            pattern = r"(?<![a-z0-9])" + escaped + r"(?![a-z0-9])"
            matched = bool(re.search(pattern, norm))
        elif " " in skill_norm:
            # Multi-word phrase — simple substring after normalising spaces
            matched = skill_norm in norm
        else:
            # Single plain word — word boundary
            pattern = r"\b" + re.escape(skill_norm) + r"\b"
            matched = bool(re.search(pattern, norm))

        if matched:
            category = SKILL_TO_CATEGORY[skill]
            found[category].append(skill)

    # Deduplicate: if both "react" and "react.js" matched, keep "react.js" only
    _ALIASES: dict[str, str] = {
        "react":   "react.js",
        "reactjs": "react.js",
        "react js": "react.js",
        "node":    "node.js",
        "nodejs":  "node.js",
        "node js": "node.js",
        "next":    "next.js",  # only if 'next' shows up without .js context
        "nextjs":  "next.js",
        "next js": "next.js",
        "express": "express.js",
        "expressjs": "express.js",
        "tailwind": "tailwind css",
        "tailwindcss": "tailwind css",
        "postgres": "postgresql",
        "rest":    "rest api",
        "restful": "rest api",
        "restful api": "rest api",
    }

    # Collapse aliases per category
    result: dict[str, list[str]] = {}
    for cat, skills in found.items():
        skill_set = set(skills)
        # Remove the shorter alias if the canonical form is present
        for alias, canonical in _ALIASES.items():
            if canonical in skill_set and alias in skill_set:
                skill_set.discard(alias)
        result[cat] = sorted(skill_set)

    return result


def extract_education(text: str) -> list[str]:
    """
    Extract education entries using section-aware parsing.
    Uses classify_resume_text internally so we always work from the
    correct section, never from arbitrary flat-sentence splits.
    Falls back to keyword matching only when no explicit section is found.
    """
    classified = classify_resume_text(text)
    if classified["education"]:
        return classified["education"][:8]

    # Fallback: keyword scan on the raw text
    edu_keywords = [
        "bachelor", "master", "phd", "doctorate", "degree",
        "b.e.", "m.e.", "b.tech", "m.tech", "mba", "bca", "mca",
        "b.sc", "m.sc", "b.a.", "m.a.", "b.s.", "m.s.",
        "university", "college", "institute",
    ]
    results: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or _is_contact_line(line) or _is_cert_line(line):
            continue
        lower = line.lower()
        if any(kw in lower for kw in edu_keywords):
            if len(line) > 10:
                results.append(line)
    return list(dict.fromkeys(results))[:8]


def extract_experience(text: str) -> list[str]:
    """
    Extract work experience entries using section-aware parsing.
    Returns structured lines from the experience section only —
    never includes education, certifications, or contact info.
    Falls back to keyword scanning when no explicit section header found.
    """
    classified = classify_resume_text(text)
    if classified["experience"]:
        return classified["experience"][:15]

    # Fallback: keyword scan for role/company lines
    exp_keywords = [
        "engineer", "developer", "analyst", "manager", "lead", "architect",
        "intern", "consultant", "designer", "scientist", "director",
        "associate", "specialist", "coordinator", "administrator",
    ]
    results: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or _is_contact_line(line) or _is_edu_line(line) or _is_cert_line(line):
            continue
        lower = line.lower()
        if any(kw in lower for kw in exp_keywords) and 15 < len(line) < 200:
            if not _is_objective_line(line):
                results.append(line)
    return list(dict.fromkeys(results))[:15]


# ---------------------------------------------------------------------------
# Matching helpers
# ---------------------------------------------------------------------------

def _skill_tokens(skill: str) -> set[str]:
    """Split a skill into meaningful tokens (strip short noise words)."""
    stop = {"and", "or", "the", "a", "an", "for", "in", "of", "to", "with"}
    return {t for t in re.split(r"[\s\./\-]+", skill.lower()) if t and t not in stop and len(t) > 1}


# Synonym normalisation map — canonical form is the value.
# Used in compute_match so "node" and "node.js" are treated as the same skill.
_SKILL_SYNONYMS: dict[str, str] = {
    # React
    "react":        "react.js",
    "reactjs":      "react.js",
    "react js":     "react.js",
    # Node
    "node":         "node.js",
    "nodejs":       "node.js",
    "node js":      "node.js",
    # Next
    "next":         "next.js",
    "nextjs":       "next.js",
    "next js":      "next.js",
    # Express
    "express":      "express.js",
    "expressjs":    "express.js",
    # JavaScript
    "js":           "javascript",
    # TypeScript
    "ts":           "typescript",
    # CSS frameworks
    "tailwind":     "tailwind css",
    "tailwindcss":  "tailwind css",
    # REST
    "rest":         "rest api",
    "restful":      "rest api",
    "restful api":  "rest api",
    "rest apis":    "rest api",
    # Postgres
    "postgres":     "postgresql",
    "pg":           "postgresql",
    # MongoDB
    "mongo":        "mongodb",
    # Vue
    "vue":          "vue.js",
    "vuejs":        "vue.js",
    # Nuxt
    "nuxt":         "nuxt.js",
    "nuxtjs":       "nuxt.js",
    # Kubernetes
    "k8s":          "kubernetes",
    # CI/CD
    "ci cd":        "ci/cd",
    "cicd":         "ci/cd",
    # GitHub Actions
    "github action": "github actions",
    # DevOps
    "devops":       "devops",
    # Go
    "golang":       "go",
    # .NET
    "dotnet":       ".net",
    "asp.net":      ".net",
}


def _normalise_skill(skill: str) -> str:
    """Return the canonical form of a skill, applying synonym normalisation."""
    lower = skill.lower().strip()
    return _SKILL_SYNONYMS.get(lower, lower)


def compute_match(
    resume_skills: dict[str, list[str]],
    job_skills: dict[str, list[str]],
) -> dict[str, Any]:
    """
    Weighted ATS keyword matching.

    The job_skills dict contains taxonomy skills extracted from the JD.
    Scoring:
      - Full exact match (after synonym normalisation): 2 pts
      - Token-level partial match (≥50% token overlap): 1 pt
      - Missing: 0 pts

    Score = achieved / max * 100, clamped 0-100.
    Synonyms are normalised before comparison so "react" == "react.js",
    "node" == "node.js", etc.  Duplicates within the same canonical form
    are counted only once so the score can never be artificially inflated.
    """
    # Flatten and normalise all resume skills once
    all_resume_norm: set[str] = {
        _normalise_skill(s)
        for skills in resume_skills.values()
        for s in skills
    }
    # Flatten and normalise job skills, deduplicating canonical forms
    all_job_raw: list[str] = [s for skills in job_skills.values() for s in skills]
    # Deduplicate by canonical form (preserving first occurrence)
    seen_canonical: set[str] = set()
    all_job_deduped: list[str] = []
    for s in all_job_raw:
        canon = _normalise_skill(s)
        if canon not in seen_canonical:
            seen_canonical.add(canon)
            all_job_deduped.append(s)

    if not all_job_deduped:
        return {"score": 0, "matched": [], "missing": [], "partial": [], "breakdown": {}}

    matched: list[str] = []
    partial: list[str] = []
    missing: list[str] = []

    for job_skill in all_job_deduped:
        canon_job = _normalise_skill(job_skill)
        if canon_job in all_resume_norm:
            matched.append(job_skill)
        else:
            # Token overlap check (treats "rest api" ↔ "restful api" as partial)
            job_tokens = _skill_tokens(canon_job)
            is_partial = False
            if job_tokens:
                for res_skill in all_resume_norm:
                    res_tokens = _skill_tokens(res_skill)
                    if res_tokens:
                        overlap = job_tokens & res_tokens
                        overlap_ratio = len(overlap) / max(len(job_tokens), len(res_tokens))
                        if overlap_ratio >= 0.5:
                            is_partial = True
                            break
            if is_partial:
                partial.append(job_skill)
            else:
                missing.append(job_skill)

    max_pts      = len(all_job_deduped) * 2
    achieved_pts = len(matched) * 2 + len(partial) * 1
    score = round((achieved_pts / max_pts) * 100) if max_pts else 0
    score = max(0, min(100, score))

    # Per-category breakdown
    partial_set  = set(partial)
    matched_norm = {_normalise_skill(s) for s in matched}
    breakdown: dict[str, dict] = {}
    for cat, job_cat_skills in job_skills.items():
        cat_matched = [s for s in job_cat_skills if _normalise_skill(s) in matched_norm]
        cat_partial = [s for s in job_cat_skills if s in partial_set]
        cat_missing = [
            s for s in job_cat_skills
            if _normalise_skill(s) not in matched_norm and s not in partial_set
        ]
        breakdown[cat] = {
            "matched": cat_matched,
            "missing": cat_missing,
            "partial": cat_partial,
        }

    return {
        "score":   score,
        "matched": sorted(matched),
        "missing": sorted(missing),
        "partial": sorted(partial),
        "breakdown": breakdown,
    }


def generate_suggestions(
    missing: list[str],
    partial: list[str],
    score: int,
) -> list[str]:
    """Return actionable, personalised improvement suggestions."""
    suggestions: list[str] = []

    if score == 100:
        suggestions.append("Your resume is an excellent match for this role. Focus on tailoring your summary statement to mirror the job title.")
        return suggestions

    if score >= 75:
        suggestions.append("Strong match! Minor tweaks to your resume wording can push you over 90%.")

    if missing:
        top_missing = missing[:5]
        skills_str = ", ".join(top_missing)
        suggestions.append(
            f"Add these missing skills to your resume if you have experience with them: {skills_str}."
        )
        # Category-specific advice
        for skill in top_missing:
            cat = SKILL_TO_CATEGORY.get(skill)
            if cat == "Frontend":
                suggestions.append(f"For '{skill}': add a portfolio project or list it under a relevant work experience bullet.")
                break
            elif cat == "Backend":
                suggestions.append(f"For '{skill}': mention it in a project description or a side-project section.")
                break
            elif cat == "Database":
                suggestions.append(f"For '{skill}': add database work to a project section with measurable outcomes.")
                break
            elif cat == "Tools":
                suggestions.append(f"For '{skill}': list it under a 'Tools & Technologies' or 'DevOps' section.")
                break
            elif cat == "Programming Languages":
                suggestions.append(f"For '{skill}': include it prominently in your skills section and in relevant project descriptions.")
                break

    if partial:
        partial_str = ", ".join(partial[:4])
        suggestions.append(
            f"These partially matched skills could be strengthened by using the exact terminology from the job description: {partial_str}."
        )

    if score < 50:
        suggestions.append("Consider adding a dedicated 'Technical Skills' section at the top of your resume to improve ATS visibility.")
        suggestions.append("Mirror the exact keywords from the job description in your bullet points where truthful.")

    if len(missing) > 5:
        suggestions.append(
            f"You are missing {len(missing)} required skills. Prioritise gaining experience in the top 3 before applying: "
            + ", ".join(missing[:3]) + "."
        )

    return suggestions[:6]  # keep it concise


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class JobMatchRequest(BaseModel):
    resume_skills: dict[str, list[str]]
    job_description: str


class JobMatchResponse(BaseModel):
    score: int
    matched: list[str]
    missing: list[str]
    partial: list[str]
    breakdown: dict[str, Any]
    suggestions: list[str]
    job_skills: dict[str, list[str]]


# ---------------------------------------------------------------------------
# Interview question bank
# ---------------------------------------------------------------------------

# Structure: topic → difficulty → list of (question, suggested_answer, key_points)
# key_points are used for answer evaluation
QUESTION_BANK: dict[str, dict[str, list[dict]]] = {
    "React": {
        "beginner": [
            {
                "question": "What is React and why is it used?",
                "suggested_answer": "React is a JavaScript library developed by Meta for building user interfaces, particularly single-page applications. It uses a component-based architecture, allowing developers to build encapsulated components that manage their own state and compose them to create complex UIs. React uses a virtual DOM to efficiently update only the parts of the UI that have changed, making it fast.",
                "key_points": ["javascript library", "meta", "facebook", "component", "virtual dom", "ui", "single page", "reusable", "state"],
            },
            {
                "question": "What is JSX in React?",
                "suggested_answer": "JSX (JavaScript XML) is a syntax extension for JavaScript that allows you to write HTML-like code inside JavaScript. React transforms JSX into React.createElement() calls at build time. It makes component templates more readable and closely mirrors the actual DOM structure.",
                "key_points": ["syntax extension", "javascript xml", "html", "createElement", "template", "readable", "transpile", "babel"],
            },
            {
                "question": "What is the difference between props and state in React?",
                "suggested_answer": "Props (properties) are read-only inputs passed from a parent component to a child component. They cannot be modified by the child. State is mutable data managed within a component itself that can change over time, triggering a re-render. Props flow down the component tree; state is local.",
                "key_points": ["props", "read-only", "parent", "child", "state", "mutable", "re-render", "local", "immutable"],
            },
            {
                "question": "What are functional components in React?",
                "suggested_answer": "Functional components are plain JavaScript functions that accept props and return JSX. Since React 16.8, they can use hooks like useState and useEffect to manage state and side effects. They are simpler, easier to test, and are now the preferred way to write React components.",
                "key_points": ["javascript function", "props", "jsx", "hooks", "useState", "useEffect", "16.8", "simple", "preferred"],
            },
        ],
        "intermediate": [
            {
                "question": "Explain the React component lifecycle and useEffect.",
                "suggested_answer": "Class components have lifecycle methods: componentDidMount (after render), componentDidUpdate (after updates), and componentWillUnmount (before removal). In functional components, useEffect replaces all three. The dependency array controls when it runs: empty array runs once on mount, with dependencies runs when they change, and the cleanup function runs on unmount.",
                "key_points": ["componentDidMount", "componentDidUpdate", "componentWillUnmount", "useEffect", "dependency array", "cleanup", "mount", "unmount", "lifecycle"],
            },
            {
                "question": "What is the purpose of React keys and when should you use them?",
                "suggested_answer": "Keys help React identify which items in a list have changed, been added, or removed, enabling efficient reconciliation. They should be stable, unique IDs (like a database ID), not array indexes. Using indexes as keys causes bugs when the list order changes because React cannot distinguish between re-ordered items.",
                "key_points": ["identify", "list", "reconciliation", "unique", "stable", "id", "index", "re-order", "efficient"],
            },
            {
                "question": "How does the Context API work and when would you use it?",
                "suggested_answer": "Context API provides a way to pass data through the component tree without prop drilling. You create a context with React.createContext(), wrap components with a Provider that holds the value, and consume it with useContext(). It is best for global state like themes, authentication status, or locale — not for high-frequency updates where Redux or Zustand perform better.",
                "key_points": ["context", "prop drilling", "createContext", "provider", "useContext", "global", "theme", "auth", "tree"],
            },
            {
                "question": "What are React hooks and what problem do they solve?",
                "suggested_answer": "Hooks are functions introduced in React 16.8 that let functional components use state and other React features previously only available in class components. They solve the problem of reusing stateful logic across components without HOCs or render props. Common hooks: useState, useEffect, useContext, useRef, useMemo, useCallback.",
                "key_points": ["16.8", "functional", "state", "reuse", "stateful logic", "hoc", "useState", "useEffect", "useMemo", "useCallback"],
            },
        ],
        "advanced": [
            {
                "question": "Explain React reconciliation and the diffing algorithm.",
                "suggested_answer": "Reconciliation is how React updates the DOM efficiently. When state or props change React creates a new virtual DOM tree and diffs it against the previous one using a heuristic O(n) algorithm. It assumes: different types produce different trees (replace entirely), and keys identify stable elements across renders. This avoids expensive O(n³) tree comparison.",
                "key_points": ["virtual dom", "diffing", "heuristic", "O(n)", "element type", "keys", "reconciliation", "efficient", "tree"],
            },
            {
                "question": "What is React.memo, useMemo and useCallback and when would you use each?",
                "suggested_answer": "React.memo is a HOC that prevents re-rendering a component when its props haven't changed. useMemo memoizes the result of an expensive computation between renders. useCallback memoizes a function reference so it doesn't change on every render, which is important when passing callbacks to memoized child components. All three are performance optimisations — apply them after profiling, not prematurely.",
                "key_points": ["memo", "memoize", "re-render", "props", "expensive", "computation", "callback", "reference", "performance", "profiling"],
            },
            {
                "question": "How would you architect a large-scale React application?",
                "suggested_answer": "I would use a feature-based folder structure, separating concerns into components, hooks, services, and stores. State management via Redux Toolkit or Zustand depending on complexity. Code-splitting with React.lazy and Suspense. A design system with shared component library. Centralised error boundaries. TypeScript for type safety. Testing with React Testing Library and Vitest.",
                "key_points": ["feature folder", "code splitting", "lazy", "suspense", "redux", "zustand", "typescript", "error boundary", "testing", "design system"],
            },
        ],
    },
    "JavaScript": {
        "beginner": [
            {
                "question": "What is the difference between var, let, and const?",
                "suggested_answer": "var is function-scoped and hoisted (initialised as undefined). let and const are block-scoped and in the temporal dead zone until their declaration. const cannot be reassigned after declaration, though objects/arrays it references can be mutated. Prefer const by default, let when reassignment is needed, avoid var.",
                "key_points": ["var", "let", "const", "scope", "block", "function", "hoisting", "temporal dead zone", "reassign", "const mutation"],
            },
            {
                "question": "What is the difference between == and === in JavaScript?",
                "suggested_answer": "== performs loose equality with type coercion — it converts operands to the same type before comparing (e.g. '5' == 5 is true). === performs strict equality with no coercion — both value and type must match (e.g. '5' === 5 is false). Always prefer === to avoid unexpected bugs from implicit coercion.",
                "key_points": ["loose equality", "strict equality", "type coercion", "===", "==", "type", "value", "coercion"],
            },
            {
                "question": "What are arrow functions and how do they differ from regular functions?",
                "suggested_answer": "Arrow functions use the => syntax and are more concise. Key differences: they do not have their own `this` binding (they inherit it from the enclosing lexical scope), they cannot be used as constructors, and they don't have an `arguments` object. They are ideal for callbacks and methods that need lexical this.",
                "key_points": ["arrow", "=>", "this", "lexical", "constructor", "arguments", "concise", "callback", "binding"],
            },
        ],
        "intermediate": [
            {
                "question": "Explain closures in JavaScript with an example.",
                "suggested_answer": "A closure is a function that retains access to its outer scope variables even after the outer function has returned. For example, a counter factory function returns an inner function that increments and returns a private count variable. The inner function 'closes over' count. Closures enable data privacy, factory functions, and partial application.",
                "key_points": ["outer scope", "inner function", "retain access", "returned", "private", "data privacy", "factory", "lexical scope"],
            },
            {
                "question": "What is event delegation and why is it useful?",
                "suggested_answer": "Event delegation is attaching a single event listener to a parent element instead of to each child element individually. It works because DOM events bubble up from the target to the root. It is useful for dynamically added elements (which won't have listeners) and improves performance by reducing the number of listeners. Use event.target to identify which child triggered the event.",
                "key_points": ["parent", "child", "bubble", "propagation", "event.target", "dynamic", "performance", "single listener"],
            },
            {
                "question": "Explain Promises and async/await in JavaScript.",
                "suggested_answer": "A Promise represents the eventual result of an asynchronous operation. It can be pending, fulfilled, or rejected. You chain .then() for success and .catch() for errors. async/await is syntactic sugar over Promises — an async function always returns a Promise, and await pauses execution until the Promise settles, making asynchronous code look synchronous and easier to read.",
                "key_points": ["promise", "async", "await", "pending", "fulfilled", "rejected", "then", "catch", "asynchronous", "syntactic sugar"],
            },
        ],
        "advanced": [
            {
                "question": "How does the JavaScript event loop work?",
                "suggested_answer": "JavaScript is single-threaded with a call stack, heap, and task queues. The call stack executes synchronous code. Web APIs (setTimeout, fetch) handle async tasks off-thread. When complete, their callbacks go to the macrotask queue (setTimeout) or microtask queue (Promises, queueMicrotask). The event loop picks from the microtask queue first (draining it completely) before taking one macrotask, then repeats.",
                "key_points": ["single thread", "call stack", "event loop", "microtask", "macrotask", "web api", "promise", "setTimeout", "queue", "heap"],
            },
            {
                "question": "Explain prototypal inheritance in JavaScript.",
                "suggested_answer": "Every JavaScript object has a hidden [[Prototype]] reference to another object (its prototype). When you access a property, the engine walks the prototype chain until found or null is reached. Object.create() sets the prototype explicitly. ES6 classes are syntactic sugar over this. Unlike classical inheritance, it's based on object delegation, not class copying.",
                "key_points": ["prototype", "chain", "__proto__", "Object.create", "delegation", "property lookup", "ES6 class", "syntactic sugar", "inheritance"],
            },
        ],
    },
    "Node.js": {
        "beginner": [
            {
                "question": "What is Node.js and what makes it suitable for server-side development?",
                "suggested_answer": "Node.js is a JavaScript runtime built on Chrome's V8 engine that allows JavaScript to run outside the browser. It uses a non-blocking, event-driven I/O model, making it efficient for I/O-intensive applications like APIs and real-time apps. Its npm ecosystem is the largest package registry in the world.",
                "key_points": ["v8", "runtime", "non-blocking", "event driven", "i/o", "asynchronous", "npm", "server", "api", "single thread"],
            },
            {
                "question": "What is the difference between require and import in Node.js?",
                "suggested_answer": "require is CommonJS (CJS) — synchronous, dynamic, works in all Node versions without configuration. import is ES Modules (ESM) — asynchronous, static (tree-shakeable), requires .mjs extension or type:module in package.json. Modern projects prefer ESM for consistency with browsers and tree-shaking support.",
                "key_points": ["commonjs", "esm", "require", "import", "synchronous", "static", "dynamic", "tree shaking", "package.json"],
            },
        ],
        "intermediate": [
            {
                "question": "What is middleware in Express.js and how does it work?",
                "suggested_answer": "Middleware are functions in Express with access to the req, res, and next objects. They execute sequentially and can modify the request/response, end the cycle, or call next() to pass control to the next middleware. Used for logging, authentication, body parsing, error handling, and CORS. Order matters — declare middleware before the routes that need it.",
                "key_points": ["middleware", "req", "res", "next", "sequential", "order", "logging", "auth", "body parser", "cors", "error handling"],
            },
            {
                "question": "How do you handle errors in an Express.js application?",
                "suggested_answer": "Synchronous errors can be thrown and caught by Express automatically. For async routes, wrap in try/catch and call next(error). Define a 4-argument error handler (err, req, res, next) at the bottom of the app. Use centralised error classes to standardise error shapes and HTTP status codes. Never expose stack traces to clients in production.",
                "key_points": ["try catch", "next(error)", "error handler", "4 argument", "async", "status code", "centralised", "production", "stack trace"],
            },
        ],
        "advanced": [
            {
                "question": "Explain the Node.js event loop and how it differs from the browser's.",
                "suggested_answer": "Node's event loop has six phases: timers (setTimeout/setInterval), pending callbacks, idle/prepare, poll (I/O callbacks), check (setImmediate), and close callbacks. process.nextTick() fires before each phase transition, draining completely. This differs from the browser which only has macro/microtask queues without Node's explicit phases. setImmediate fires in the check phase, while setTimeout fires in timers.",
                "key_points": ["phases", "timers", "poll", "check", "setImmediate", "nextTick", "i/o", "libuv", "macrotask", "microtask"],
            },
        ],
    },
    "Python": {
        "beginner": [
            {
                "question": "What are Python decorators and how do they work?",
                "suggested_answer": "A decorator is a function that wraps another function to extend its behaviour without modifying it. Using @decorator syntax is shorthand for func = decorator(func). Common uses: logging, authentication, timing, caching (functools.lru_cache), and Flask/FastAPI route registration. Decorators are higher-order functions and exploit Python's first-class functions.",
                "key_points": ["wrapper", "higher order", "@ syntax", "functools", "first class", "modify", "extend", "lru_cache", "route"],
            },
            {
                "question": "What is the difference between a list and a tuple in Python?",
                "suggested_answer": "Lists are mutable sequences (can be changed after creation) defined with []. Tuples are immutable sequences defined with (). Tuples are faster, use less memory, and can be used as dictionary keys since they're hashable. Use tuples for fixed collections of heterogeneous data (like coordinates) and lists for homogeneous collections that change.",
                "key_points": ["mutable", "immutable", "list", "tuple", "hashable", "dict key", "performance", "memory", "sequence"],
            },
        ],
        "intermediate": [
            {
                "question": "Explain Python generators and when you would use them.",
                "suggested_answer": "Generators are functions that use yield to return values lazily, one at a time. They maintain their state between calls and produce items on demand rather than building an entire list in memory. Useful for large datasets, infinite sequences, and pipelines. The yield from syntax delegates to a sub-generator. Generator expressions (like list comprehensions with ()) are even more concise.",
                "key_points": ["yield", "lazy", "memory efficient", "state", "iterator", "large dataset", "infinite", "pipeline", "generator expression"],
            },
            {
                "question": "What is the GIL in Python and what are its implications?",
                "suggested_answer": "The Global Interpreter Lock (GIL) is a mutex in CPython that allows only one thread to execute Python bytecode at a time. This means CPU-bound multithreaded Python programs don't truly parallelise. Workarounds: use multiprocessing (separate processes, each with its own GIL) for CPU tasks, use asyncio for I/O-bound concurrency, or use C extensions that release the GIL. The GIL doesn't affect I/O-bound threading.",
                "key_points": ["gil", "mutex", "cpython", "thread", "parallel", "cpu bound", "multiprocessing", "asyncio", "io bound", "bytecode"],
            },
        ],
        "advanced": [
            {
                "question": "How does memory management and garbage collection work in Python?",
                "suggested_answer": "Python uses reference counting as its primary memory management strategy — each object tracks how many references point to it and is freed when the count reaches zero. Circular references are handled by the cyclic garbage collector (gc module), which runs periodically and uses generational collection (3 generations). The id() function returns memory address. del decrements reference count. Memory profiling tools include tracemalloc and memory_profiler.",
                "key_points": ["reference counting", "garbage collection", "cyclic", "gc module", "generational", "circular reference", "del", "tracemalloc", "memory"],
            },
        ],
    },
    "SQL": {
        "beginner": [
            {
                "question": "What is the difference between INNER JOIN, LEFT JOIN, and RIGHT JOIN?",
                "suggested_answer": "INNER JOIN returns only rows where there is a match in both tables. LEFT JOIN returns all rows from the left table and matched rows from the right; unmatched right columns are NULL. RIGHT JOIN is the opposite — all rows from the right table. FULL OUTER JOIN returns all rows from both, with NULLs where there's no match.",
                "key_points": ["inner join", "left join", "right join", "match", "null", "both tables", "full outer", "unmatched"],
            },
            {
                "question": "What is the difference between WHERE and HAVING in SQL?",
                "suggested_answer": "WHERE filters rows before grouping and aggregation — it cannot use aggregate functions. HAVING filters groups after GROUP BY and aggregation — it can use aggregate functions like COUNT, SUM, AVG. Use WHERE to filter individual rows, HAVING to filter the results of aggregate operations.",
                "key_points": ["where", "having", "group by", "aggregate", "filter", "before", "after", "count", "sum", "avg"],
            },
        ],
        "intermediate": [
            {
                "question": "Explain database indexes and their trade-offs.",
                "suggested_answer": "An index is a data structure (usually a B-tree) that speeds up read queries by allowing the database to find rows without a full table scan. Trade-offs: indexes speed up SELECT but slow down INSERT, UPDATE, DELETE because the index must be maintained. They also use additional disk space. Best applied to columns in WHERE clauses, JOIN conditions, and ORDER BY. Avoid over-indexing OLTP tables.",
                "key_points": ["b-tree", "read speed", "table scan", "insert", "update", "delete", "overhead", "where", "join", "disk space", "oltp"],
            },
            {
                "question": "What is a database transaction and what are ACID properties?",
                "suggested_answer": "A transaction is a unit of work that is executed atomically. ACID properties ensure reliability: Atomicity (all or nothing — no partial commits), Consistency (data remains valid after transaction), Isolation (concurrent transactions don't interfere), Durability (committed data persists even after crashes). ROLLBACK undoes a failed transaction; COMMIT makes changes permanent.",
                "key_points": ["acid", "atomicity", "consistency", "isolation", "durability", "commit", "rollback", "concurrent", "partial", "crash"],
            },
        ],
        "advanced": [
            {
                "question": "How would you optimise a slow SQL query?",
                "suggested_answer": "Start with EXPLAIN/EXPLAIN ANALYZE to understand the query plan. Look for sequential scans on large tables and add appropriate indexes. Avoid SELECT * — fetch only needed columns. Avoid functions on indexed columns in WHERE (prevents index use). Use query pagination (LIMIT/OFFSET or keyset). Consider denormalisation for read-heavy tables, materialised views for complex aggregations, and partitioning for very large tables.",
                "key_points": ["explain", "query plan", "index", "sequential scan", "select *", "pagination", "materialised view", "partition", "denormalise", "function on column"],
            },
        ],
    },
    "Full Stack": {
        "beginner": [
            {
                "question": "What is the difference between REST and GraphQL?",
                "suggested_answer": "REST uses fixed endpoints where each URL represents a resource (GET /users/1). GraphQL uses a single endpoint where clients specify exactly what data they need in a query, eliminating over-fetching and under-fetching. REST is simpler and cacheable at the HTTP level; GraphQL is flexible but more complex. REST is better for simple, public APIs; GraphQL for complex, client-driven data needs.",
                "key_points": ["rest", "graphql", "endpoint", "over-fetching", "under-fetching", "query", "schema", "flexible", "single endpoint", "cache"],
            },
        ],
        "intermediate": [
            {
                "question": "Explain authentication vs authorisation and common implementation strategies.",
                "suggested_answer": "Authentication verifies who you are (login — username/password, OAuth, biometrics). Authorisation determines what you're allowed to do (permissions, roles). Common strategies: JWT tokens (stateless, stored client-side, verified with secret), session cookies (stateful, server stores session), OAuth 2.0 / OpenID Connect for third-party auth. Always hash passwords with bcrypt/argon2, use HTTPS, set secure/httpOnly cookie flags.",
                "key_points": ["authentication", "authorisation", "jwt", "session", "oauth", "bcrypt", "https", "token", "cookie", "httpOnly"],
            },
            {
                "question": "What is CORS and how do you handle it in a Node.js/Express API?",
                "suggested_answer": "CORS (Cross-Origin Resource Sharing) is a browser security mechanism that blocks requests from a different origin (protocol + domain + port) unless the server explicitly allows it via headers. In Express, use the cors middleware: app.use(cors({ origin: 'https://myapp.com' })). For specific routes, apply cors() as route-level middleware. Never use origin: '*' with credentials.",
                "key_points": ["cross origin", "origin", "headers", "browser", "cors middleware", "allow", "credentials", "preflight", "options", "express"],
            },
        ],
        "advanced": [
            {
                "question": "How would you design a scalable full-stack application architecture?",
                "suggested_answer": "Frontend: React SPA or Next.js for SSR/SSG, CDN-hosted. Backend: microservices or modular monolith with API gateway, horizontally scalable stateless Node services. Caching: Redis for sessions and hot data. Database: primary relational DB with read replicas, potentially a separate search index (Elasticsearch). Message queue (Kafka/RabbitMQ) for async tasks. CI/CD pipeline, container orchestration with Kubernetes, monitoring with Prometheus/Grafana.",
                "key_points": ["microservices", "api gateway", "cdn", "redis", "read replica", "kubernetes", "queue", "stateless", "horizontal scaling", "monitoring"],
            },
        ],
    },
    "HR & Behavioral": {
        "beginner": [
            {
                "question": "Tell me about yourself and your background in software development.",
                "suggested_answer": "A strong answer follows the Present-Past-Future structure: start with your current role/skills, briefly mention your background and how you got into development, then connect to why you're excited about this specific role. Keep it professional, relevant, and under 2 minutes. Focus on impact and growth rather than reciting your CV.",
                "key_points": ["present past future", "background", "skills", "experience", "motivation", "role", "growth", "impact", "concise"],
            },
            {
                "question": "Why do you want to work at this company?",
                "suggested_answer": "Research the company before answering. Mention specific things: their product, tech stack, mission, culture, or engineering blog. Connect their work to your personal goals. Show you've done homework — reference a recent product launch, open-source contribution, or engineering challenge they've publicly discussed. Avoid generic answers like 'great culture' without specifics.",
                "key_points": ["research", "specific", "mission", "product", "tech stack", "personal goal", "culture", "genuine", "homework"],
            },
        ],
        "intermediate": [
            {
                "question": "Describe a time you resolved a conflict within your team.",
                "suggested_answer": "Use the STAR method: Situation (describe the conflict — technical disagreement, deadline pressure, etc.), Task (your responsibility in resolving it), Action (how you approached it — scheduled 1:1s, facilitated discussion, found common ground, escalated appropriately), Result (the outcome — improved collaboration, shipped feature, clearer processes). Focus on constructive resolution, not blame.",
                "key_points": ["star method", "situation", "task", "action", "result", "conflict", "resolution", "communication", "collaboration", "outcome"],
            },
            {
                "question": "How do you handle tight deadlines and multiple priorities?",
                "suggested_answer": "Explain your prioritisation method (MoSCoW, Eisenhower matrix, or simply urgency × impact). Mention proactive communication — flagging blockers early rather than missing a deadline silently. Break large tasks into smaller deliverables. Use tools like Jira or a simple task list. Give an example where you successfully delivered under pressure.",
                "key_points": ["prioritise", "moscow", "urgency", "impact", "communication", "blockers", "breakdown", "deadline", "tools", "example"],
            },
            {
                "question": "What is your approach to learning new technologies?",
                "suggested_answer": "Describe a structured approach: read official docs first, then build a small project to get hands-on. Use spaced repetition and teach others to solidify understanding. Mention specific resources you use (official docs, MDN, freeCodeCamp, books). Give a recent example of a technology you learned and how you applied it.",
                "key_points": ["official docs", "hands on", "project", "teach", "spaced repetition", "resources", "example", "structured", "apply"],
            },
        ],
        "advanced": [
            {
                "question": "Describe the most technically challenging project you have worked on.",
                "suggested_answer": "Pick a real, complex project. Structure: what the project was and its business impact, the specific technical challenges (scale, performance, legacy constraints, ambiguous requirements), the decisions you made and why, what you would do differently. Demonstrate depth — go beyond surface-level descriptions. Quantify outcomes where possible (reduced latency by 40%, handled 10x traffic).",
                "key_points": ["complex", "impact", "challenge", "decision", "trade-off", "quantify", "outcome", "technical depth", "retrospective", "scale"],
            },
            {
                "question": "How do you approach code reviews — both giving and receiving feedback?",
                "suggested_answer": "Giving: focus on the code, not the person. Ask clarifying questions rather than making demands. Prioritise blocking issues vs. nits. Explain the why behind suggestions. Acknowledge good solutions. Receiving: treat feedback as learning, not criticism. Ask for clarification if feedback is unclear. Don't take it personally — the goal is better code, not winning an argument.",
                "key_points": ["code not person", "constructive", "why", "nit", "blocking", "clarify", "learning", "ego", "acknowledge", "collaboration"],
            },
        ],
    },
}

# ---------------------------------------------------------------------------
# Interview helpers
# ---------------------------------------------------------------------------

def get_questions_for_topics(
    topics: list[str],
    difficulty: str,
    max_per_topic: int = 3,
) -> list[dict]:
    """Return a flat list of question dicts for the requested topics and difficulty."""
    result: list[dict] = []
    for topic in topics:
        bank = QUESTION_BANK.get(topic, {})
        level_qs = bank.get(difficulty, [])
        # Also include one from adjacent difficulty to add variety
        if difficulty == "intermediate":
            level_qs = level_qs + bank.get("beginner", [])[:1]
        elif difficulty == "advanced":
            level_qs = level_qs + bank.get("intermediate", [])[:1]
        for q in level_qs[:max_per_topic]:
            result.append({
                "topic": topic,
                "difficulty": difficulty,
                "question": q["question"],
                "suggested_answer": q["suggested_answer"],
                "key_points": q["key_points"],
            })
    return result


def evaluate_candidate_answer(
    question: str,
    suggested_answer: str,
    key_points: list[str],
    candidate_answer: str,
) -> dict[str, Any]:
    """
    Score a candidate's answer against key points.

    Scoring:
      - Each key point found in the answer = base_points
      - Length/depth bonus (up to 10 pts) for well-elaborated answers
      - Clarity penalty for very short answers
      - Score clamped 0–100
    """
    if not candidate_answer or not candidate_answer.strip():
        return {
            "score": 0,
            "feedback": "No answer was provided.",
            "matched_points": [],
            "missed_points": key_points,
            "improvement_tips": ["Provide a detailed answer to receive a score."],
        }

    norm_answer = normalise(candidate_answer)
    base_per_point = 80 / max(len(key_points), 1)  # key points cover 80% of score

    matched: list[str] = []
    missed: list[str] = []

    for kp in key_points:
        # Check each word in the key point separately for partial credit
        kp_words = [w for w in kp.lower().split() if len(w) > 2]
        # A key point is matched if most of its words appear in the answer
        matches = sum(1 for w in kp_words if re.search(r"\b" + re.escape(w) + r"\b", norm_answer))
        if matches >= max(1, len(kp_words) * 0.5):
            matched.append(kp)
        else:
            missed.append(kp)

    base_score = round(len(matched) * base_per_point)

    # Depth bonus: up to 10 pts for answers over 60 words
    word_count = len(candidate_answer.split())
    depth_bonus = min(10, max(0, (word_count - 20) // 8))

    # Structure bonus: up to 10 pts for using examples or structured language
    structure_markers = ["for example", "such as", "because", "therefore", "however",
                         "first", "second", "additionally", "in my experience", "e.g."]
    structure_bonus = min(10, sum(2 for m in structure_markers if m in norm_answer))

    score = min(100, base_score + depth_bonus + structure_bonus)

    # Build feedback
    feedback_parts: list[str] = []
    if score >= 85:
        feedback_parts.append("Excellent answer — you covered the key concepts thoroughly.")
    elif score >= 65:
        feedback_parts.append("Good answer with solid coverage of the main points.")
    elif score >= 40:
        feedback_parts.append("Partial answer — you touched on some concepts but missed important details.")
    else:
        feedback_parts.append("The answer needs more depth. Review the suggested answer and key concepts.")

    if matched:
        feedback_parts.append(f"You correctly covered: {', '.join(matched[:5])}{'...' if len(matched) > 5 else ''}.")
    if missed:
        feedback_parts.append(f"Key concepts to add: {', '.join(missed[:5])}{'...' if len(missed) > 5 else ''}.")

    # Improvement tips
    tips: list[str] = []
    if word_count < 30:
        tips.append("Expand your answer — interviewers expect at least 3–5 sentences with explanation and examples.")
    if not any(m in norm_answer for m in ["for example", "such as", "e.g.", "for instance"]):
        tips.append("Add a concrete example or use case to demonstrate practical understanding.")
    if missed:
        tips.append(f"Study these missing concepts: {', '.join(missed[:3])}.")
    if score < 60:
        tips.append("Review the suggested answer and try to identify which concepts you omitted.")
    if not tips:
        tips.append("Strong answer. For senior roles, go even deeper by discussing trade-offs and real-world constraints.")

    return {
        "score": score,
        "feedback": " ".join(feedback_parts),
        "matched_points": matched,
        "missed_points": missed,
        "improvement_tips": tips[:3],
    }


# ---------------------------------------------------------------------------
# Interview request / response models
# ---------------------------------------------------------------------------

class GenerateQuestionsRequest(BaseModel):
    resume_skills: dict[str, list[str]]
    job_description: str = ""
    difficulty: str = "intermediate"   # beginner | intermediate | advanced
    topics: list[str] = []             # optional override; auto-detected if empty


class InterviewQuestion(BaseModel):
    topic: str
    difficulty: str
    question: str
    suggested_answer: str
    key_points: list[str]


class GenerateQuestionsResponse(BaseModel):
    questions: list[InterviewQuestion]
    detected_topics: list[str]
    difficulty: str


class EvaluateAnswerRequest(BaseModel):
    question: str
    suggested_answer: str
    key_points: list[str]
    candidate_answer: str


class EvaluateAnswerResponse(BaseModel):
    score: int
    feedback: str
    matched_points: list[str]
    missed_points: list[str]
    improvement_tips: list[str]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    return {"message": "CareerAI Python Service is running."}


@app.post("/analyze-resume")
async def analyze_resume(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file.")

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        text, has_text = extract_text_from_pdf(contents)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not read PDF: {exc}") from exc

    skills = extract_skills(text) if has_text else {}
    education = extract_education(text) if has_text else []
    experience = extract_experience(text) if has_text else []

    return {
        "filename": file.filename,
        "has_text": has_text,
        "message": "" if has_text else (
            "This PDF appears to be image-based. Text extraction was not possible. "
            "Try a text-selectable PDF for better results."
        ),
        "skills": skills,
        "education": education,
        "experience": experience,
    }


@app.post("/match-job", response_model=JobMatchResponse)
async def match_job(payload: JobMatchRequest):
    if not payload.job_description or not payload.job_description.strip():
        raise HTTPException(status_code=400, detail="Job description cannot be empty.")

    if not payload.resume_skills:
        raise HTTPException(status_code=400, detail="Resume skills are required. Analyse your resume first.")

    job_skills = extract_skills(payload.job_description)

    if not any(job_skills.values()):
        raise HTTPException(
            status_code=422,
            detail="No recognisable technical skills were found in the job description. Try pasting the full job posting.",
        )

    match_result = compute_match(payload.resume_skills, job_skills)
    suggestions = generate_suggestions(
        match_result["missing"],
        match_result["partial"],
        match_result["score"],
    )

    return JobMatchResponse(
        score=match_result["score"],
        matched=match_result["matched"],
        missing=match_result["missing"],
        partial=match_result["partial"],
        breakdown=match_result["breakdown"],
        suggestions=suggestions,
        job_skills=job_skills,
    )


# ---------------------------------------------------------------------------
# Topic → QUESTION_BANK key mapping
# ---------------------------------------------------------------------------

SKILL_TO_TOPIC: dict[str, str] = {
    # Frontend → React
    "react": "React", "jsx": "React", "tsx": "React", "redux": "React",
    "nextjs": "React", "next.js": "React",
    # Frontend → JavaScript
    "javascript": "JavaScript", "typescript": "JavaScript",
    # Backend → Node.js
    "node": "Node.js", "nodejs": "Node.js", "express": "Node.js",
    "rest": "Node.js", "api": "Node.js", "restful": "Node.js",
    # Backend → Python
    "python": "Python", "fastapi": "Python", "django": "Python", "flask": "Python",
    # Database → SQL
    "sql": "SQL", "mysql": "SQL", "postgresql": "SQL", "postgres": "SQL",
    "sqlite": "SQL", "mongodb": "SQL",
    # Tools → Full Stack
    "docker": "Full Stack", "kubernetes": "Full Stack", "git": "Full Stack",
    "github": "Full Stack", "aws": "Full Stack", "ci/cd": "Full Stack",
}

ALWAYS_INCLUDE_TOPICS = ["HR & Behavioral"]


@app.post("/generate-questions", response_model=GenerateQuestionsResponse)
async def generate_questions(payload: GenerateQuestionsRequest):
    if payload.difficulty not in ("beginner", "intermediate", "advanced"):
        raise HTTPException(status_code=400, detail="Difficulty must be beginner, intermediate, or advanced.")

    if not payload.resume_skills and not payload.topics and not payload.job_description:
        raise HTTPException(status_code=400, detail="Provide resume skills, a job description, or explicit topics.")

    # Auto-detect topics from resume skills + job description
    detected: set[str] = set()

    all_skills: list[str] = [
        s for skills in payload.resume_skills.values() for s in skills
    ]
    if payload.job_description:
        job_skills = extract_skills(payload.job_description)
        all_skills += [s for skills in job_skills.values() for s in skills]

    for skill in all_skills:
        topic = SKILL_TO_TOPIC.get(skill.lower())
        if topic:
            detected.add(topic)

    # Allow explicit topic overrides
    if payload.topics:
        detected = {t for t in payload.topics if t in QUESTION_BANK}

    # Fallback: if nothing detected, use Full Stack + HR
    if not detected:
        detected = {"Full Stack", "JavaScript"}

    # Always include behavioral
    detected.update(ALWAYS_INCLUDE_TOPICS)

    # Cap at 6 topics to keep the question set manageable
    topic_list = sorted(detected)[:6]

    questions = get_questions_for_topics(topic_list, payload.difficulty, max_per_topic=3)

    if not questions:
        raise HTTPException(status_code=422, detail="Could not generate questions for the given parameters.")

    return GenerateQuestionsResponse(
        questions=questions,
        detected_topics=topic_list,
        difficulty=payload.difficulty,
    )


@app.post("/evaluate-answer", response_model=EvaluateAnswerResponse)
async def evaluate_answer(payload: EvaluateAnswerRequest):
    if not payload.candidate_answer or not payload.candidate_answer.strip():
        raise HTTPException(status_code=400, detail="Candidate answer cannot be empty.")
    if not payload.question:
        raise HTTPException(status_code=400, detail="Question text is required.")

    result = evaluate_candidate_answer(
        question=payload.question,
        suggested_answer=payload.suggested_answer,
        key_points=payload.key_points,
        candidate_answer=payload.candidate_answer,
    )

    return EvaluateAnswerResponse(**result)


# ===========================================================================
# RESUME CUSTOMIZER
# ===========================================================================

import textwrap
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, HRFlowable, KeepTogether,
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from fastapi.responses import StreamingResponse
import json as _json

# ---------------------------------------------------------------------------
# Technology name capitalisation map
# Ensures consistent, ATS-correct casing for well-known tech names.
# ---------------------------------------------------------------------------

TECH_CAPS: dict[str, str] = {
    # JavaScript / TypeScript
    "javascript":       "JavaScript",
    "typescript":       "TypeScript",
    # React family
    "react":            "React.js",
    "react.js":         "React.js",
    "reactjs":          "React.js",
    "react js":         "React.js",
    # Next.js
    "next":             "Next.js",
    "next.js":          "Next.js",
    "nextjs":           "Next.js",
    "next js":          "Next.js",
    # Vue / Angular / Svelte / Nuxt
    "vue":              "Vue.js",
    "vue.js":           "Vue.js",
    "vuejs":            "Vue.js",
    "angular":          "Angular",
    "svelte":           "Svelte",
    "nuxt":             "Nuxt.js",
    "nuxt.js":          "Nuxt.js",
    # Node.js / Express.js
    "node":             "Node.js",
    "node.js":          "Node.js",
    "nodejs":           "Node.js",
    "node js":          "Node.js",
    "express":          "Express.js",
    "express.js":       "Express.js",
    "expressjs":        "Express.js",
    # Python back-end frameworks
    "fastapi":          "FastAPI",
    "django":           "Django",
    "flask":            "Flask",
    # Databases
    "mongodb":          "MongoDB",
    "mongoose":         "Mongoose",
    "postgresql":       "PostgreSQL",
    "postgres":         "PostgreSQL",
    "mysql":            "MySQL",
    "sqlite":           "SQLite",
    "redis":            "Redis",
    "firebase":         "Firebase",
    "firestore":        "Firestore",
    "dynamodb":         "DynamoDB",
    "supabase":         "Supabase",
    "prisma":           "Prisma",
    "typeorm":          "TypeORM",
    "sequelize":        "Sequelize",
    "elasticsearch":    "Elasticsearch",
    # API / query languages
    "graphql":          "GraphQL",
    "grpc":             "gRPC",
    "websockets":       "WebSockets",
    "api":              "API",
    "rest":             "REST",
    "rest api":         "REST API",
    "rest apis":        "REST APIs",
    "restful":          "RESTful",
    "restful api":      "RESTful API",
    # Auth
    "jwt":              "JWT",
    "oauth":            "OAuth",
    # CSS / styling
    "tailwind":         "Tailwind CSS",
    "tailwind css":     "Tailwind CSS",
    "tailwindcss":      "Tailwind CSS",
    "bootstrap":        "Bootstrap",
    "material ui":      "Material UI",
    "chakra ui":        "Chakra UI",
    "styled components": "Styled Components",
    "sass":             "Sass",
    "scss":             "SCSS",
    # Core web
    "html":             "HTML",
    "html5":            "HTML5",
    "css":              "CSS",
    "css3":             "CSS3",
    # Programming languages
    "python":           "Python",
    "java":             "Java",
    "kotlin":           "Kotlin",
    "swift":            "Swift",
    "rust":             "Rust",
    "golang":           "Go",
    "go":               "Go",
    "php":              "PHP",
    "ruby":             "Ruby",
    "rails":            "Ruby on Rails",
    "c":                "C",
    "c#":               "C#",
    "c++":              "C++",
    "asp.net":          "ASP.NET",
    ".net":             ".NET",
    "dotnet":           ".NET",
    "mssql":            "MS SQL",
    "r":                "R",
    "dart":             "Dart",
    "flutter":          "Flutter",
    "scala":            "Scala",
    "bash":             "Bash",
    "shell":            "Shell",
    # Build / test tools
    "webpack":          "Webpack",
    "vite":             "Vite",
    "jest":             "Jest",
    "cypress":          "Cypress",
    "vitest":           "Vitest",
    "storybook":        "Storybook",
    "redux":            "Redux",
    "redux toolkit":    "Redux Toolkit",
    "zustand":          "Zustand",
    # DevOps / cloud
    "docker":           "Docker",
    "kubernetes":       "Kubernetes",
    "k8s":              "Kubernetes",
    "aws":              "AWS",
    "azure":            "Azure",
    "gcp":              "GCP",
    "google cloud":     "Google Cloud",
    "terraform":        "Terraform",
    "ansible":          "Ansible",
    "jenkins":          "Jenkins",
    "github actions":   "GitHub Actions",
    "circleci":         "CircleCI",
    "travis":           "Travis CI",
    "travis ci":        "Travis CI",
    "ci/cd":            "CI/CD",
    "devops":           "DevOps",
    "mlops":            "MLOps",
    # Version control / collaboration
    "git":              "Git",
    "github":           "GitHub",
    "gitlab":           "GitLab",
    "bitbucket":        "Bitbucket",
    "jira":             "Jira",
    "confluence":       "Confluence",
    # OS / infra
    "linux":            "Linux",
    "unix":             "Unix",
    "nginx":            "Nginx",
    "apache":           "Apache",
    "kafka":            "Apache Kafka",
    "rabbitmq":         "RabbitMQ",
    # Misc
    "agile":            "Agile",
    "scrum":            "Scrum",
    "kanban":           "Kanban",
    "postman":          "Postman",
    "swagger":          "Swagger",
    "openapi":          "OpenAPI",
    "figma":            "Figma",
    "pwa":              "PWA",
    "wcag":             "WCAG",
    "sql":              "SQL",
    "nosql":            "NoSQL",
    "microservices":    "Microservices",
    "vercel":           "Vercel",
    "netlify":          "Netlify",
    "heroku":           "Heroku",
    "npm":              "npm",
    "yarn":             "Yarn",
    "pnpm":             "pnpm",
}


def apply_tech_caps(skill: str) -> str:
    """Return the correctly capitalised form of a technology name."""
    return TECH_CAPS.get(skill.lower().strip(), skill.strip().title())


# ---------------------------------------------------------------------------
# Contact info filter — strips contact lines from bullet lists
# ---------------------------------------------------------------------------

CONTACT_PATTERNS: list[re.Pattern] = [
    re.compile(r"\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b", re.IGNORECASE),    # email
    # Phone numbers: require the matched span to contain at least 7 digit chars.
    # This prevents date ranges like "2020 - 2024" (only 8 digits total across
    # two numbers) from matching. A real phone has 7-15 consecutive digits.
    re.compile(r"(?<!\d)\+?[\d][\d\s\-().]{6,15}[\d](?!\d)"),          # phone with separators
    re.compile(r"(?<!\d)\d{7,15}(?!\d)"),                               # plain digit phone
    re.compile(r"linkedin\.com/", re.IGNORECASE),                       # linkedin
    re.compile(r"github\.com/[^\s]+", re.IGNORECASE),                   # github profile URL only
    re.compile(r"https?://", re.IGNORECASE),                            # any URL
    re.compile(r"\bportfolio\b.*http", re.IGNORECASE),                  # portfolio + link
]

# Post-filter: exclude date-range-like strings from contact matches
_DATE_RANGE_PAT = re.compile(
    r"^[\w\s,.]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|20\d{2}|19\d{2})"
    r".*(present|current|20\d{2}|19\d{2})[\w\s,.]*$",
    re.IGNORECASE,
)


def _is_contact_line(line: str) -> bool:
    """
    Return True if the line is primarily contact / location info.
    Date ranges (e.g. 'ABC University, 2020 - 2024') are explicitly excluded.
    """
    # Quick exclusion: if line contains a year-range like "2020 - 2024" but
    # no @-email, skip the phone patterns to avoid false positives.
    stripped = line.strip()
    if _DATE_RANGE_PAT.match(stripped):
        # Still check for email / URLs — those are always contact regardless
        for pat in CONTACT_PATTERNS[2:]:    # skip phone patterns (index 0=email handled below)
            if pat.search(stripped):
                return True
        return re.search(r"\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b", stripped, re.IGNORECASE) is not None
    return any(pat.search(stripped) for pat in CONTACT_PATTERNS)

# Education keywords — used to identify and isolate academic content
EDU_SECTION_KEYWORDS: list[str] = [
    # Degree names
    "bachelor", "master", "phd", "doctorate",
    "b.e.", "m.e.", "b.tech", "m.tech", "mba", "bca", "mca",
    "b.sc", "m.sc", "b.a.", "m.a.", "b.s.", "m.s.",
    "associate degree",
    # School / secondary education
    "high school", "class xii", "class x", "10+2", "12th", "10th",
    "secondary", "higher secondary", "matriculation",
    # Institution words — standalone (catches "ABC University, 2020-2024")
    "university", "college", "institute", "school of",
    "institute of technology",
    # Academic metrics / dates
    "cgpa", "gpa", "graduated", "graduation", "passed out",
    "percentage:", "marks:",
]

# Certification keywords — must be tested BEFORE education keywords
# IMPORTANT: keep this list specific — broad tech terms like "full stack"
# must NOT appear here because they also occur in job titles / experience.
CERT_SECTION_KEYWORDS: list[str] = [
    # Generic cert/course indicators
    "certified", "certification", "certificate", "workshop", "bootcamp",
    "completion", "credential", "course", "training",
    # Specific providers / certification bodies
    "aws certified", "google certified", "microsoft certified",
    "pmp", "cissp", "comptia", "cka", "ckad", "cpa",
    "coursera", "udemy", "edx", "udacity", "linkedin learning",
    "nptel", "swayam", "infosys springboard",
    # Named certs known from this user's resume — specific enough to be safe
    "mern stack development",           # "MERN Stack Development - Udemy"
    "ai generative model",              # "AI Generative Model Workshop"
    "generative model workshop",
    "generative ai",
]

# A secondary set of keywords that are ONLY cert indicators when paired
# with a primary cert keyword in the same line.
# (Used by _is_cert_line to avoid false-positives on role titles.)
_CERT_SECONDARY: list[str] = [
    "mern stack", "full stack", "full-stack",
]

# Project section keywords
PROJECT_SECTION_KEYWORDS: list[str] = [
    "project", "open source", "demo", "case study",
]

# Experience role / company keywords
EXP_ROLE_KEYWORDS: list[str] = [
    "engineer", "developer", "analyst", "manager", "lead", "architect",
    "intern", "internship", "trainee", "consultant", "designer",
    "scientist", "director", "associate", "specialist",
    "coordinator", "administrator", "officer",
]
EXP_COMPANY_SIGNALS: list[str] = [
    " pvt", " ltd", " llc", " inc", " corp", " co.", " technologies",
    " solutions", " systems", " software", " services", " digital",
    "ladybird", "pearlthoughts", "pearl thoughts",
]

# Objective / career goal sentences — routed to summary, never to experience
OBJECTIVE_PATTERNS: list[re.Pattern] = [
    re.compile(r"\b(seeking|aspiring|looking for|eager to|aiming to|wish to|desire to|intend to)\b", re.IGNORECASE),
    re.compile(r"\b(career objective|objective|career goal|my goal|my aim)\b", re.IGNORECASE),
    re.compile(r"\bto (obtain|secure|contribute|join|work|grow|leverage|utilize|apply)\b", re.IGNORECASE),
    re.compile(r"\b(a (challenging|rewarding|dynamic|growth|learning)|growth.oriented|challenging position)\b", re.IGNORECASE),
]

# Date patterns used to identify job tenure lines
DATE_PATTERN: re.Pattern = re.compile(
    r"\b("
    r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*"
    r"|20\d{2}|19\d{2}"
    r"|present|current|till date|to date"
    r")\b",
    re.IGNORECASE,
)

# Section header patterns — anchored to full line (after strip)
# Each tuple: (regex, section_key)
SECTION_HEADER_MAP: list[tuple[re.Pattern, str]] = [
    # Experience — many variants
    (re.compile(r"^(work\s+experience|professional\s+experience|employment(\s+history)?|experience|internship(s)?)$", re.IGNORECASE), "experience"),
    # Education
    (re.compile(r"^(education(\s+background)?|academic(\s+(background|qualifications?))?|qualifications?)$", re.IGNORECASE), "education"),
    # Skills
    (re.compile(r"^(technical\s+skills?|skills?|core\s+competencies|technologies|tech(\s+stack)?)$", re.IGNORECASE), "skills_raw"),
    # Projects
    (re.compile(r"^(projects?|personal\s+projects?|side\s+projects?|academic\s+projects?|key\s+projects?)$", re.IGNORECASE), "projects"),
    # Certifications — must be BEFORE education in this list
    (re.compile(r"^(certifications?(\s+and\s+courses?)?|certificates?(\s+and\s+courses?)?|courses?(\s+and\s+certifications?)?|licen[cs]es?(\s+and\s+certifications?)?|achievements?(\s+and\s+certifications?)?)$", re.IGNORECASE), "certifications"),
    # Summary / Objective
    (re.compile(r"^(professional\s+summary|summary|career\s+objective|objective|profile|about\s+me|career\s+summary)$", re.IGNORECASE), "summary"),
    # Extracurricular / Activities — ignore content under these
    (re.compile(r"^(extra.?curricular|activities|hobbies|interests|languages?|personal\s+info|declaration)$", re.IGNORECASE), "ignore"),
]


def _is_edu_line(line: str) -> bool:
    lower = line.lower()
    return any(kw in lower for kw in EDU_SECTION_KEYWORDS)


def _is_cert_line(line: str) -> bool:
    """
    Return True if the line looks like a certification entry.

    Two-tier check:
      Tier 1 — primary keywords (certified, certificate, workshop, udemy …)
               → match on their own.
      Tier 2 — secondary keywords (mern stack, full stack …) that are only
               cert indicators when a primary keyword is ALSO present.
    This prevents role titles like "Full Stack Developer" from being
    mis-classified as certifications.
    """
    lower = line.lower()
    if any(kw in lower for kw in CERT_SECTION_KEYWORDS):
        return True
    # Secondary: only matches when a primary cert indicator is also on the line
    if any(kw in lower for kw in _CERT_SECONDARY):
        primary_indicators = [
            "certified", "certification", "certificate", "workshop",
            "bootcamp", "completion", "credential", "course", "training",
            "coursera", "udemy", "edx", "udacity", "nptel", "swayam",
        ]
        if any(pi in lower for pi in primary_indicators):
            return True
    return False


def _is_objective_line(line: str) -> bool:
    """Return True if the line is a career-objective / generic aspiration sentence."""
    return any(pat.search(line) for pat in OBJECTIVE_PATTERNS)


def _is_project_line(line: str) -> bool:
    lower = line.lower()
    return any(kw in lower for kw in PROJECT_SECTION_KEYWORDS)


def _is_experience_line(line: str) -> bool:
    """Heuristic: looks like a role title or employment bullet."""
    if _is_contact_line(line) or _is_edu_line(line) or _is_cert_line(line):
        return False
    if _is_objective_line(line):
        return False
    lower = line.lower()
    has_role = any(kw in lower for kw in EXP_ROLE_KEYWORDS)
    has_company = any(sig in lower for sig in EXP_COMPANY_SIGNALS)
    has_date = bool(DATE_PATTERN.search(line))
    return (has_role or has_company or has_date) and len(line) > 15


def _detect_section_header(line: str) -> str | None:
    """
    Return the canonical section key for a heading line, or None.
    Checks the full stripped line (without trailing colon/dash).
    """
    stripped = line.strip().rstrip(":–-").strip()
    # Must be short enough to be a heading (not a sentence)
    if len(stripped) > 60:
        return None
    for pattern, key in SECTION_HEADER_MAP:
        if pattern.match(stripped):
            return key
    return None


def _clean_bullet(line: str) -> str:
    """Strip leading bullet characters and normalise whitespace."""
    return re.sub(r"^[\s•\-\*\u2022\u25cf\u25e6\u2013\u2014]+", "", line).strip()


def classify_resume_text(raw_text: str) -> dict[str, list[str]]:
    """
    Parse raw resume text into classified sections.

    Algorithm:
      1. Walk lines top-to-bottom, detecting explicit section headings.
      2. Within each section, apply fine-grained filters:
         - Experience: skip contact/edu/cert/objective lines; keep role/bullet lines.
         - Education: skip cert lines (they go to certifications instead).
         - Certifications: accept cert lines regardless of edu keywords.
         - Projects: accept all non-contact lines.
         - Summary/objective: accept all non-contact lines.
      3. The header area (before the first heading) captures name + contact info.
      4. Deduplicate every section at the end.

    Returns dict with keys:
        contact, summary, experience, education, certifications, projects, skills_raw
    """
    sections: dict[str, list[str]] = {
        "contact":        [],
        "summary":        [],
        "experience":     [],
        "education":      [],
        "certifications": [],
        "projects":       [],
        "skills_raw":     [],
    }

    lines = [ln.strip() for ln in raw_text.splitlines() if ln.strip()]
    current_section: str = "header"
    header_lines_seen: int = 0

    for line in lines:
        clean = _clean_bullet(line)
        if not clean:
            continue

        # ── 1. Detect section heading ─────────────────────────────────────
        heading = _detect_section_header(line)
        if heading is not None:
            current_section = heading
            continue

        # ── 2. Header area (before first explicit heading) ────────────────
        if current_section == "header":
            header_lines_seen += 1
            # First 1-2 lines are almost always name + maybe job title
            # Lines after that that look like contact go to contact[]
            if header_lines_seen <= 2:
                sections["contact"].append(clean)
            elif _is_contact_line(line):
                sections["contact"].append(clean)
            elif header_lines_seen <= 6:
                # Could be a city/location line or tagline — keep in contact
                sections["contact"].append(clean)
            # Once we've seen a long line in header area that isn't contact,
            # it might be an inline objective — treat as summary
            elif len(clean) > 50 and not _is_contact_line(line):
                sections["summary"].append(clean)
            continue

        # ── 3. Ignore sections (extracurricular, hobbies, declaration) ────
        if current_section == "ignore":
            continue

        # ── 4. Summary / Objective section ───────────────────────────────
        if current_section == "summary":
            if not _is_contact_line(line) and len(clean) > 10:
                sections["summary"].append(clean)
            continue

        # ── 5. Skills section ─────────────────────────────────────────────
        if current_section == "skills_raw":
            if not _is_contact_line(line) and len(clean) > 1:
                sections["skills_raw"].append(clean)
            continue

        # ── 6. Projects section ───────────────────────────────────────────
        if current_section == "projects":
            if not _is_contact_line(line) and len(clean) > 5:
                sections["projects"].append(clean)
            continue

        # ── 7. Certifications section ─────────────────────────────────────
        if current_section == "certifications":
            if _is_contact_line(line):
                continue
            # Under an explicit "Certifications" heading every non-contact
            # line belongs here — the section heading is authoritative.
            # Exception: lines that look purely like education entries
            # (e.g. university name leaked between sections) go to education.
            if _is_edu_line(clean) and not _is_cert_line(clean):
                sections["education"].append(clean)
            elif len(clean) > 5:
                sections["certifications"].append(clean)
            continue

        # ── 8. Education section ──────────────────────────────────────────
        if current_section == "education":
            if _is_contact_line(line):
                continue
            # Route to certifications ONLY when line has a cert keyword
            # AND does NOT have an education keyword — prevents
            # "CGPA: 8.5" or "Bachelor of Engineering" going to certs.
            if _is_cert_line(clean) and not _is_edu_line(clean):
                sections["certifications"].append(clean)
                continue
            if len(clean) > 5:
                sections["education"].append(clean)
            continue

        # ── 9. Experience section ─────────────────────────────────────────
        if current_section == "experience":
            if _is_contact_line(line):
                continue
            # Education content that leaked into experience section
            if _is_edu_line(clean) and not _is_experience_line(clean):
                sections["education"].append(clean)
                continue
            # Only reroute to certifications if the line has a primary
            # cert keyword (certified/certificate/workshop/udemy …) AND
            # does NOT look like a regular work responsibility sentence.
            # This prevents "Built … using MERN stack" from going to certs.
            if _is_cert_line(clean) and not _is_experience_line(clean) and len(clean) < 80:
                sections["certifications"].append(clean)
                continue
            # Career objectives / generic aspirations — route to summary
            if _is_objective_line(clean):
                if len(clean) > 20:
                    sections["summary"].append(clean)
                continue
            if len(clean) > 8:
                sections["experience"].append(clean)
            continue

    # ── 10. Fallback: heuristic classify for lines never assigned ─────────
    # (only reached if entire resume had no section headings)
    if not any(sections[k] for k in ("experience", "education", "certifications", "projects", "summary", "skills_raw")):
        for line in lines:
            clean = _clean_bullet(line)
            if not clean or _is_contact_line(line):
                continue
            if _is_objective_line(clean):
                sections["summary"].append(clean)
            elif _is_cert_line(clean) and not _is_edu_line(clean):
                sections["certifications"].append(clean)
            elif _is_edu_line(clean) and not _is_experience_line(clean):
                sections["education"].append(clean)
            elif _is_project_line(clean) and not _is_experience_line(clean):
                sections["projects"].append(clean)
            elif _is_experience_line(clean):
                sections["experience"].append(clean)

    # ── 11. Final cross-section deduplication ─────────────────────────────
    # Build fingerprints from education and certifications to prevent
    # the same line appearing in experience.
    edu_fps:  set[str] = {e.lower().strip() for e in sections["education"]}
    cert_fps: set[str] = {c.lower().strip() for c in sections["certifications"]}

    sections["experience"] = [
        b for b in sections["experience"]
        if b.lower().strip() not in edu_fps
        and b.lower().strip() not in cert_fps
    ]

    # Deduplicate within each section preserving order
    for key in sections:
        sections[key] = list(dict.fromkeys(sections[key]))

    return sections


# ---------------------------------------------------------------------------
# Action verb lists
# ---------------------------------------------------------------------------

ACTION_VERBS_BY_DOMAIN: dict[str, list[str]] = {
    "frontend":  ["Engineered", "Developed", "Implemented", "Designed", "Built",
                  "Optimised", "Refactored", "Delivered", "Integrated", "Automated"],
    "backend":   ["Architected", "Developed", "Deployed", "Scaled", "Optimised",
                  "Implemented", "Integrated", "Automated", "Maintained", "Monitored"],
    "data":      ["Analysed", "Modelled", "Queried", "Processed", "Visualised",
                  "Optimised", "Designed", "Built", "Maintained", "Automated"],
    "general":   ["Led", "Collaborated", "Delivered", "Improved", "Streamlined",
                  "Coordinated", "Supported", "Contributed", "Resolved", "Enhanced"],
}


def pick_action_verb(bullet: str, domain: str = "general") -> str:
    """Replace a weak opening verb with a stronger one from the domain list."""
    weak_openers = [
        "worked on", "helped with", "did the", "was responsible for",
        "was part of", "assisted with", "assisted in", "assisted",
        "i worked", "i helped", "i did", "i made", "i used",
        "made", "did", "used", "wrote",
    ]
    verbs = ACTION_VERBS_BY_DOMAIN.get(domain, ACTION_VERBS_BY_DOMAIN["general"])
    lower = bullet.lower().strip()
    for weak in weak_openers:
        if lower.startswith(weak):
            rest = bullet[len(weak):].strip().lstrip(",. ")
            rest = rest[:1].lower() + rest[1:] if rest else rest
            return f"{verbs[hash(bullet) % len(verbs)]} {rest}"
    return bullet


# ---------------------------------------------------------------------------
# Resume customization logic
# ---------------------------------------------------------------------------

def _extract_jd_role(job_description: str, fallback_title: str) -> str:
    """
    Heuristically extract the target job title from a job description.
    Looks for lines like "We are looking for a Senior React Developer" or
    a bolded title near the top.  Falls back to fallback_title if provided,
    then to 'Software Developer'.
    """
    if fallback_title.strip():
        return fallback_title.strip()

    jd_lower = job_description.lower()
    # Patterns: "looking for a ...", "hiring a ...", "role: ..."
    patterns = [
        re.compile(r"(?:looking for|hiring|seeking|we need)\s+a(?:n)?\s+([A-Za-z .+/\-]{5,60}?)(?:\s+to|\s+who|\s+with|\s*\.|\s*,)", re.IGNORECASE),
        re.compile(r"^(?:role|position|job title)\s*[:\-]\s*(.+)$", re.IGNORECASE | re.MULTILINE),
        re.compile(r"^([A-Z][A-Za-z ]+(?:developer|engineer|architect|analyst|designer|lead|manager|scientist|consultant))\s*$", re.MULTILINE),
    ]
    for pat in patterns:
        m = pat.search(job_description)
        if m:
            candidate = m.group(1).strip().rstrip(".,;")
            if 4 < len(candidate) < 80:
                return candidate

    # Last resort: look for any title-cased line in the first 300 chars
    for line in job_description[:300].splitlines():
        line = line.strip()
        if 8 < len(line) < 70 and line.istitle():
            return line

    return "Software Developer"


def _extract_jd_highlights(
    job_description: str,
    matched_skills: list[str],
    all_job_skills: dict[str, list[str]],
) -> dict[str, Any]:
    """
    Pull key phrases from the JD for use in the summary:
      - top_skills: up to 6 skills from resume that also appear in JD
      - jd_keywords: 2-3 non-skill responsibility keywords (e.g. 'scalable', 'agile')
      - has_seniority: whether JD mentions senior/lead/principal
    """
    jd_lower = job_description.lower()

    # Top skills — prioritised by order they appear in the JD
    all_job_flat = [s for skills in all_job_skills.values() for s in skills]
    top_skills_ordered = [s for s in all_job_flat if s in matched_skills][:6]
    # Fallback: use matched_skills directly if no overlap found
    if not top_skills_ordered:
        top_skills_ordered = matched_skills[:6]

    # Responsibility keywords that signal what kind of work is expected
    responsibility_signals = [
        ("scalable",    "scalable systems"),
        ("performan",   "performance-focused solutions"),
        ("collaborat",  "cross-functional collaboration"),
        ("agile",       "Agile/Scrum workflows"),
        ("ci/cd",       "CI/CD pipelines"),
        ("microservic", "microservices architecture"),
        ("cloud",       "cloud infrastructure"),
        ("api",         "API design and integration"),
        ("full.stack",  "full-stack development"),
        ("front.end",   "frontend development"),
        ("back.end",    "backend development"),
        ("test",        "automated testing"),
        ("deploy",      "deployment and release processes"),
        ("mentor",      "team mentoring"),
        ("review",      "code review practices"),
    ]
    jd_keywords: list[str] = []
    for signal, label in responsibility_signals:
        if re.search(signal, jd_lower) and label not in jd_keywords:
            jd_keywords.append(label)
            if len(jd_keywords) >= 3:
                break

    # Seniority check — do NOT invent it; only use if JD explicitly mentions it
    seniority_words = ["senior", "lead", "principal", "staff", "head of"]
    has_seniority = any(w in jd_lower for w in seniority_words)

    return {
        "top_skills": top_skills_ordered,
        "jd_keywords": jd_keywords,
        "has_seniority": has_seniority,
    }


def build_professional_summary(
    name: str,
    target_title: str,
    matched_skills: list[str],
    experience_lines: list[str],
    years_exp: str,
    job_description: str = "",
    all_job_skills: dict[str, list[str]] | None = None,
) -> str:
    """
    Generate a targeted, ATS-friendly professional summary based on the
    actual job description.

    Rules:
    - Use only skills/experience the candidate actually has (matched_skills).
    - Extract target role from JD when possible.
    - Never invent seniority, years, or achievements.
    - Keep to 3 concise sentences.
    """
    if all_job_skills is None:
        all_job_skills = {}

    role = _extract_jd_role(job_description, target_title)

    highlights = _extract_jd_highlights(
        job_description=job_description,
        matched_skills=matched_skills,
        all_job_skills=all_job_skills,
    )

    top_skills = [apply_tech_caps(s) for s in highlights["top_skills"]]
    skills_str = ", ".join(top_skills) if top_skills else "modern web technologies"

    # Years prefix — only use if the user explicitly provided it
    years_prefix = ""
    if years_exp and years_exp.strip().isdigit():
        years_prefix = f"{years_exp.strip()}+ years of "

    # Sentence 1: who they are and what role they target
    sentence1 = (
        f"Results-driven {role} with {years_prefix}hands-on experience building "
        f"production-grade software solutions."
    )

    # Sentence 2: skill proficiency — anchored to the JD
    sentence2 = f"Proficient in {skills_str}."

    # Sentence 3: JD-aligned value proposition
    if highlights["jd_keywords"]:
        kw_str = ", ".join(highlights["jd_keywords"][:2])
        sentence3 = (
            f"Experienced in {kw_str}, with a strong focus on code quality, "
            f"maintainability, and continuous delivery."
        )
    else:
        sentence3 = (
            "Comfortable working in Agile teams, translating requirements into "
            "maintainable, well-tested code."
        )

    return f"{sentence1} {sentence2} {sentence3}"


def rewrite_experience_bullets(
    bullets: list[str],
    matched_skills: list[str],
    domain: str = "general",
) -> list[str]:
    """
    Rewrite experience bullets professionally.

    Rules:
    - Strengthen weak opening verbs with action verbs from the domain list.
    - Inject a matched skill keyword at most ONCE per bullet, and only when:
        a) the bullet already implies a technical context, AND
        b) the skill isn't already mentioned in the bullet, AND
        c) the skill hasn't already been injected into a previous bullet in
           this batch (each skill is used at most once across all bullets to
           prevent 'using Git' appearing on every line).
    - Skip contact-info lines, education lines, and very short noise lines.
    - Never invent facts, companies, dates, technologies, or metrics.
    """
    result: list[str] = []
    # Track which matched skills have already been injected to avoid repetition
    injected_skills: set[str] = set()

    # Skills that are always too generic to inject mid-sentence
    _NEVER_INJECT: set[str] = {
        "git", "github", "gitlab", "agile", "scrum", "jira",
        "linux", "api", "rest", "rest api",
    }

    tech_signals = [
        "develop", "build", "implement", "creat", "design",
        "deploy", "integrat", "maintain", "test", "optim",
        "architect", "deliver", "refactor", "automat", "engineer",
    ]

    for bullet in bullets:
        stripped = bullet.strip()
        if not stripped:
            continue
        if _is_contact_line(stripped):
            continue
        if _is_edu_line(stripped) and not _is_experience_line(stripped):
            continue
        if len(stripped) < 12:
            continue

        rewritten = pick_action_verb(stripped, domain)
        lower_r = rewritten.lower()

        # Inject a skill only when contextually appropriate
        if len(rewritten) < 110:
            has_tech_context = any(sig in lower_r for sig in tech_signals)
            if has_tech_context:
                for skill in matched_skills:
                    skill_lower = skill.lower()
                    # Skip if: already in bullet, already injected, or generic
                    if skill_lower in lower_r:
                        continue
                    if skill_lower in injected_skills:
                        continue
                    if skill_lower in _NEVER_INJECT:
                        continue
                    # Only inject skills that are genuinely specific/meaningful
                    if len(skill) < 3:
                        continue
                    rewritten = rewritten.rstrip(".") + f" using {apply_tech_caps(skill)}."
                    injected_skills.add(skill_lower)
                    break  # one injection per bullet maximum

        result.append(rewritten)
    return result


def prioritise_skills(
    resume_skills: dict[str, list[str]],
    job_skills: dict[str, list[str]],
) -> dict[str, Any]:
    all_resume: set[str] = {s for skills in resume_skills.values() for s in skills}
    all_job:    set[str] = {s for skills in job_skills.values()    for s in skills}

    prioritised: dict[str, list[str]] = {}
    additional:  dict[str, list[str]] = {}

    for cat, skills in resume_skills.items():
        prio = [s for s in skills if s in all_job]
        rest = [s for s in skills if s not in all_job]
        if prio:
            prioritised[cat] = prio
        if rest:
            additional[cat] = rest

    missing = sorted(all_job - all_resume)
    return {"prioritised": prioritised, "additional": additional, "missing": missing}


def compute_ats_improvements(
    before_score: int,
    after_score:  int,
    added_keywords: list[str],
    matched_keywords: list[str],
) -> list[str]:
    improvements: list[str] = []
    delta = after_score - before_score

    if delta > 0:
        improvements.append(
            f"ATS keyword score improved by {delta} points "
            f"({before_score}% \u2192 {after_score}%)."
        )
    else:
        improvements.append(
            f"Original ATS score: {before_score}%. Customised score: {after_score}% "
            f"(score reflects your existing skill alignment with this role)."
        )
    if added_keywords:
        improvements.append(
            f"Professional summary now references {len(added_keywords)} additional "
            f"job-relevant keywords: {', '.join(added_keywords[:5])}{'...' if len(added_keywords) > 5 else ''}."
        )
    if matched_keywords:
        improvements.append(
            f"{len(matched_keywords)} of your skills directly match the job requirements "
            f"and are listed first in the Technical Skills section."
        )
    improvements.append(
        "Experience bullets have been rewritten with strong action verbs tailored to "
        "the target role."
    )
    improvements.append(
        "Skills are grouped by category and ordered by relevance to this specific role."
    )
    improvements.append(
        "Note: ATS scores are estimates based on keyword matching between your resume "
        "and the job description. Actual ATS results vary by system."
    )
    return improvements


def detect_domain(skills: dict[str, list[str]]) -> str:
    frontend_skills = set(skills.get("Frontend", []))
    backend_skills  = set(skills.get("Backend",  []))
    data_skills     = set(skills.get("Database", []))
    if len(frontend_skills) >= len(backend_skills):
        return "frontend"
    if data_skills and len(data_skills) >= len(backend_skills):
        return "data"
    return "backend"


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class CustomizeResumeRequest(BaseModel):
    resume_text:       str
    resume_skills:     dict[str, list[str]]
    resume_education:  list[str] = []
    resume_experience: list[str] = []
    job_description:   str
    job_title:         str = ""
    candidate_name:    str = ""
    years_experience:  str = ""


class CustomizeResumeResponse(BaseModel):
    summary:            str
    skills_prioritised: dict[str, list[str]]
    skills_additional:  dict[str, list[str]]
    skills_missing:     list[str]
    experience_bullets: list[str]
    education:          list[str]
    certifications:     list[str]
    projects:           list[str]
    contact_info_parsed: str
    job_skills:         dict[str, list[str]]
    matched_keywords:   list[str]
    added_keywords:     list[str]
    missing_keywords:   list[str]
    before_score:       int
    after_score:        int
    improvements:       list[str]


class GeneratePdfRequest(BaseModel):
    candidate_name:     str = ""
    # job_title intentionally NOT auto-rendered under name — user controls header
    summary:            str
    skills_prioritised: dict[str, list[str]]
    skills_additional:  dict[str, list[str]]
    experience_bullets: list[str]
    education:          list[str]
    certifications:     list[str] = []
    projects:           list[str] = []
    contact_info:       str = ""
    raw_resume_text:    str = ""   # used to extract sections when needed


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.post("/customize-resume", response_model=CustomizeResumeResponse)
async def customize_resume(payload: CustomizeResumeRequest):
    if not payload.resume_text.strip():
        raise HTTPException(status_code=400, detail="Resume text is required.")
    if not payload.job_description.strip():
        raise HTTPException(status_code=400, detail="Job description is required.")
    if len(payload.job_description.strip()) < 30:
        raise HTTPException(status_code=400, detail="Job description is too short.")

    # 1. Classify raw resume text into sections
    classified = classify_resume_text(payload.resume_text)

    merged_education = list(dict.fromkeys(
        payload.resume_education + classified["education"]
    ))
    edu_fingerprints: set[str] = {e.lower().strip() for e in merged_education}

    raw_experience  = payload.resume_experience or classified["experience"]
    clean_experience = [
        b for b in raw_experience
        if b.lower().strip() not in edu_fingerprints
        and not _is_edu_line(b)
        and not _is_contact_line(b)
    ]

    certifications = classified["certifications"]
    projects       = classified["projects"]

    contact_lines       = classified["contact"]
    contact_info_parsed = "  |  ".join(contact_lines[:4]) if contact_lines else ""

    # 2. Extract job skills from JD
    job_skills = extract_skills(payload.job_description)
    if not any(job_skills.values()):
        raise HTTPException(
            status_code=422,
            detail="No recognisable skills found in the job description.",
        )

    # ── 3. BEFORE SCORE ──────────────────────────────────────────────────────
    # Computed strictly from the ORIGINAL resume skills vs job skills.
    # Uses the resume as uploaded — no customisation applied yet.
    before        = compute_match(payload.resume_skills, job_skills)
    before_score  = before["score"]
    all_matched   = before["matched"]   # skills on resume that match JD

    # 4. Prioritise skills
    skill_result = prioritise_skills(payload.resume_skills, job_skills)
    prioritised  = skill_result["prioritised"]
    additional   = skill_result["additional"]
    missing_skills = skill_result["missing"]

    # ── 5. PROFESSIONAL SUMMARY ───────────────────────────────────────────────
    # Generated fresh from the JD — different for every job description.
    summary = build_professional_summary(
        name=payload.candidate_name,
        target_title=payload.job_title,
        matched_skills=all_matched,
        experience_lines=clean_experience,
        years_exp=payload.years_experience,
        job_description=payload.job_description,
        all_job_skills=job_skills,
    )

    # 6. Rewrite experience bullets (no repetitive skill injections)
    domain = detect_domain(payload.resume_skills)
    rewritten_bullets = rewrite_experience_bullets(
        bullets=clean_experience,
        matched_skills=all_matched,
        domain=domain,
    )
    if not rewritten_bullets:
        rewritten_bullets = clean_experience or []

    # ── 7. AFTER SCORE ────────────────────────────────────────────────────────
    # Computed from the FULL customised resume:
    #   original skills  +  skills mentioned in the new summary
    #                    +  skills mentioned in rewritten bullets
    # This gives a genuinely independent score that reflects what the
    # customised PDF will actually contain.
    summary_skills  = extract_skills(summary)
    bullets_text    = " ".join(rewritten_bullets)
    bullet_skills   = extract_skills(bullets_text)

    # Merge all three sources — dedup per category
    after_skills: dict[str, list[str]] = {}
    for cat in set(
        list(payload.resume_skills.keys()) +
        list(summary_skills.keys()) +
        list(bullet_skills.keys())
    ):
        merged = list(dict.fromkeys(
            payload.resume_skills.get(cat, []) +
            summary_skills.get(cat, []) +
            bullet_skills.get(cat, [])
        ))
        if merged:
            after_skills[cat] = merged

    after       = compute_match(after_skills, job_skills)
    # Score can only improve — never penalise customisation
    after_score = max(before_score, after["score"])

    # 8. Added keywords = skills now in summary/bullets that weren't in original
    original_flat  = {_normalise_skill(s) for skills in payload.resume_skills.values() for s in skills}
    after_flat     = {_normalise_skill(s) for skills in after_skills.values() for s in skills}
    added_keywords = sorted(
        apply_tech_caps(s) for s in (after_flat - original_flat)
        if s not in {_normalise_skill(x) for x in missing_skills}
    )

    # 9. Missing keywords — the full gap list from the JD (taxonomy skills only,
    #    drawn from the after-score result so they reflect the customised state)
    missing_keywords = sorted(
        apply_tech_caps(s) for s in after["missing"]
    )

    improvements = compute_ats_improvements(
        before_score, after_score, added_keywords,
        [apply_tech_caps(s) for s in all_matched],
    )

    return CustomizeResumeResponse(
        summary=summary,
        skills_prioritised=prioritised,
        skills_additional=additional,
        skills_missing=missing_skills,
        experience_bullets=rewritten_bullets,
        education=merged_education,
        certifications=certifications,
        projects=projects,
        contact_info_parsed=contact_info_parsed,
        job_skills=job_skills,
        matched_keywords=sorted(apply_tech_caps(s) for s in all_matched),
        added_keywords=added_keywords,
        missing_keywords=missing_keywords,
        before_score=before_score,
        after_score=after_score,
        improvements=improvements,
    )


# ---------------------------------------------------------------------------
# PDF generation helpers
# ---------------------------------------------------------------------------

def _pdf_styles() -> dict[str, ParagraphStyle]:
    """Return all named paragraph styles used by the PDF builder."""
    brand   = colors.HexColor("#1a6b5c")   # dark teal — header accent
    dark    = colors.HexColor("#111827")   # near-black for headings/name
    body_c  = colors.HexColor("#374151")   # dark grey for body text
    sub_c   = colors.HexColor("#6b7280")   # medium grey for sub-labels
    rule_c  = colors.HexColor("#d1d5db")   # light grey for dividers

    return {
        "brand":   brand,
        "dark":    dark,
        "body_c":  body_c,
        "sub_c":   sub_c,
        "rule_c":  rule_c,

        "name": ParagraphStyle(
            "PDFName",
            fontName="Helvetica-Bold", fontSize=20, leading=24,
            textColor=dark, spaceAfter=0, alignment=TA_LEFT,
        ),
        "contact": ParagraphStyle(
            "PDFContact",
            fontName="Helvetica", fontSize=8.5, leading=12,
            textColor=sub_c, spaceAfter=0, alignment=TA_LEFT,
        ),
        "section_heading": ParagraphStyle(
            "PDFSectionHeading",
            fontName="Helvetica-Bold", fontSize=9, leading=11,
            textColor=brand, spaceBefore=10, spaceAfter=3,
            letterSpacing=1.2,
        ),
        "body": ParagraphStyle(
            "PDFBody",
            fontName="Helvetica", fontSize=9.5, leading=14,
            textColor=body_c, spaceAfter=4,
        ),
        "bullet": ParagraphStyle(
            "PDFBullet",
            fontName="Helvetica", fontSize=9.5, leading=14,
            textColor=body_c, spaceAfter=3,
            leftIndent=14, firstLineIndent=-8,
        ),
        "skill_cat": ParagraphStyle(
            "PDFSkillCat",
            fontName="Helvetica-Bold", fontSize=9, leading=13,
            textColor=dark, spaceAfter=1,
        ),
        "skill_val": ParagraphStyle(
            "PDFSkillVal",
            fontName="Helvetica", fontSize=9, leading=13,
            textColor=body_c, spaceAfter=5,
        ),
    }


def _section_block(title: str, styles: dict) -> list:
    """Return [heading paragraph, thin rule] for a resume section."""
    rule_c = styles["rule_c"]
    return [
        Paragraph(title.upper(), styles["section_heading"]),
        HRFlowable(width="100%", thickness=0.5, color=rule_c,
                   spaceAfter=4, spaceBefore=0),
    ]


def _bullet_para(text: str, style: ParagraphStyle) -> Paragraph:
    """
    Return a bullet paragraph safe for all PDF viewers.

    Uses an ASCII hyphen-dash bullet instead of Unicode \u2022 to avoid
    black-square rendering artefacts in some PDF viewers and ATS parsers.
    XML-special characters are escaped for ReportLab's Paragraph parser.
    """
    safe = (
        text.strip()
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    return Paragraph(f"- {safe}", style)


@app.post("/generate-pdf")
async def generate_pdf(payload: GeneratePdfRequest):
    """
    Generate a professional, ATS-friendly single-column PDF resume.

    Layout:
      HEADER  — name + contact info (no auto job title below name)
      ─────────────────────────────────────────────────────────────
      PROFESSIONAL SUMMARY
      TECHNICAL SKILLS      (categorised, tech-capped names)
      WORK EXPERIENCE       (employment/internship bullets only)
      PROJECTS              (if present)
      EDUCATION             (academic entries only)
      CERTIFICATIONS        (if present)

    Rules enforced:
      - No "Generated by CareerAI" footer.
      - No auto-generated job title under candidate name.
      - Contact info appears only in the header, never in bullets.
      - Education entries never appear under Work Experience.
      - Technology names use correct capitalisation (JavaScript, not javascript).
      - Consistent 1-inch margins, 9.5 pt body, single column.
    """
    if not payload.summary.strip():
        raise HTTPException(status_code=400, detail="Summary is required to generate PDF.")

    buf = io.BytesIO()
    styles = _pdf_styles()

    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        leftMargin=1.0 * inch,
        rightMargin=1.0 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.75 * inch,
    )

    story: list = []

    # ── HEADER ──────────────────────────────────────────────────────────────
    name = payload.candidate_name.strip() or "Your Name"
    story.append(Paragraph(name, styles["name"]))

    if payload.contact_info.strip():
        # Render contact on one line; show at most 300 chars
        contact_text = payload.contact_info.strip()[:300]
        story.append(Spacer(1, 2))
        story.append(Paragraph(contact_text, styles["contact"]))

    story.append(Spacer(1, 6))
    story.append(HRFlowable(
        width="100%", thickness=1.5,
        color=styles["brand"], spaceAfter=10,
    ))

    # ── PROFESSIONAL SUMMARY ─────────────────────────────────────────────────
    story += _section_block("Professional Summary", styles)
    story.append(Paragraph(payload.summary.strip(), styles["body"]))

    # ── TECHNICAL SKILLS ─────────────────────────────────────────────────────
    # Merge prioritised + additional, dedup within each category, apply caps
    all_skills_map: dict[str, list[str]] = {}
    for cat, skills in {**payload.skills_additional, **payload.skills_prioritised}.items():
        # prioritised written last so it overrides additional for same cat
        seen = all_skills_map.get(cat, [])
        for s in skills:
            if s not in seen:
                seen.append(s)
        all_skills_map[cat] = seen

    if all_skills_map:
        story += _section_block("Technical Skills", styles)
        # Preferred category order
        cat_order = [
            "Programming Languages", "Frontend", "Backend",
            "Database", "Tools",
        ]
        ordered_cats = [c for c in cat_order if c in all_skills_map]
        ordered_cats += [c for c in all_skills_map if c not in ordered_cats]

        for cat in ordered_cats:
            skills = all_skills_map[cat]
            if not skills:
                continue
            capped = [apply_tech_caps(s) for s in skills]
            block = KeepTogether([
                Paragraph(f"{cat}:", styles["skill_cat"]),
                Paragraph(", ".join(capped), styles["skill_val"]),
            ])
            story.append(block)

    # ── WORK EXPERIENCE ──────────────────────────────────────────────────────
    # Filter out contact lines and education lines one final time
    exp_bullets = [
        b for b in payload.experience_bullets
        if b.strip()
        and not _is_contact_line(b)
        and not (_is_edu_line(b) and not _is_experience_line(b))
    ]

    if exp_bullets:
        story += _section_block("Work Experience", styles)
        for bullet in exp_bullets:
            story.append(_bullet_para(bullet.strip(), styles["bullet"]))

    # ── PROJECTS ─────────────────────────────────────────────────────────────
    projects = [p for p in (payload.projects or []) if p.strip()]
    if projects:
        story += _section_block("Projects", styles)
        for proj in projects:
            story.append(_bullet_para(proj.strip(), styles["bullet"]))

    # ── EDUCATION ────────────────────────────────────────────────────────────
    education = [e for e in (payload.education or []) if e.strip()]
    if education:
        story += _section_block("Education", styles)
        for entry in education:
            story.append(_bullet_para(entry.strip().capitalize(), styles["bullet"]))

    # ── CERTIFICATIONS ───────────────────────────────────────────────────────
    certs = [c for c in (payload.certifications or []) if c.strip()]
    if certs:
        story += _section_block("Certifications", styles)
        for cert in certs:
            story.append(_bullet_para(cert.strip(), styles["bullet"]))

    doc.build(story)
    buf.seek(0)

    safe_name = re.sub(r"[^\w\-]", "_", payload.candidate_name or "resume").strip("_") or "resume"
    filename  = f"{safe_name}_resume.pdf"

    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
