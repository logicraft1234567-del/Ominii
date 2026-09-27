# OMINI — deployment notes

## What changed in this pass

1. **`voice.js`** (new) — a single shared voice engine (`window.OminiVoice`) used by
   *both* the Practice Courtroom and Community Court:
   - `OminiVoice.speak(text, {onStart, onEnd, onError, rate, pitch})` — text‑to‑speech
     (browser `speechSynthesis`), with the same voice-selection logic that Courtroom
     used before (prefers a female-sounding system voice, falls back sensibly).
   - `OminiVoice.attachPushToTalk(button, {onStart, onResult, onError, onEnd, isDisabled})`
     — hold-to-speak mic input (`SpeechRecognition`), now with touch support in
     addition to mouse.
2. **`dashboard.js`** — Courtroom's `speakResponse()` and mic handling now call
   into `voice.js` instead of duplicating the logic. Community Court gained the
   same voice: OMINI's messages are now spoken aloud automatically as they arrive
   (polling detects new AI messages by id and speaks only the new ones, never
   the whole history when you first open a case), plus a voice on/off toggle and
   a hold-to-speak mic button — matching the Courtroom UI/UX.
3. **`dashboard.html`** — added the Community Court voice-toggle button (next to
   the status badge) and mic button (next to the chat input), and included
   `voice.js` before `robot.js`/`dashboard.js`.
4. **`app.py`** — production-friendlier startup: `PORT` and `FLASK_DEBUG` are now
   read from the environment instead of being hardcoded (`debug=True`,
   `port=5000`), and it warns if `OMINI_SECRET_KEY` isn't set.
5. **`requirements.txt`** — added `gunicorn` (production WSGI server; Flask's
   dev server isn't meant for real traffic).
6. **`Procfile`** — `web: gunicorn app:app ...`, works out of the box on
   Render, Railway, Heroku, Fly.io, etc.
7. **`.env.example`** — documents every environment variable the app reads.

No visual/behavioral changes were made to the Practice Courtroom other than the
internal refactor — it should sound and behave exactly as before.

## Important: this upload didn't include the whole project

Only `app.py`, `dashboard.html`, `dashboard.js`, `global.css`, `robot.js`,
`requirements.txt` and `omini_bot.glb` were provided — `app.py` itself imports
`models.db` and `models.groq_client`, and renders templates like
`index.html`, `login.html`, `signup.html` that weren't part of this upload.
Drop the files from this pass back into your existing project at their normal
paths:

```
your-project/
├── app.py                     ← replace
├── requirements.txt           ← replace
├── Procfile                   ← add
├── .env.example                ← add (copy to .env locally, fill in secrets)
├── models/                    ← unchanged, keep as-is
│   ├── db.py
│   └── groq_client.py
├── templates/
│   ├── dashboard.html         ← replace
│   ├── index.html, login.html, signup.html, ...  ← unchanged
├── static/
│   ├── css/global.css         ← replace
│   ├── js/
│   │   ├── dashboard.js       ← replace
│   │   ├── robot.js           ← unchanged (already fine)
│   │   └── voice.js           ← add (new)
│   └── models/
│       └── omini_bot.glb      ← add (robot.js loads it from here)
```

## Deploy checklist

1. **Environment variables** (set these on your host, not in git):
   - `GROQ_API_KEY` — required for OMINI's AI replies in both Courtroom and
     Community Court; without it the app falls back to a canned message.
   - `OMINI_SECRET_KEY` — a long random string (`python -c "import secrets; print(secrets.token_hex(32))"`).
     Required in production — Flask uses it to sign session cookies.
   - `FLASK_DEBUG` — leave unset or `false` in production.
   - `PORT` — most hosts (Render, Railway, Heroku) inject this automatically.

2. **Database & uploads are on local disk.** `models/db.py` and the
   `uploads/` folder (including `uploads/community/`) write to the local
   filesystem. On hosts with an *ephemeral* filesystem (Render/Railway free
   tiers, Heroku dynos) everything is wiped on every restart/redeploy. For a
   real deployment, either:
   - attach a persistent volume/disk and point the DB path + upload dirs at
     it, or
   - migrate `models/db.py` to a managed database (Postgres) — recommended
     for anything beyond a demo.

3. **Install & run locally to sanity check:**
   ```bash
   pip install -r requirements.txt
   cp .env.example .env   # fill in GROQ_API_KEY and OMINI_SECRET_KEY
   python app.py          # dev server, http://localhost:5000
   ```

4. **Production run** (what the Procfile does):
   ```bash
   gunicorn app:app --workers 3 --threads 4 --timeout 120 --bind 0.0.0.0:$PORT
   ```

5. **Platform-specific:**
   - **Render / Railway:** connect the repo, set the env vars above, and it
     will detect the `Procfile` automatically. Add a persistent disk if you
     need the SQLite DB / uploads to survive redeploys.
   - **Heroku:** `heroku create`, `heroku config:set GROQ_API_KEY=... OMINI_SECRET_KEY=...`,
     `git push heroku main`.
   - **Docker/VM:** any standard Flask+gunicorn setup behind Nginx works;
     just make sure the env vars and a writable, persistent path for
     `uploads/` (and wherever `models/db.py` puts the SQLite file) exist.

6. **HTTPS matters for voice.** Browsers only grant microphone access
   (`SpeechRecognition`, used by the hold-to-speak mic button) on secure
   contexts — `https://` in production, or `http://localhost` for local dev.
   Text-to-speech (`speechSynthesis`) works everywhere, but the mic won't
   without HTTPS, so make sure your host/CDN terminates TLS.

7. **Tailwind is currently loaded from a CDN** (`cdn.tailwindcss.com`) in
   `dashboard.html`. That's fine for a demo but is not meant for production
   (it compiles CSS in the browser on every load and Tailwind warns against
   it). For production, consider building a static Tailwind CSS file and
   swapping the `<script>` tag for a `<link>` — happy to set that up if you
   want.
