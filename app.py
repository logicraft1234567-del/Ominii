import os
import json
import io
from functools import wraps

from dotenv import load_dotenv

_APP_DIR = os.path.dirname(os.path.abspath(__file__))
_ENV_PATH = os.path.join(_APP_DIR, ".env")


def load_server_env(env_path=None):
    """Load the app's server-side .env file from the project directory or current working directory.
    This makes startup resilient when Flask is launched from a different CWD in production.
    """
    candidates = []
    if env_path:
        candidates.append(env_path)
    candidates.extend([
        os.path.join(_APP_DIR, ".env"),
        os.path.join(os.getcwd(), ".env"),
        os.path.join(os.path.dirname(_APP_DIR), ".env"),
    ])

    seen = set()
    for candidate in candidates:
        normalized = os.path.abspath(candidate)
        if normalized in seen:
            continue
        seen.add(normalized)
        if os.path.isfile(normalized):
            load_dotenv(normalized, override=False)

    key = os.environ.get("GROQ_API_KEY")
    if key:
        return key
    return None


load_server_env(_ENV_PATH)

from flask import Flask, render_template, request, redirect, url_for, session, jsonify, flash
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

from models.db import get_db, init_db
from models import groq_client

BASE_DIR = _APP_DIR
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
ALLOWED_EXT = {"pdf", "docx", "txt"}

app = Flask(__name__)
app.secret_key = os.environ.get("OMINI_SECRET_KEY", "omini-dev-secret-change-me")
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16MB uploads

init_db()

if not os.environ.get("GROQ_API_KEY"):
    print(f"[OMINI] WARNING: GROQ_API_KEY not found. Checked project and working-directory .env files.")
    print(f"[OMINI]          app directory: {_APP_DIR}")
    print(f"[OMINI]          cwd: {os.getcwd()}")

if not os.environ.get("OMINI_SECRET_KEY"):
    print("[OMINI] WARNING: OMINI_SECRET_KEY not set — using an insecure default. "
          "Set OMINI_SECRET_KEY in your environment before deploying to production.")



# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return wrapper


def current_user():
    if "user_id" not in session:
        return None
    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE id = ?", (session["user_id"],)).fetchone()
    conn.close()
    return user


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXT


def extract_text(filepath):
    ext = filepath.rsplit(".", 1)[1].lower()
    if ext == "txt":
        with open(filepath, "r", errors="ignore") as f:
            return f.read()
    elif ext == "pdf":
        from PyPDF2 import PdfReader
        reader = PdfReader(filepath)
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    elif ext == "docx":
        import docx
        d = docx.Document(filepath)
        return "\n".join(p.text for p in d.paragraphs)
    return ""


# ---------------------------------------------------------------------------
# Public pages
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html", user=current_user())


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        identifier = request.form.get("identifier", "").strip()
        password = request.form.get("password", "")
        conn = get_db()
        user = conn.execute(
            "SELECT * FROM users WHERE email = ? OR username = ?", (identifier, identifier)
        ).fetchone()
        conn.close()
        if user and check_password_hash(user["password_hash"], password):
            session["user_id"] = user["id"]
            return redirect(url_for("dashboard"))
        flash("Invalid credentials. Please try again.")
        return redirect(url_for("login"))
    return render_template("login.html")


@app.route("/signup", methods=["GET", "POST"])
def signup():
    if request.method == "POST":
        full_name = request.form.get("full_name", "").strip()
        username = request.form.get("username", "").strip()
        email = request.form.get("email", "").strip()
        password = request.form.get("password", "")

        if not all([full_name, username, email, password]):
            flash("All fields are required.")
            return redirect(url_for("signup"))

        conn = get_db()
        existing = conn.execute(
            "SELECT id FROM users WHERE email = ? OR username = ?", (email, username)
        ).fetchone()
        if existing:
            conn.close()
            flash("An account with that email or username already exists.")
            return redirect(url_for("signup"))

        password_hash = generate_password_hash(password)
        conn.execute(
            "INSERT INTO users (full_name, username, email, password_hash) VALUES (?, ?, ?, ?)",
            (full_name, username, email, password_hash),
        )
        conn.commit()
        user = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        conn.close()
        session["user_id"] = user["id"]
        return redirect(url_for("dashboard"))
    return render_template("signup.html")


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("index"))


@app.route("/dashboard")
@login_required
def dashboard():
    return render_template("dashboard.html", user=current_user(), ai_ready=bool(os.environ.get("GROQ_API_KEY")))


# ---------------------------------------------------------------------------
# API — settings
# ---------------------------------------------------------------------------

def user_api_key(user):
    return load_server_env(_ENV_PATH) or os.environ.get("GROQ_API_KEY")


