import os
import json
from groq import Groq

DEFAULT_MODEL = os.environ.get("GROQ_MODEL") 


def get_model_name():
    return os.environ.get("GROQ_MODEL")


def get_client(api_key=None):
    key = api_key or os.environ.get("GROQ_API_KEY")
    if not key:
        return None
    return Groq(api_key=key)


def _groq_error_message(exc):
    raw = str(exc).lower()
    if "invalid_api_key" in raw or "401" in raw:
        return {
            "error": "invalid_api_key",
            "message": "The Groq API key in the server .env is invalid or expired. Replace it with a valid key from the Groq console and restart the app.",
        }
    if "model_not_found" in raw or "does not exist" in raw or "not exist" in raw:
        return {
            "error": "model_not_found",
            "message": "The configured Groq model is unavailable. Set GROQ_MODEL to a supported model or use the default model.",
        }
    return {"error": "groq_error", "message": str(exc)}


def chat_with_omini(api_key, history, user_name="there"):
    """
    history: list of {"role": "user"|"assistant", "content": str}
    Returns plain text reply from OMINI, the legal AI assistant.
    """
    client = get_client(api_key)
    if client is None:
        return {"error": "no_api_key"}

    system_prompt = f"""You are OMINI, the AI legal assistant inside OMINI AI LAW, a futuristic legal operating system.
You speak to {user_name}. You are friendly, professional, occasionally lightly witty, and always precise about law.
For every legal question:
- Give a clear, direct answer first.
- Mention relevant laws/frameworks when relevant (e.g. GDPR, CCPA, NDPR, HIPAA, labor law, tenancy law) but note you are not a substitute for a licensed attorney.
- Note that laws vary by country/state, and ask for jurisdiction if it materially changes the answer.
- Keep answers concise and structured with short paragraphs or bullet points.
Never fabricate case law or statute numbers you are not confident about; say when something needs verification by a local lawyer.
"""
    messages = [{"role": "system", "content": system_prompt}] + history
    try:
        completion = client.chat.completions.create(
            model=get_model_name(),
            messages=messages,
            temperature=0.5,
            max_tokens=1024,
        )
        return {"reply": completion.choices[0].message.content}
    except Exception as e:
        return _groq_error_message(e)


def analyze_document(api_key, doc_type, text):
    """
    doc_type: 'privacy_policy' | 'terms_of_service' | 'contract' | 'nda' | 'lease' | 'other'
    Returns structured JSON analysis.
    """
    client = get_client(api_key)
    if client is None:
        return {"error": "no_api_key"}

    text = text[:15000]  # keep prompt manageable

    system_prompt = """You are a legal document analysis engine inside OMINI AI LAW.
You analyze the provided document and respond with STRICT JSON ONLY (no markdown fences, no preamble), matching this schema exactly:

{
  "summary": "2-4 sentence plain-English summary",
  "danger_score": 0-100 integer (higher = riskier for the person who signs/accepts it),
  "risk_level": "Low" | "Medium" | "High",
  "key_risks": ["short risk 1", "short risk 2", ...],
  "hidden_clauses": ["..."],
  "data_collected": ["..."],
  "user_rights": ["..."],
  "red_flags": [{"clause": "short quote or paraphrase", "why_risky": "short explanation"}],
  "recommendations": ["..."]
}

Populate every field. Use empty arrays if genuinely not applicable. Be specific to the actual document text given, not generic boilerplate."""

    user_prompt = f"Document type: {doc_type}\n\nDocument text:\n{text}"

    try:
        completion = client.chat.completions.create(
            model=get_model_name(),
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=1500,
            response_format={"type": "json_object"},
        )
        raw = completion.choices[0].message.content
        return json.loads(raw)
    except Exception as e:
        return _groq_error_message(e)


def judge_verdict(api_key, case_title, plaintiff_story, defendant_story, evidence_notes=""):
    client = get_client(api_key)
    if client is None:
        return {"error": "no_api_key"}

    system_prompt = """You are an AI Judge inside OMINI AI LAW's courtroom simulator. You are neutral, thorough, and explain your reasoning.
Respond with STRICT JSON ONLY matching this schema:

{
  "outcome": "Plaintiff Wins" | "Defendant Wins" | "Shared Responsibility" | "Insufficient Evidence" | "Mediation Recommended",
  "confidence": 0-100 integer,
  "reasoning": "3-6 sentence explanation of the reasoning",
  "evidence_used": ["..."],
  "evidence_ignored_or_missing": ["..."],
  "relevant_legal_principles": ["..."],
  "bias_warning": "a short note on any limitation or potential bias in this AI verdict, or empty string if none"
}"""

    user_prompt = f"""Case: {case_title}

Plaintiff's account:
{plaintiff_story}

Defendant's account:
{defendant_story}

Evidence notes:
{evidence_notes or "None provided"}"""

    try:
        completion = client.chat.completions.create(
            model=get_model_name(),
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.4,
            max_tokens=1200,
            response_format={"type": "json_object"},
        )
        raw = completion.choices[0].message.content
        return json.loads(raw)
    except Exception as e:
        return _groq_error_message(e)
