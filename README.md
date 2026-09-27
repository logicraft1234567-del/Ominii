# OMINI AI LAW

A futuristic AI legal operating system built with Flask + Tailwind CSS + Three.js.

## What's working right now
- Full auth (signup/login/logout, hashed passwords, SQLite, sessions)
- Dashboard styled entirely with **Tailwind CSS** (via CDN, no build step) and **Lucide** icons (a real, professional icon library — no emoji, no hand-drawn SVGs)
- Your custom **`omini_bot.glb`** 3D model loads via Three.js GLTFLoader and reacts to app state (color/speed shifts for idle/listening/thinking/talking). If the model or CDN ever fails to load, it falls back automatically to a simple procedural robot so the page never breaks.
- **Ask OMINI** — legal Q&A chat with memory, powered by Groq
- **Privacy Analyzer**, **Terms of Service Analyzer**, **Contract Analyzer** — upload PDF/DOCX/TXT or paste text, get a danger score, red flags, hidden clauses, and recommendations
- **Practice Courtroom** — describe both sides of a dispute, OMINI acts as AI judge and returns a structured verdict with reasoning and confidence score
- Groq API key is read from a `.env` file on the server only — no per-user key entry in the UI

## What's stubbed as "coming soon" (clean UI, no backend yet)
Risk Predictor (sliders), Community Court, Live multiplayer courtroom, AI Mediator, Laws Explainer library, AI Law School, News AI, OCR/Legal Vision. These are the natural next build passes — say which one to build next.

## Run it

```bash
pip install -r requirements.txt
python app.py
```

Then open http://localhost:5000

A `.env` with a working `GROQ_API_KEY` is already included in this build. If you ever need a new one, get a free key at https://console.groq.com/keys and replace the value in `.env`.

**Security note:** `.env` contains a live API key. Don't commit this folder to a public GitHub repo or share the zip publicly — rotate the key at console.groq.com if that ever happens.


Then open http://localhost:5000

Get a free Groq API key at https://console.groq.com/keys