@app.route("/api/profile", methods=["POST"])
@login_required
def api_update_profile():
    user = current_user()
    data = request.get_json(force=True)

    full_name = (data.get("full_name") or "").strip()
    username = (data.get("username") or "").strip()
    email = (data.get("email") or "").strip()

    if not all([full_name, username, email]):
        return jsonify({"error": "missing_fields", "message": "Full name, username, and email are required."}), 400

    conn = get_db()
    clash = conn.execute(
        "SELECT id FROM users WHERE (email = ? OR username = ?) AND id != ?",
        (email, username, user["id"]),
    ).fetchone()
    if clash:
        conn.close()
        return jsonify({"error": "conflict", "message": "That email or username is already taken."}), 409

    conn.execute(
        "UPDATE users SET full_name = ?, username = ?, email = ? WHERE id = ?",
        (full_name, username, email, user["id"]),
    )
    conn.commit()
    updated = conn.execute("SELECT full_name, username, email FROM users WHERE id = ?", (user["id"],)).fetchone()
    conn.close()

    return jsonify({"success": True, "user": dict(updated)})


@app.route("/api/profile/password", methods=["POST"])
@login_required
def api_update_password():
    user = current_user()
    data = request.get_json(force=True)

    current_password = data.get("current_password") or ""
    new_password = data.get("new_password") or ""

    if not new_password:
        return jsonify({"error": "missing_fields", "message": "Enter a new password."}), 400
    if len(new_password) < 8:
        return jsonify({"error": "weak_password", "message": "New password must be at least 8 characters."}), 400
    if not check_password_hash(user["password_hash"], current_password):
        return jsonify({"error": "invalid_password", "message": "Current password is incorrect."}), 403

    conn = get_db()
    conn.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        (generate_password_hash(new_password), user["id"]),
    )
    conn.commit()
    conn.close()

    return jsonify({"success": True})


# ---------------------------------------------------------------------------
# API — Ask OMINI (legal Q&A chat)
# ---------------------------------------------------------------------------

@app.route("/api/chat", methods=["POST"])
@login_required
def api_chat():
    user = current_user()
    data = request.get_json(force=True)
    message = (data.get("message") or "").strip()
    if not message:
        return jsonify({"error": "empty_message"}), 400

    conn = get_db()
    conn.execute(
        "INSERT INTO chat_messages (user_id, role, content) VALUES (?, 'user', ?)",
        (user["id"], message),
    )
    conn.commit()

    rows = conn.execute(
        "SELECT role, content FROM chat_messages WHERE user_id = ? ORDER BY id DESC LIMIT 12",
        (user["id"],),
    ).fetchall()
    conn.close()
    history = [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]

    key = user_api_key(user)
    if not key:
        return jsonify({"error": "no_api_key",
                         "message": "No Groq API key configured on the server yet. Set GROQ_API_KEY in a .env file and restart the app."})

    result = groq_client.chat_with_omini(key, history, user_name=user["full_name"].split(" ")[0])
    if "error" in result:
        return jsonify({"error": result["error"], "message": result.get("message", result["error"])}), 500

    conn = get_db()
    conn.execute(
        "INSERT INTO chat_messages (user_id, role, content) VALUES (?, 'assistant', ?)",
        (user["id"], result["reply"]),
    )
    conn.commit()
    conn.close()

    return jsonify({"reply": result["reply"]})


@app.route("/api/chat/history")
@login_required
def api_chat_history():
    conn = get_db()
    rows = conn.execute(
        "SELECT role, content, created_at FROM chat_messages WHERE user_id = ? ORDER BY id ASC LIMIT 100",
        (session["user_id"],),
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# ---------------------------------------------------------------------------
# API — Document / Privacy / Contract analyzer
# ---------------------------------------------------------------------------

@app.route("/api/analyze", methods=["POST"])
@login_required
def api_analyze():
    user = current_user()
    key = user_api_key(user)
    if not key:
        return jsonify({"error": "no_api_key",
                         "message": "No Groq API key configured on the server yet. Set GROQ_API_KEY in a .env file and restart the app."}), 400

    doc_type = request.form.get("doc_type", "other")

    text = ""
    filename = "pasted_text"
    if "file" in request.files and request.files["file"].filename:
        file = request.files["file"]
        if not allowed_file(file.filename):
            return jsonify({"error": "unsupported_file_type"}), 400
        filename = secure_filename(file.filename)
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        path = os.path.join(UPLOAD_DIR, f"{session['user_id']}_{filename}")
        file.save(path)
        text = extract_text(path)
    else:
        text = request.form.get("text", "")

    if not text or not text.strip():
        return jsonify({"error": "empty_document"}), 400

    result = groq_client.analyze_document(key, doc_type, text)
    if "error" in result:
        return jsonify({"error": result["error"], "message": result.get("message", result["error"])}), 500

    conn = get_db()
    conn.execute(
        "INSERT INTO documents (user_id, doc_type, filename, summary, danger_score, analysis_json) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (user["id"], doc_type, filename, result.get("summary", ""),
         result.get("danger_score", 0), json.dumps(result)),
    )
    conn.commit()
    conn.close()

    return jsonify(result)


