// Browser SpeechSynthesis com configurações ajustáveis (equalizador)
export type TTSConfig = {
  voiceName: string; // nome exato da voz escolhida
  rate: number;      // 0.5 - 2
  pitch: number;     // 0 - 2
  volume: number;    // 0 - 1
};

export const DEFAULT_CONFIG: TTSConfig = {
  voiceName: "",
  rate: 1,
  pitch: 1,
  volume: 1,
};

export function loadTTSConfig(): TTSConfig {
  try {
    const raw = localStorage.getItem("rs-tts-config");
    if (!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveTTSConfig(cfg: TTSConfig) {
  localStorage.setItem("rs-tts-config", JSON.stringify(cfg));
}

export function getPtVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  return window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("pt"));
}

export function waitForVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      resolve([]);
      return;
    }
    const ready = getPtVoices();
    if (ready.length) {
      resolve(ready);
      return;
    }
    const handler = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", handler);
      resolve(getPtVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", handler);
    setTimeout(() => resolve(getPtVoices()), 1500);
  });
}

export function speakTTS(text: string, cfg?: Partial<TTSConfig>): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      resolve();
      return;
    }
    const config = { ...loadTTSConfig(), ...(cfg || {}) };
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "pt-BR";
      u.rate = config.rate;
      u.pitch = config.pitch;
      u.volume = config.volume;
      const voices = getPtVoices();
      const picked = voices.find((v) => v.name === config.voiceName) || voices[0];
      if (picked) u.voice = picked;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    } catch {
      resolve();
    }
  });
}
