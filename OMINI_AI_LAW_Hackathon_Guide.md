# OMINI AI LAW — Hackathon Companion Guide
### Hack The Limit 2026 · Founder: Muhammed Olatundun

This document covers everything outside the slide deck itself: how to demo OMINI live, how to run it locally, how to deploy it, the GitHub README, your 5-minute talking script, and the longer-term roadmap.

---

## 1. Hackathon Demo Flow

Use this as your click-by-click walkthrough during the live demo portion of judging. Budget **2–3 minutes** for the demo if it follows the full 5-minute pitch, or up to 5 minutes if the demo *is* the pitch.

| # | Screen | What to click | What to say |
|---|--------|---------------|-------------|
| 1 | **Landing page** | Scroll past the hero section | "This is OMINI — an AI legal operating system, not just a chatbot." |
| 2 | **Signup** | Create a quick throwaway account on stage (or use a pre-made one) | "Signup takes seconds — no legal background required, ever." |
| 3 | **Login** | Log in with the demo account | "Straight into your legal dashboard." |
| 4 | **Dashboard** | Point at the module tiles | "Every module lives in one place — chat, privacy scans, contracts, courtroom, community." |
| 5 | **AI Legal Chat** | Ask a real question, e.g. *"What does an indemnification clause mean?"* | "Plain-English answers, grounded in real legal reasoning." |
| 6 | **Upload Privacy Policy PDF** | Upload a real, short privacy policy | "Let's see what we're actually agreeing to." |
| 7 | **AI explains dangerous clauses** | Point at the Danger Score and flagged clauses | "It scores the real risk and tells you exactly what to watch for." |
| 8 | **Practice Courtroom** | Open a pre-seeded mock dispute | "Two sides, one AI judge — questions, evidence requests, and a verdict." |
| 9 | **Community Court** | Show the multiplayer session view | "The same courtroom, opened up to a live group." |
| 10 | **Voice AI Judge** | Trigger a voice interaction | "And it can do all of this out loud." |
| 11 | **Verdict generated** | Show the final AI-generated verdict/explanation | "A reasoned, explainable outcome — not a black box." |

**Demo tips:**
- Rehearse the full flow at least twice before judging — timing drift is the #1 cause of rushed endings.
- Pre-seed your database with the courtroom dispute and privacy policy example so you're not typing live under pressure.
- Have a fallback: screen-recorded video of the same flow, in case of Wi-Fi issues at the venue.
- If a judge interrupts with a question mid-demo, answer briefly and say "let me show you" rather than only explaining verbally.

---

## 2. How to Run OMINI AI LAW Locally

Judges (or teammates) cloning the repo should be able to get this running in under five minutes.

### Step 1 — Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/Omini.git
cd Omini
```

### Step 2 — Create a Virtual Environment

**Windows:**
```bash
python -m venv venv
venv\Scripts\activate
```

**Mac/Linux:**
```bash
python3 -m venv venv
source venv/bin/activate
```

A virtual environment keeps OMINI's Python dependencies isolated from the rest of your system, so installing them here can't conflict with other projects.

### Step 3 — Install Dependencies

```bash
pip install -r requirements.txt
```

What this typically installs and why:

- **Flask** — the web framework that serves OMINI's pages and API routes.
- **python-dotenv** — loads the variables from your `.env` file into the app at runtime.
- **requests** — used by the backend to call the Groq API for AI reasoning.
- **gunicorn** — the production-grade server used when deploying (not needed for local dev, but usually pinned in `requirements.txt` so the same file works in both places).
- Any PDF/DOCX parsing libraries your document-intelligence module depends on (e.g. `PyPDF2` or `python-docx`), if included.

### Step 4 — Create a `.env` File

Create a file named `.env` in the project root. **Never commit a real API key — use placeholders, and generate your own values locally.**

```env
GROQ_API_KEY=YOUR_GROQ_API_KEY
GROQ_MODEL=openai/gpt-oss-120b
OMINI_SECRET_KEY=YOUR_RANDOM_SECRET_KEY
FLASK_DEBUG=true
PORT=5000
```

**What each variable does:**

| Variable | Purpose |
|---|---|
| `GROQ_API_KEY` | Authenticates OMINI's backend with the Groq API, which powers every AI conversation, analysis, and verdict. |
| `GROQ_MODEL` | Selects which model Groq runs your requests against (OMINI uses the open GPT-OSS model). |
| `OMINI_SECRET_KEY` | A random string Flask uses to sign session cookies, so login sessions can't be tampered with. |
| `FLASK_DEBUG` | Set to `true` locally for auto-reload and detailed error pages; must be `false` (or omitted) in production. |
| `PORT` | The local port the dev server listens on — visit `http://127.0.0.1:5000` by default. |

To generate your own secret key rather than using a guessable string, run:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

That will print something like `Omini_AI_Law_2026_SuperSecure_123456789` in shape — a long random hex string. Use your own generated value, never a shared or example one, especially in any deployed environment.

### Step 5 — Project Folder Structure

```text
Omini/
│
├── app.py                  # Flask entry point — routes, request handling
├── requirements.txt        # Python dependencies
├── Procfile                # Tells Render/Heroku-style hosts how to start the app
├── README.md
├── .env                     # Local secrets — never committed (see .gitignore)
│
├── models/
│   ├── db.py                # Database connection and query helpers
│   └── groq_client.py       # Wraps calls to the Groq API for AI reasoning
│
├── templates/
│   ├── index.html           # Landing page
│   ├── login.html
│   ├── signup.html
│   └── dashboard.html
│
├── static/
│   ├── css/                 # Stylesheets
│   ├── js/                  # Client-side scripts (chat, courtroom UI, Three.js visuals)
│   ├── images/
│   ├── icons/
│   └── sounds/               # Voice AI Judge audio cues
│
├── uploads/                  # Temporary storage for user-uploaded PDFs/DOCX/TXT
└── database/                 # SQLite database file(s)
```

### Step 6 — Run Locally

```bash
python app.py
```

Then visit:

```
http://127.0.0.1:5000
```

---