@app.route("/api/documents")
@login_required
def api_documents():
    conn = get_db()
    rows = conn.execute(
        "SELECT id, doc_type, filename, summary, danger_score, created_at FROM documents "
        "WHERE user_id = ? ORDER BY id DESC LIMIT 50",
        (session["user_id"],),
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# ---------------------------------------------------------------------------
# API — Courtroom (Practice Court)
# ---------------------------------------------------------------------------

@app.route("/api/courtroom/message", methods=["POST"])
@login_required
def api_courtroom_message():
    """
    Interactive courtroom chat endpoint. Handles multi-stage conversation.
    Expected request JSON:
    {
      "message": "user message",
      "stage": 1-5,
      "case_title": "case title",
      "conversation_history": [{"role": "user"|"omini", "text": "..."}, ...]
    }
    """
    user = current_user()
    key = user_api_key(user)
    if not key:
        return jsonify({"error": "no_api_key",
                         "message": "No Groq API key configured on the server yet. Set GROQ_API_KEY in a .env file and restart the app."}), 400

    data = request.get_json(force=True)
    message = (data.get("message") or "").strip()
    stage = data.get("stage", 1)
    case_title = data.get("case_title", "Untitled Case")
    conversation_history = data.get("conversation_history", [])

    if not message:
        return jsonify({"error": "empty_message"}), 400

    # Build conversation history for groq_client
    history = []
    for msg in conversation_history[-10:]:  # Keep last 10 messages
        history.append({
            "role": "user" if msg.get("role") == "user" else "assistant",
            "content": msg.get("text", "")
        })

    # Stage-specific system prompts and logic
    stage_instructions = {
        1: """Guide the user: "Thank you. Now please tell me your side of the story — what happened from your perspective?"
Keep it brief and move to stage 2.""",
        
        2: """Listen to their side. Ask clarifying questions if needed. When you have a good understanding, say:
"Thank you. Now, let's hear the other side. What's the defendant's/other party's account of what happened?"
Then move to stage 3.""",
        
        3: """Listen to the other side's account. Be fair and neutral. When ready, ask:
"Do you have any evidence - like texts, emails, receipts, witnesses, or dates - that support your case?"
Then move to stage 4.""",
        
        4: """Let them describe evidence or say they have none. When done, respond:
"Thank you. I now have enough information to render a verdict. Let me review this case carefully."
Then move to stage 5.""",
        
        5: """You have all the information. Deliver a fair verdict:
Start with: "VERDICT: [Plaintiff Wins / Defendant Wins / Shared Responsibility / Insufficient Evidence / Mediation Recommended]"
Then explain your reasoning (2-3 sentences).
Then: "REASONING: [explanation]"
End with practical next steps."""
    }

    system_prompt = f"""You are OMINI, the AI Judge. You are fair, neutral, and thorough.
Case Title: {case_title}
Current Stage: {stage} of 5

{stage_instructions.get(stage, stage_instructions[1])}

Important: Keep responses short (2-3 sentences). Be encouraging. Progress the conversation naturally."""

    history.append({"role": "user", "content": message})

    try:
        completion = groq_client.get_client(key).chat.completions.create(
            model=groq_client.get_model_name(),
            messages=[{"role": "system", "content": system_prompt}] + history,
            temperature=0.6,
            max_tokens=512,
        )
        reply = completion.choices[0].message.content
    except Exception as e:
        error = groq_client._groq_error_message(e)
        return jsonify({"error": error["error"], "message": error.get("message", "OMINI is unavailable")}), 500

    # Auto-detect stage advancement
    next_stage = stage
    reply_lower = reply.lower()
    
    # Advance based on stage-specific keywords and patterns
    if stage == 1 and any(phrase in reply_lower for phrase in ["your side", "your perspective", "your account", "tell me your"]):
        next_stage = 2
    elif stage == 2 and any(phrase in reply_lower for phrase in ["other side", "defendant", "their account", "their perspective", "other party"]):
        next_stage = 3
    elif stage == 3 and any(phrase in reply_lower for phrase in ["evidence", "witness", "support your case", "documents", "receipts"]):
        next_stage = 4
    elif stage == 4 and any(phrase in reply_lower for phrase in ["enough information", "review", "verdict", "decision", "analyzed"]):
        next_stage = 5
    elif stage == 5:
        next_stage = 5  # Stay in verdict stage
    
    is_verdict = (next_stage == 5)

    # Store conversation in database
    try:
        conn = get_db()
        conn.execute(
            "INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?)",
            (user["id"], "user", f"[Courtroom S{stage}] {message}")
        )
        conn.execute(
            "INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?)",
            (user["id"], "assistant", f"[Courtroom S{next_stage}] {reply}")
        )
        conn.commit()
        conn.close()
    except:
        pass

    return jsonify({
        "reply": reply,
        "next_stage": next_stage,
        "is_verdict": is_verdict,
        "verdict": None
    })


@app.route("/api/courtroom/verdict", methods=["POST"])
@login_required
def api_courtroom_verdict():
    user = current_user()
    key = user_api_key(user)
    if not key:
        return jsonify({"error": "no_api_key",
                         "message": "No Groq API key configured on the server yet. Set GROQ_API_KEY in a .env file and restart the app."}), 400

    data = request.get_json(force=True)
    title = data.get("title", "Untitled Case")
    plaintiff = data.get("plaintiff_story", "")
    defendant = data.get("defendant_story", "")
    evidence = data.get("evidence_notes", "")

    if not plaintiff or not defendant:
        return jsonify({"error": "missing_stories"}), 400

    result = groq_client.judge_verdict(key, title, plaintiff, defendant, evidence)
    if "error" in result:
        return jsonify({"error": result["error"], "message": result.get("message", result["error"])}), 500

    conn = get_db()
    conn.execute(
        "INSERT INTO courtroom_cases (user_id, title, mode, status, verdict, transcript_json) "
        "VALUES (?, ?, 'practice', 'closed', ?, ?)",
        (user["id"], title, result.get("outcome", ""), json.dumps({
            "plaintiff": plaintiff, "defendant": defendant, "evidence": evidence, "result": result
        })),
    )
    conn.commit()
    conn.close()

    return jsonify(result)


# ---------------------------------------------------------------------------
# API — dashboard stats
# ---------------------------------------------------------------------------

@app.route("/api/stats")
@login_required
def api_stats():
    conn = get_db()
    uid = session["user_id"]
    docs = conn.execute("SELECT COUNT(*) c FROM documents WHERE user_id=?", (uid,)).fetchone()["c"]
    cases = conn.execute("SELECT COUNT(*) c FROM courtroom_cases WHERE user_id=?", (uid,)).fetchone()["c"]
    avg_danger = conn.execute(
        "SELECT AVG(danger_score) a FROM documents WHERE user_id=?", (uid,)
    ).fetchone()["a"]
    conn.close()
    success_rate = 100 - int(avg_danger) if avg_danger else 92
    return jsonify({
        "cases_analyzed": docs,
        "policies_scanned": docs,
        "courtroom_sessions": cases,
        "success_rate": max(1, min(99, success_rate)),
    })


# ---------------------------------------------------------------------------
# API — Community Court (live multi-party sessions)
# ---------------------------------------------------------------------------

COMMUNITY_UPLOAD_DIR = os.path.join(BASE_DIR, "uploads", "community")
MAX_WITNESSES_PER_SIDE = 3
MAX_QA_ROUNDS = 5


def _cc_case(conn, case_id):
    return conn.execute("SELECT * FROM community_cases WHERE id = ?", (case_id,)).fetchone()


def _cc_participants(conn, case_id):
    rows = conn.execute("""
        SELECT p.*, u.full_name, u.email, u.avatar
        FROM community_participants p JOIN users u ON u.id = p.user_id
        WHERE p.case_id = ? ORDER BY
            CASE p.role WHEN 'victim' THEN 0 WHEN 'defendant' THEN 1 ELSE 2 END, p.id ASC
    """, (case_id,)).fetchall()
    return [dict(r) for r in rows]


def _cc_participant_for(conn, case_id, user_id):
    row = conn.execute(
        "SELECT * FROM community_participants WHERE case_id = ? AND user_id = ?",
        (case_id, user_id),
    ).fetchone()
    return dict(row) if row else None


def _cc_messages(conn, case_id):
    rows = conn.execute(
        "SELECT * FROM community_messages WHERE case_id = ? ORDER BY id ASC", (case_id,)
    ).fetchall()
    return [dict(r) for r in rows]


def _cc_evidence(conn, case_id):
    rows = conn.execute("""
        SELECT e.*, u.full_name FROM community_evidence e JOIN users u ON u.id = e.user_id
        WHERE e.case_id = ? ORDER BY e.id ASC
    """, (case_id,)).fetchall()
    return [dict(r) for r in rows]


def _cc_say(conn, case_id, content, target_user_id=None, sender_type="ai", user_id=None, display_name="OMINI"):
    conn.execute(
        "INSERT INTO community_messages (case_id, sender_type, user_id, display_name, content, target_user_id) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (case_id, sender_type, user_id, display_name, content, target_user_id),
    )


def _cc_speaking_order(participants):
    """Victim, then defendant, then witnesses in the order they were added — accepted only."""
    ordered = [p for p in participants if p["role"] == "victim" and p["status"] == "accepted"]
    ordered += [p for p in participants if p["role"] == "defendant" and p["status"] == "accepted"]
    ordered += [p for p in participants if p["role"] == "witness" and p["status"] == "accepted"]
    return ordered


def _cc_serialize(conn, case_id, requesting_user_id):
    case = _cc_case(conn, case_id)
    if not case:
        return None
    case = dict(case)
    participants = _cc_participants(conn, case_id)
    me = next((p for p in participants if p["user_id"] == requesting_user_id), None)
    return {
        "case": case,
        "participants": participants,
        "messages": _cc_messages(conn, case_id),
        "evidence": _cc_evidence(conn, case_id),
        "me": me,
        "is_my_turn": bool(me and case.get("turn_participant_id") == me["id"]),
    }


def _cc_advance_statements(conn, case):
    """Move the turn to the next accepted participant who hasn't given a statement yet,
    or move on to the evidence stage once everyone has spoken."""
    participants = _cc_participants(conn, case["id"])
    order = _cc_speaking_order(participants)
    nxt = next((p for p in order if not p["has_spoken"]), None)
    if nxt:
        conn.execute("UPDATE community_cases SET turn_participant_id = ? WHERE id = ?", (nxt["id"], case["id"]))
        _cc_say(conn, case["id"],
                f"{nxt['full_name']}, please tell us what happened from your perspective.",
                target_user_id=nxt["user_id"])
    else:
        conn.execute(
            "UPDATE community_cases SET stage = 'evidence', turn_participant_id = NULL WHERE id = ?",
            (case["id"],),
        )
        _cc_say(conn, case["id"],
                "Thank you all for your statements. Now, please submit any evidence — messages, "
                "photos, receipts, documents — that supports your account. If you have none, "
                "you may decline.")


def _cc_maybe_advance_evidence(conn, case):
    participants = _cc_participants(conn, case["id"])
    order = _cc_speaking_order(participants)
    if order and all(p["evidence_status"] != "pending" for p in order):
        conn.execute(
            "UPDATE community_cases SET stage = 'questions', turn_participant_id = NULL WHERE id = ?",
            (case["id"],),
        )
        _cc_run_ai_question(conn, dict(_cc_case(conn, case["id"])))


def _cc_transcript_text(conn, case_id):
    lines = []
    for m in _cc_messages(conn, case_id):
        who = m["display_name"] or ("OMINI" if m["sender_type"] == "ai" else "System")
        lines.append(f"{who}: {m['content']}")
    for e in _cc_evidence(conn, case_id):
        lines.append(f"[Evidence from {e['full_name']}] {e['note'] or e['filename'] or 'submitted'}")
    return "\n".join(lines[-60:])


def _cc_fallback_verdict(conn, case):
    text = ("VERDICT: Insufficient Evidence\n"
            "REASONING: OMINI's AI reasoning isn't available right now (no Groq API key configured "
            "on the server), so a full deliberation couldn't be completed. Based on the statements "
            "and evidence gathered, the parties are encouraged to continue the conversation directly "
            "or bring this case back once AI review is available.")
    conn.execute(
        "UPDATE community_cases SET stage = 'verdict', status = 'closed', verdict = ?, turn_participant_id = NULL WHERE id = ?",
        (text, case["id"]),
    )
    _cc_say(conn, case["id"], text)


def _cc_run_ai_question(conn, case):
    """Ask OMINI (Groq) for the next clarifying question, or a verdict. Falls back gracefully
    if no API key is configured or the AI call fails."""
    user = conn.execute("SELECT * FROM users WHERE id = ?", (case["victim_id"],)).fetchone()
    key = user_api_key(user)
    participants = _cc_participants(conn, case["id"])
    order = _cc_speaking_order(participants)
    rounds = (case["qa_rounds"] or 0) + 1
    conn.execute("UPDATE community_cases SET qa_rounds = ? WHERE id = ?", (rounds, case["id"]))

    if not key or rounds > MAX_QA_ROUNDS:
        if not key:
            _cc_fallback_verdict(conn, case)
            return
        # Ran out of rounds with a key available — ask for a real verdict directly.

    names = ", ".join(f"{p['full_name']} ({p['role']})" for p in order)
    transcript = _cc_transcript_text(conn, case["id"])
    force_verdict = rounds > MAX_QA_ROUNDS

    system_prompt = f"""You are OMINI, a fair and neutral AI judge presiding over a live community court case titled "{case['title']}".
Participants: {names}.
Here is the transcript so far (statements, evidence, and prior Q&A):
{transcript}

{"You must now deliver a final verdict — do not ask another question." if force_verdict else "Decide whether you need to ask ONE clarifying question to a specific participant, or whether you have enough to deliver a verdict."}
If asking a question, respond in EXACTLY this format (two lines):
TO: <full name of the participant you are addressing>
<your one, short, clear question>

If delivering a verdict, respond in EXACTLY this format:
VERDICT: [Plaintiff Wins / Defendant Wins / Shared Responsibility / Insufficient Evidence / Mediation Recommended]
REASONING: [2-4 sentences explaining your reasoning fairly and neutrally]
Keep everything concise."""

    try:
        completion = groq_client.get_client(key).chat.completions.create(
            model=groq_client.get_model_name(),
            messages=[{"role": "system", "content": system_prompt},
                      {"role": "user", "content": "Continue the hearing."}],
            temperature=0.5,
            max_tokens=350,
        )
        reply = (completion.choices[0].message.content or "").strip()
    except Exception:
        _cc_fallback_verdict(conn, case)
        return

    if reply.upper().startswith("VERDICT:"):
        conn.execute(
            "UPDATE community_cases SET stage = 'verdict', status = 'closed', verdict = ?, turn_participant_id = NULL WHERE id = ?",
            (reply, case["id"]),
        )
        _cc_say(conn, case["id"], reply)
        return

    # Parse "TO: <name>" targeting line
    target = None
    lines = reply.splitlines()
    question = reply
    if lines and lines[0].upper().startswith("TO:"):
        target_name = lines[0][3:].strip().lower()
        question = "\n".join(lines[1:]).strip() or "Can you clarify further?"
        target = next((p for p in order if target_name in p["full_name"].lower()), None)
    if not target:
        target = order[0] if order else None

    conn.execute(
        "UPDATE community_cases SET turn_participant_id = ? WHERE id = ?",
        (target["id"] if target else None, case["id"]),
    )
    _cc_say(conn, case["id"], question, target_user_id=(target["user_id"] if target else None))


@app.route("/api/community/cases", methods=["GET", "POST"])
@login_required
def api_community_cases():
    user = current_user()
    conn = get_db()

    if request.method == "POST":
        data = request.get_json(force=True)
        title = (data.get("title") or "").strip()
        if not title:
            conn.close()
            return jsonify({"error": "missing_title", "message": "Please give your case a title."}), 400

        cur = conn.execute(
            "INSERT INTO community_cases (title, victim_id, status, stage) VALUES (?, ?, 'setup', 'none')",
            (title, user["id"]),
        )
        case_id = cur.lastrowid
        conn.execute(
            "INSERT INTO community_participants (case_id, user_id, role, side, status) "
            "VALUES (?, ?, 'victim', 'victim', 'accepted')",
            (case_id, user["id"]),
        )
        _cc_say(conn, case_id,
                f"Welcome. This is a live OMINI Community Court session for \"{title}\". "
                f"{user['full_name']} is acting as the victim / plaintiff. Add the other party "
                f"by their email to get started.", sender_type="ai")
        conn.commit()
        result = _cc_serialize(conn, case_id, user["id"])
        conn.close()
        return jsonify(result)

    rows = conn.execute("""
        SELECT c.*, p.role as my_role, p.status as my_status,
               (SELECT full_name FROM users WHERE id = c.victim_id) as victim_name,
               (SELECT full_name FROM users WHERE id = c.defendant_id) as defendant_name
        FROM community_cases c JOIN community_participants p ON p.case_id = c.id
        WHERE p.user_id = ? ORDER BY c.id DESC
    """, (user["id"],)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/community/notifications")
@login_required
def api_community_notifications():
    conn = get_db()
    rows = conn.execute("""
        SELECT p.id as participant_id, p.case_id, p.role, p.side, c.title,
               (SELECT full_name FROM users WHERE id = p.invited_by) as invited_by_name
        FROM community_participants p JOIN community_cases c ON c.id = p.case_id
        WHERE p.user_id = ? AND p.status = 'pending' ORDER BY p.id DESC
    """, (session["user_id"],)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/community/cases/<int:case_id>")
@login_required
def api_community_case_detail(case_id):
    conn = get_db()
    me = _cc_participant_for(conn, case_id, session["user_id"])
    if not me:
        conn.close()
        return jsonify({"error": "not_found"}), 404
    result = _cc_serialize(conn, case_id, session["user_id"])
    conn.close()
    return jsonify(result)


@app.route("/api/community/cases/<int:case_id>/invite", methods=["POST"])
@login_required
def api_community_invite(case_id):
    user = current_user()
    data = request.get_json(force=True)
    email = (data.get("email") or "").strip().lower()
    role = data.get("role")  # 'defendant' | 'witness'

    if not email or role not in ("defendant", "witness"):
        return jsonify({"error": "invalid_request", "message": "Provide a valid email and role."}), 400

    conn = get_db()
    case = _cc_case(conn, case_id)
    me = _cc_participant_for(conn, case_id, user["id"])
    if not case or not me or me["status"] != "accepted" or me["role"] not in ("victim", "defendant"):
        conn.close()
        return jsonify({"error": "forbidden", "message": "You can't invite anyone to this case."}), 403

    target = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not target:
        conn.close()
        return jsonify({"error": "not_found", "message": "No OMINI account found with that email."}), 404
    if target["id"] == user["id"]:
        conn.close()
        return jsonify({"error": "invalid_target", "message": "You can't invite yourself."}), 400

    existing = conn.execute(
        "SELECT * FROM community_participants WHERE case_id = ? AND user_id = ? AND status != 'declined'",
        (case_id, target["id"]),
    ).fetchone()
    if existing:
        conn.close()
        return jsonify({"error": "already_invited", "message": "That person is already part of this case."}), 409

    if role == "defendant":
        if dict(case)["status"] != "setup" or case["defendant_id"]:
            conn.close()
            return jsonify({"error": "invalid_state", "message": "A defendant has already been added."}), 409
        conn.execute(
            "INSERT INTO community_participants (case_id, user_id, role, side, status, invited_by) "
            "VALUES (?, ?, 'defendant', 'defendant', 'pending', ?)",
            (case_id, target["id"], user["id"]),
        )
        conn.execute(
            "UPDATE community_cases SET defendant_id = ?, status = 'awaiting_defendant' WHERE id = ?",
            (target["id"], case_id),
        )
        _cc_say(conn, case_id, f"{user['full_name']} has invited {target['full_name']} to join as the defendant.")
    else:
        side = me["role"]  # witnesses join on the side of whoever invited them
        if me["status"] != "accepted" or (side == "defendant" and dict(case)["status"] == "awaiting_defendant"):
            conn.close()
            return jsonify({"error": "invalid_state", "message": "You can add witnesses once you've joined the case."}), 409
        count = conn.execute(
            "SELECT COUNT(*) c FROM community_participants WHERE case_id = ? AND role='witness' AND side=? AND status != 'declined'",
            (case_id, side),
        ).fetchone()["c"]
        if count >= MAX_WITNESSES_PER_SIDE:
            conn.close()
            return jsonify({"error": "limit_reached", "message": f"You can add up to {MAX_WITNESSES_PER_SIDE} witnesses."}), 409
        conn.execute(
            "INSERT INTO community_participants (case_id, user_id, role, side, status, invited_by) "
            "VALUES (?, ?, 'witness', ?, 'pending', ?)",
            (case_id, target["id"], side, user["id"]),
        )
        _cc_say(conn, case_id, f"{user['full_name']} has invited {target['full_name']} as a witness ({side}'s side).")

    conn.commit()
    result = _cc_serialize(conn, case_id, user["id"])
    conn.close()
    return jsonify(result)


@app.route("/api/community/cases/<int:case_id>/respond", methods=["POST"])
@login_required
def api_community_respond(case_id):
    user = current_user()
    data = request.get_json(force=True)
    response = data.get("response")  # 'accept' | 'decline'
    if response not in ("accept", "decline"):
        return jsonify({"error": "invalid_request"}), 400

    conn = get_db()
    me = _cc_participant_for(conn, case_id, user["id"])
    if not me or me["status"] != "pending":
        conn.close()
        return jsonify({"error": "invalid_state", "message": "There's no pending invite for you here."}), 409

    new_status = "accepted" if response == "accept" else "declined"
    conn.execute("UPDATE community_participants SET status = ? WHERE id = ?", (new_status, me["id"]))

    case = dict(_cc_case(conn, case_id))
    if me["role"] == "defendant":
        if response == "accept":
            conn.execute("UPDATE community_cases SET status = 'gathering' WHERE id = ?", (case_id,))
            _cc_say(conn, case_id, f"{user['full_name']} has accepted and joined as the defendant.")
        else:
            conn.execute("UPDATE community_cases SET status = 'declined' WHERE id = ?", (case_id,))
            _cc_say(conn, case_id, f"{user['full_name']} has declined to participate. This case is now closed.")
    else:
        verb = "joined as a witness" if response == "accept" else "declined to join as a witness"
        _cc_say(conn, case_id, f"{user['full_name']} has {verb}.")

    conn.commit()
    result = _cc_serialize(conn, case_id, user["id"])
    conn.close()
    return jsonify(result)


@app.route("/api/community/cases/<int:case_id>/begin", methods=["POST"])
@login_required
def api_community_begin(case_id):
    user = current_user()
    conn = get_db()
    me = _cc_participant_for(conn, case_id, user["id"])
    case = _cc_case(conn, case_id)
    if not case or not me or me["role"] != "victim":
        conn.close()
        return jsonify({"error": "forbidden", "message": "Only the person who filed the case can begin the hearing."}), 403
    if dict(case)["status"] != "gathering":
        conn.close()
        return jsonify({"error": "invalid_state", "message": "The defendant needs to accept before the hearing can begin."}), 409

    conn.execute(
        "UPDATE community_cases SET status = 'hearing', stage = 'statements' WHERE id = ?", (case_id,)
    )
    _cc_say(conn, case_id, "The hearing is now beginning. I'll ask each of you, one at a time, to share what happened.")
    conn.commit()
    _cc_advance_statements(conn, dict(_cc_case(conn, case_id)))
    conn.commit()
    result = _cc_serialize(conn, case_id, user["id"])
    conn.close()
    return jsonify(result)


@app.route("/api/community/cases/<int:case_id>/message", methods=["POST"])
@login_required
def api_community_message(case_id):
    user = current_user()
    data = request.get_json(force=True)
    message = (data.get("message") or "").strip()
    if not message:
        return jsonify({"error": "empty_message"}), 400

    conn = get_db()
    me = _cc_participant_for(conn, case_id, user["id"])
    case = _cc_case(conn, case_id)
    if not case or not me or me["status"] != "accepted":
        conn.close()
        return jsonify({"error": "forbidden"}), 403
    case = dict(case)
    if case["status"] != "hearing" or case["stage"] not in ("statements", "questions"):
        conn.close()
        return jsonify({"error": "invalid_state", "message": "It's not time for messages right now."}), 409
    if case["turn_participant_id"] != me["id"]:
        conn.close()
        return jsonify({"error": "not_your_turn", "message": "Please wait for your turn to speak."}), 409

    _cc_say(conn, case_id, message, sender_type="user", user_id=user["id"], display_name=user["full_name"])

    if case["stage"] == "statements":
        conn.execute("UPDATE community_participants SET has_spoken = 1 WHERE id = ?", (me["id"],))
        conn.commit()
        _cc_advance_statements(conn, dict(_cc_case(conn, case_id)))
    else:  # questions stage
        conn.commit()
        _cc_run_ai_question(conn, dict(_cc_case(conn, case_id)))

    conn.commit()
    result = _cc_serialize(conn, case_id, user["id"])
    conn.close()
    return jsonify(result)


@app.route("/api/community/cases/<int:case_id>/decline_answer", methods=["POST"])
@login_required
def api_community_decline_answer(case_id):
    user = current_user()
    conn = get_db()
    me = _cc_participant_for(conn, case_id, user["id"])
    case = _cc_case(conn, case_id)
    if not case or not me:
        conn.close()
        return jsonify({"error": "forbidden"}), 403
    case = dict(case)
    if case["stage"] != "questions" or case["turn_participant_id"] != me["id"]:
        conn.close()
        return jsonify({"error": "invalid_state"}), 409

    _cc_say(conn, case_id, f"{user['full_name']} chose not to answer that question.",
            sender_type="system")
    conn.commit()
    _cc_run_ai_question(conn, dict(_cc_case(conn, case_id)))
    conn.commit()
    result = _cc_serialize(conn, case_id, user["id"])
    conn.close()
    return jsonify(result)


@app.route("/api/community/cases/<int:case_id>/evidence", methods=["POST"])
@login_required
def api_community_evidence(case_id):
    user = current_user()
    conn = get_db()
    me = _cc_participant_for(conn, case_id, user["id"])
    case = _cc_case(conn, case_id)
    if not case or not me or me["status"] != "accepted":
        conn.close()
        return jsonify({"error": "forbidden"}), 403
    case = dict(case)
    if case["status"] != "hearing" or case["stage"] != "evidence":
        conn.close()
        return jsonify({"error": "invalid_state", "message": "Evidence isn't being collected right now."}), 409
    if me["evidence_status"] != "pending":
        conn.close()
        return jsonify({"error": "already_done", "message": "You've already responded to the evidence request."}), 409

    decline = request.form.get("decline") == "true"
    if decline:
        conn.execute("UPDATE community_participants SET evidence_status = 'declined' WHERE id = ?", (me["id"],))
        _cc_say(conn, case_id, f"{user['full_name']} has no evidence to submit.")
    else:
        note = (request.form.get("note") or "").strip()
        filename = None
        if "file" in request.files and request.files["file"].filename:
            file = request.files["file"]
            filename = secure_filename(f"{case_id}_{user['id']}_{file.filename}")
            os.makedirs(COMMUNITY_UPLOAD_DIR, exist_ok=True)
            file.save(os.path.join(COMMUNITY_UPLOAD_DIR, filename))
        if not filename and not note:
            conn.close()
            return jsonify({"error": "empty_evidence", "message": "Attach a file or add a note."}), 400
        conn.execute(
            "INSERT INTO community_evidence (case_id, user_id, filename, note) VALUES (?, ?, ?, ?)",
            (case_id, user["id"], filename, note),
        )
        conn.execute("UPDATE community_participants SET evidence_status = 'submitted' WHERE id = ?", (me["id"],))
        _cc_say(conn, case_id, f"{user['full_name']} submitted evidence" + (f": {note}" if note else "."))

    conn.commit()
    _cc_maybe_advance_evidence(conn, dict(_cc_case(conn, case_id)))
    conn.commit()
    result = _cc_serialize(conn, case_id, user["id"])
    conn.close()
    return jsonify(result)


if __name__ == "__main__":
    debug_mode = os.environ.get("FLASK_DEBUG", "false").strip().lower() in ("1", "true", "yes")
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=debug_mode, host="0.0.0.0", port=port)