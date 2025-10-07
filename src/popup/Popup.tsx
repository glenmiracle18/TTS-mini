import { useEffect, useMemo, useRef, useState } from "react";
import SyntaxHighlighter from "./syntaxHighlighter";

type VoiceOption = SpeechSynthesisVoice & { id: string };

type Prefs = {
  rate: number;
  volume: number;
  voiceURI?: string;
  theme: ThemeMode;
  syntaxHighlighting: boolean;
};

type ThemeMode = "light" | "dark" | "system";
const defaultPrefs: Prefs = {
  rate: 1,
  volume: 1,
  theme: "system",
  syntaxHighlighting: true,
};

const STORAGE_KEY = "speechifyMiniPrefs_v1";

// theme management
const useTheme = (themePreference: ThemeMode) => {
  const [currentTheme, setCurrentTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const updateTheme = () => {
      let newTheme: "light" | "dark";

      if (themePreference === "system") {
        newTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
      } else {
        newTheme = themePreference;
      }

      setCurrentTheme(newTheme);
      document.documentElement.setAttribute("data-theme", newTheme);
      document.body.className = `theme-${newTheme}`;
    };

    updateTheme();

    if (themePreference === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      mediaQuery.addEventListener("change", updateTheme);
      return () => mediaQuery.removeEventListener("change", updateTheme);
    }
  }, [themePreference]);

  return currentTheme;
};

// Load preferences from storage. It returns a promise that resolves to the preferences object.
const loadPrefs = async (): Promise<Prefs> => {
  return new Promise((res) => {
    chrome.storage.sync.get([STORAGE_KEY], (obj) => {
      res({ ...defaultPrefs, ...(obj?.[STORAGE_KEY] || {}) });
    });
  });
};

// Save preferences to storage. It takes the preferences object and returns a promise that resolves when the preferences are saved.
const savePrefs = async (prefs: Prefs) => {
  chrome.storage.sync.set({ [STORAGE_KEY]: prefs });
};

const getActiveTabId = async (): Promise<number | undefined> => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
};

