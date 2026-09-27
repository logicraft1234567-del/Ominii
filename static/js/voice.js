/* =========================================================
   OMINI — shared voice module
   One place for text-to-speech (OMINI speaking) and
   push-to-talk speech-to-text (mic button), so every
   OMINI surface (Practice Courtroom, Community Court, ...)
   sounds and behaves exactly the same.
   ========================================================= */

window.OminiVoice = (function () {
  let cachedVoice = null;
  let voiceListReady = false;

  function pickVoice() {
    if (!("speechSynthesis" in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;

    if (cachedVoice && voices.includes(cachedVoice)) return cachedVoice;

    let selected = voices.find(v =>
      /female|woman|victoria|samantha/i.test(v.name)
    );
    if (!selected) selected = voices[1] || voices[0];
    cachedVoice = selected;
    return selected;
  }

  // Some browsers load the voice list asynchronously — warm the cache
  // as soon as it's available so the first utterance doesn't sound flat.
  if ("speechSynthesis" in window) {
    window.speechSynthesis.onvoiceschanged = () => {
      voiceListReady = true;
      pickVoice();
    };
  }

  function isSupported() {
    return "speechSynthesis" in window;
  }

  function cancel() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  /**
   * Speak `text` as OMINI.
   * opts: { rate=0.95, pitch=1.1, volume=1, onStart, onEnd, onError }
   * Returns true if an utterance was queued, false if voice is unsupported.
   */
  function speak(text, opts = {}) {
    if (!text) return false;
    cancel(); // never overlap OMINI's own lines

    if (!isSupported()) {
      opts.onError && opts.onError(new Error("speechSynthesis unsupported"));
      return false;
    }

    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = opts.rate ?? 0.95;
      utterance.pitch = opts.pitch ?? 1.1;
      utterance.volume = opts.volume ?? 1;

      const voice = pickVoice();
      if (voice) utterance.voice = voice;

      utterance.onstart = () => opts.onStart && opts.onStart();
      utterance.onend = () => opts.onEnd && opts.onEnd();
      utterance.onerror = (e) => opts.onError && opts.onError(e);

      window.speechSynthesis.speak(utterance);
      return true;
    } catch (e) {
      opts.onError && opts.onError(e);
      return false;
    }
  }

  /**
   * Wire a "hold to speak" mic button to the Web Speech API.
   * btn: the mic <button>. Held down (mouse or touch) to record.
   * opts: { onStart, onResult(transcript), onError, onEnd, isDisabled() }
   * Returns the SpeechRecognition instance, or null if unsupported —
   * in which case the button is automatically disabled/greyed out.
   */
  function attachPushToTalk(btn, opts = {}) {
    if (!btn) return null;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      btn.title = "Voice input not supported in this browser";
      btn.style.opacity = "0.5";
      btn.style.cursor = "not-allowed";
      return null;
    }

    const recog = new SpeechRecognition();
    recog.continuous = false;
    recog.lang = "en-US";
    let active = false;
    let stoppedByUs = false;

    const start = () => {
      if (opts.isDisabled && opts.isDisabled()) return;
      if (active) return;
      active = true;
      stoppedByUs = false;
      opts.onStart && opts.onStart();
      try { recog.start(); } catch (e) { /* already running */ }
    };
    const stop = () => {
      if (!active) return;
      active = false;
      stoppedByUs = true;
      try { recog.stop(); } catch (e) { /* not running */ }
    };

    btn.addEventListener("mousedown", start);
    btn.addEventListener("touchstart", (e) => { e.preventDefault(); start(); }, { passive: false });
    ["mouseup", "mouseleave"].forEach(evt => btn.addEventListener(evt, stop));
    ["touchend", "touchcancel"].forEach(evt => btn.addEventListener(evt, stop));

    recog.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      opts.onResult && opts.onResult(transcript);
    };

    recog.onerror = (e) => {
      active = false;
      console.warn("[OminiVoice] SpeechRecognition error:", e.error, e);

      // Chrome fires a harmless "aborted" error whenever recog.stop() is
      // called (e.g. a quick tap, or letting go of the button) — that's
      // expected, not a failure, so don't surface it as one.
      if (e.error === "aborted" && stoppedByUs) return;

      const messages = {
        "not-allowed": "Microphone permission is blocked — allow mic access for this site in your browser settings.",
        "service-not-allowed": "Microphone permission is blocked — allow mic access for this site in your browser settings.",
        "no-speech": "Didn't catch that — hold the button down while you speak, then release.",
        "audio-capture": "No microphone found — check it's connected and not in use by another app.",
        "network": "Network error reaching the speech service — check your connection.",
        "aborted": "Voice input was interrupted — try again.",
      };
      const message = messages[e.error] || `Microphone error (${e.error || "unknown"}).`;
      opts.onError && opts.onError({ code: e.error, message });
    };
    recog.onend = () => { active = false; opts.onEnd && opts.onEnd(); };

    return recog;
  }

  return { isSupported, cancel, speak, attachPushToTalk };
})();