const Popup: React.FC = () => {
  // the ui state

  const [text, setText] = useState("");
  // state for when speaking is happenning
  const [isSpeaking, setIsSpeaking] = useState(false);
  // available tts voices
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  // stored preferences
  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs);
  // lightweight "highlight" tracker and textarea
  const [currentWordIndex, setCurrentIndex] = useState<number>(-1);

  // holds the current SpeechSynthesisUtterance instance so we can stop/cancel safely
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Use theme hook
  const currentTheme = useTheme(prefs.theme);

  // load prefs on page load once
  useEffect(() => {
    loadPrefs().then(setPrefs);
  }, []);

  // Each time prefs changes, we wait 250ms and save to storage. The cleanup cancels pending writes if the value changes again quickly.
  useEffect(() => {
    const id = setTimeout(() => savePrefs(prefs), 250);
    clearTimeout(id);
  }, [prefs]);

  // load voice from (async)
  useEffect(() => {
    const loadVoices = () => {
      const availableVoices = speechSynthesis
        .getVoices()
        .map((v, i) => Object.assign(v, { id: v.voiceURI || String(i) }));

      setVoices(availableVoices);

      // Set default English voice if none selected
      if (availableVoices.length && !prefs.voiceURI) {
        const en = availableVoices.find((v) =>
          v.lang?.toLowerCase().startsWith("en"),
        );
        setPrefs((p) => ({
          ...p,
          voiceURI: en?.voiceURI || availableVoices[0].voiceURI,
        }));
      }
    };

    // Load voices immediately
    loadVoices();

    // Also load when voices become available (some browsers load them async)
    speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      speechSynthesis.onvoiceschanged = null;
    };
  }, [prefs.voiceURI]); // Add dependency

  // cancel speech on unmount
  useEffect(() => {
    return () => {
      speechSynthesis.cancel();
    };
  }, []);

  const selectedVoice = useMemo(
    () => voices.find((v) => v.voiceURI === prefs.voiceURI),
    [voices, prefs.voiceURI],
  );

  // get text from the page
  const fetchSelection = async () => {
    try {
      const tabId = await getActiveTabId();
      if (!tabId) {
        setText("❌ No active tab found");
        return;
      }

      setText("⏳ Getting selection...");
      const res = await chrome.tabs.sendMessage(tabId, {
        type: "GET_SELECTION",
      });
      const selectedText = res || "";

      if (selectedText.trim()) {
        setText(selectedText);
      } else {
        setText("⚠️ No text selected on page");
      }
    } catch (error) {
      console.error("Failed to get selection:", error);
      setText("❌ Failed to get selection. Try reloading the page.");
    }
  };

  const stop = () => {
    speechSynthesis.cancel();
    setIsSpeaking(false);
    setCurrentIndex(-1);
  };

  const speak = () => {
    if (!text.trim()) return;

    if (speechSynthesis.speaking) {
      stop();
      // allow next tick to start cleanly
      setTimeout(speak, 0);
      return;
    }

    // create a new utterance
    // SpeechSynthesisUtterance is the unit of speech in the Web Speech API.

    const u = new SpeechSynthesisUtterance(text);
    u.rate = prefs.rate;
    u.volume = prefs.volume;
    if (selectedVoice) u.voice = selectedVoice;

    // simple word boundary highlighting for textarea display
    const words = text.split(/\s+/);

    u.onboundary = (ev: SpeechSynthesisEvent) => {
      if (ev.name === "word" || ev.charIndex >= 0) {
        // fallback heuristic: estimate word by charIndex
        // We map charIndex -> workd index by counting spaces up to charIndex
        const upto = text.slice(0, ev.charIndex);
        const idx = upto.trim() ? upto.trim().split(/\s+/).length - 1 : -1;
        setCurrentIndex(Math.min(Math.max(idx, 0), words.length - 1));
      }
    };

    u.onend = () => {
      setIsSpeaking(false);
      setCurrentIndex(-1);
    };
    u.onerror = () => {
      setIsSpeaking(false);
      setCurrentIndex(-1);
    };

    utteranceRef.current = u;
    setIsSpeaking(true);
    speechSynthesis.speak(u);
  };

  const pauseOrResume = () => {
    if (!speechSynthesis.speaking) return;
    if (speechSynthesis.paused) {
      speechSynthesis.resume();
      setIsSpeaking(true);
    } else {
      speechSynthesis.pause();
      setIsSpeaking(false);
    }
  };

  // Theme toggle function
  const toggleTheme = () => {
    const themes: ThemeMode[] = ["system", "light", "dark"];
    const currentIndex = themes.indexOf(prefs.theme);
    const nextTheme = themes[(currentIndex + 1) % themes.length];
    setPrefs((p) => ({ ...p, theme: nextTheme }));
  };

  // Get theme icon
  const getThemeIcon = () => {
    if (prefs.theme === "system") return "🔄";
    return currentTheme === "dark" ? "🌙" : "☀️";
  };

  return (
    <div className="container">
      <h3>Speechify Mini</h3>
      <button
        className="theme-toggle"
        onClick={toggleTheme}
        title={`Theme: ${prefs.theme} (click to cycle)`}
      >
        {getThemeIcon()}
      </button>
      <div className="small">
        Select text on a page, then click "Grab Selection" to start reading.
      </div>

      <div className="row">
        <button onClick={fetchSelection}>📋 Grab Selection</button>
        <button onClick={() => setText("")}>🗑️ Clear</button>
      </div>

      {/* Conditional rendering based on syntax highlighting preference */}
      {prefs.syntaxHighlighting ? (
        <SyntaxHighlighter
          text={text}
          currentWordIndex={currentWordIndex}
          isSpeaking={isSpeaking}
          onChange={setText}
          theme={currentTheme}
        />
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Selected text will appear here. You can also type or paste text directly."
          aria-label="Text to read"
          className="syntax-textarea"
          style={{
            color: "var(--text-primary)",
            background: "var(--surface-color)",
          }}
        />
      )}

      <div className="control-group">
        <div className="control-row">
          <label htmlFor="voice">Voice</label>
          <select
            id="voice"
            value={prefs.voiceURI || ""}
            onChange={(e) =>
              setPrefs((p) => ({ ...p, voiceURI: e.target.value }))
            }
          >
            {voices.length === 0 ? (
              <option>Loading voices...</option>
            ) : (
              voices.map((v) => (
                <option key={v.id} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))
            )}
          </select>
        </div>

        <div className="control-row">
          <label htmlFor="rate">Speed {prefs.rate.toFixed(1)}x</label>
          <input
            id="rate"
            type="range"
            min={0.5}
            max={2.0}
            step={0.1}
            value={prefs.rate}
            onChange={(e) =>
              setPrefs((p) => ({ ...p, rate: Number(e.target.value) }))
            }
          />
        </div>

        <div className="control-row">
          <label htmlFor="vol">Volume {Math.round(prefs.volume * 100)}%</label>
          <input
            id="vol"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={prefs.volume}
            onChange={(e) =>
              setPrefs((p) => ({ ...p, volume: Number(e.target.value) }))
            }
          />
        </div>
      </div>

      <div className="row">
        <button onClick={speak} disabled={!text.trim()}>
          ▶️ Play
        </button>
        <button onClick={pauseOrResume} disabled={!speechSynthesis.speaking}>
          ⏯️ {speechSynthesis.paused ? "Resume" : "Pause"}
        </button>
        <button onClick={stop} disabled={!isSpeaking}>
          ⏹️ Stop
        </button>
      </div>

      {isSpeaking && currentWordIndex >= 0 && (
        <div className="status-indicator speaking">
          <span className="speaking-indicator">🎵</span>
          Speaking word #{currentWordIndex + 1}
        </div>
      )}

      <div className="tips">
        <div className="small">
          💡 <strong>Tips:</strong> You can edit text directly before playback.
          Settings are automatically saved. Works best with English text.
        </div>
      </div>
    </div>
  );
};

export default Popup;
