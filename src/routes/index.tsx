import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import logoAsset from "@/assets/rs-logo.png.asset.json";
import { enviarChamado } from "@/lib/chamados.functions";
import { speakTTS, loadTTSConfig, saveTTSConfig, waitForVoices, type TTSConfig } from "@/lib/tts-player";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RafaelSolutions — Assistente de Chamados" },
      { name: "description", content: "Assistente de voz futurista para registrar chamados." },
      { name: "theme-color", content: "#0a0014" },
    ],
  }),
  component: Index,
});

type Etapa = "idle" | "boot" | "aguardando-comando" | "perguntando-assunto" | "ouvindo-assunto" | "perguntando-descricao" | "ouvindo-descricao" | "enviando" | "sucesso" | "perguntando-novamente" | "ouvindo-resposta" | "despedida" | "erro";

let currentRec: any = null;

async function speak(texto: string): Promise<void> {
  try {
    await speakTTS(texto);
  } catch {
    // fallback silencioso
  }
}

function ouvir(): Promise<string> {
  return new Promise((resolve, reject) => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      reject(new Error("Reconhecimento de voz não suportado neste navegador. Use Chrome no Android ou desktop."));
      return;
    }
    const rec = new SR();
    currentRec = rec;
    (window as any).__RS_CURRENT_RECO__ = rec;
    rec.lang = "pt-BR";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    let resolved = false;
    rec.onresult = (e: any) => {
      resolved = true;
      resolve(e.results[0][0].transcript);
    };
    rec.onerror = (e: any) => {
      if (!resolved) reject(new Error(e.error || "Erro no microfone"));
    };
    rec.onend = () => {
      currentRec = null;
      (window as any).__RS_CURRENT_RECO__ = null;
      if (!resolved) reject(new Error("Não entendi. Tente novamente."));
    };
    try { rec.start(); } catch (err) { reject(err); }
  });
}

function Index() {
  const [etapa, setEtapa] = useState<Etapa>("idle");
  const [assunto, setAssunto] = useState("");
  const [descricao, setDescricao] = useState("");
  const [status, setStatus] = useState("Sistema em standby");
  const [webhook, setWebhook] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const [showVoz, setShowVoz] = useState(false);
  const [vozes, setVozes] = useState<SpeechSynthesisVoice[]>([]);
  const [ttsCfg, setTtsCfg] = useState<TTSConfig>(() => loadTTSConfig());
  const [erro, setErro] = useState("");
  const ativoRef = useRef(false);

  useEffect(() => {
    const w = localStorage.getItem("rs-webhook") || "";
    setWebhook(w);
    if (!w) setShowConfig(true);
  }, []);

  useEffect(() => {
    waitForVoices().then((vs) => {
      setVozes(vs);
      setTtsCfg((prev) => {
        if (prev.voiceName && vs.some((v) => v.name === prev.voiceName)) return prev;
        // tenta achar Maria, depois feminina, depois primeira pt
        const maria = vs.find((v) => /maria/i.test(v.name));
        const luciana = vs.find((v) => /luciana|francisca|joana/i.test(v.name));
        const escolhida = maria || luciana || vs[0];
        if (!escolhida) return prev;
        const novo = { ...prev, voiceName: escolhida.name };
        saveTTSConfig(novo);
        return novo;
      });
    });
  }, []);

  const atualizarTts = (patch: Partial<TTSConfig>) => {
    setTtsCfg((prev) => {
      const novo = { ...prev, ...patch };
      saveTTSConfig(novo);
      return novo;
    });
  };


  const salvarWebhook = (v: string) => {
    setWebhook(v);
    localStorage.setItem("rs-webhook", v);
  };

  const enviar = async (a: string, d: string): Promise<boolean> => {
    // Não envia se algum campo estiver vazio
    if (!a || !a.trim() || !d || !d.trim()) {
      setErro("Assunto ou descrição vazios — nenhum registro será enviado.");
      setEtapa("erro");
      setStatus("Dados incompletos");
      await speak("Dados incompletos. Cancelando envio.");
      setTimeout(() => setEtapa("idle"), 2000);
      return false;
    }

    setEtapa("enviando");
    setStatus("Transmitindo dados para o servidor...");
    try {
      if (!webhook) throw new Error("Webhook não configurado");
      await enviarChamado({
        data: {
          webhook,
          assunto: a,
          descricao: d,
        },
      });
      setEtapa("sucesso");
      setStatus("Chamado registrado com sucesso");
      await speak("Prontinho, Muscilon. Seu chamado foi registrado com sucesso.");
      return true;
    } catch (e: any) {
      setErro(e.message);
      setEtapa("erro");
      setStatus("Falha na transmissão");
      await speak("Ai, Muscilon, não consegui registrar o chamado.");
      setTimeout(() => setEtapa("idle"), 3000);
      return false;
    }
  };

  const iniciarFluxo = useCallback(async () => {
    if (ativoRef.current) return;
    if (!webhook) {
      setShowConfig(true);
      return;
    }
    ativoRef.current = true;
    setErro("");
    try {
      setEtapa("boot");
      setStatus("Inicializando RafaelSolutions Assistant...");
      await new Promise((r) => setTimeout(r, 800));

      setEtapa("perguntando-assunto");
      setStatus("Qual o assunto do chamado?");
      await speak("Qual o assunto do chamado?");

      setEtapa("ouvindo-assunto");
      setStatus("Ouvindo...");
      const a = await ouvir();
      setAssunto(a);

      setEtapa("perguntando-descricao");
      setStatus("Agora, descreva o chamado.");
      await speak("Agora, descreva o chamado.");

      setEtapa("ouvindo-descricao");
      setStatus("Ouvindo...");
      const d = await ouvir();
      setDescricao(d);

      const ok = await enviar(a, d);
      if (!ok) return;

      // Loop: pergunta se quer adicionar outro chamado
      // eslint-disable-next-line no-constant-condition
      while (true) {
        setEtapa("perguntando-novamente");
        setStatus("Deseja adicionar outro chamado?");
        await speak("Deseja adicionar mais um chamado em mim?");

        setEtapa("ouvindo-resposta");
        setStatus("Ouvindo... (sim ou não)");
        let resposta = "";
        try {
          resposta = (await ouvir()).toLowerCase().trim();
        } catch {
          resposta = "";
        }

        const disseSim = /\b(sim|claro|quero|positivo|pode|isso|aham|uhum|com certeza)\b/.test(resposta);
        const disseNao = /\b(n[aã]o|nao|negativo|encerrar|chega|finalizar|sair)\b/.test(resposta);

        if (disseSim) {
          setAssunto("");
          setDescricao("");
          setEtapa("perguntando-assunto");
          setStatus("Qual o assunto do chamado?");
          await speak("Que delícia. Qual o assunto do chamado?");

          setEtapa("ouvindo-assunto");
          setStatus("Ouvindo...");
          const a2 = await ouvir();
          setAssunto(a2);

          setEtapa("perguntando-descricao");
          setStatus("Agora, descreva o chamado.");
          await speak("Agora me descreve o chamado.");

          setEtapa("ouvindo-descricao");
          setStatus("Ouvindo...");
          const d2 = await ouvir();
          setDescricao(d2);

          const ok2 = await enviar(a2, d2);
          if (!ok2) return;
          continue;
        }

        if (disseNao) {
          setEtapa("despedida");
          setStatus("Valeu, Muscilon!");
          await speak("Valeu, Muscilon!");
          break;
        }

        // não entendi — pergunta de novo
        await speak("Desculpa, não entendi. Pode responder com sim ou não?");
      }

      setTimeout(() => {
        setEtapa("idle");
        setStatus("Sistema em standby");
        setAssunto("");
        setDescricao("");
      }, 2500);
    } catch (e: any) {
      setErro(e.message);
      setEtapa("erro");
      setStatus(e.message);
      setTimeout(() => setEtapa("idle"), 3000);
    } finally {
      ativoRef.current = false;
    }
  }, [webhook]);

  const ativo = etapa !== "idle" && etapa !== "erro";
  const interagindo =
    etapa === "perguntando-assunto" ||
    etapa === "ouvindo-assunto" ||
    etapa === "perguntando-descricao" ||
    etapa === "ouvindo-descricao" ||
    etapa === "perguntando-novamente" ||
    etapa === "ouvindo-resposta" ||
    etapa === "despedida";

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#05000f] text-cyan-100 font-mono">
      {/* fundo em grid + glow */}
      <div className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "linear-gradient(rgba(168,85,247,0.15) 1px,transparent 1px),linear-gradient(90deg,rgba(168,85,247,0.15) 1px,transparent 1px)",
          backgroundSize: "40px 40px",
          maskImage: "radial-gradient(ellipse at center,black 40%,transparent 80%)",
        }}
      />
      <div className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, rgba(139,92,246,0.25), transparent 60%), radial-gradient(circle at 20% 80%, rgba(34,211,238,0.15), transparent 50%)",
        }}
      />
      {/* scanline */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage: "repeating-linear-gradient(0deg, #fff 0 1px, transparent 1px 3px)",
        }}
      />

      {/* HUD topo */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-purple-500/20">
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_10px_#22d3ee]" />
          <span className="text-xs tracking-[0.3em] text-cyan-300/80">RafaelSolutions · ASSISTANT v1.0</span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={PLANILHA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs tracking-widest text-green-300/70 border border-green-500/30 px-3 py-1 rounded hover:text-green-200"
          >
            📊
          </a>
          <button
            onClick={() => {
              if (ativoRef.current) {
                ativoRef.current = false;
                if (currentRec && typeof currentRec.stop === "function") {
                  try { currentRec.stop(); } catch (_){ }
                }
                setEtapa("idle");
                setStatus("Interrompido");
              }
            }}
            className="text-xs tracking-widest text-red-300/70 hover:text-red-200 border border-red-500/30 px-3 py-1 rounded"
          >
            ⏹ PARAR
          </button>
          <button
            onClick={() => setShowVoz(true)}
            className="text-xs tracking-widest text-cyan-300/70 hover:text-cyan-200 border border-cyan-500/30 px-3 py-1 rounded"
          >
            🎙 VOZ
          </button>
          <button
            onClick={() => setShowConfig(true)}
            className="text-xs tracking-widest text-purple-300/70 hover:text-purple-200 border border-purple-500/30 px-3 py-1 rounded"
          >
            ⚙ CONFIG
          </button>
        </div>
      </header>

      {/* núcleo central */}
      <main className="relative z-10 flex flex-col items-center justify-center px-6 py-10 gap-8">
        <div className="relative flex items-center justify-center" style={{ width: 320, height: 320 }}>
          {/* anéis rotativos */}
          <div className={`absolute inset-0 rounded-full border ${interagindo ? "border-green-400 animate-[heartbeat_1.1s_ease-in-out_infinite]" : "border-purple-400/40"} ${ativo ? "animate-[spin_8s_linear_infinite]" : "animate-[spin_30s_linear_infinite]"}`}
            style={{ borderStyle: "dashed" }} />
          <div className={`absolute inset-4 rounded-full border-2 ${interagindo ? "border-green-400/80 animate-[heartbeat_1.1s_ease-in-out_infinite_0.1s]" : "border-cyan-400/30"} ${ativo ? "animate-[spin_4s_linear_infinite_reverse]" : "animate-[spin_20s_linear_infinite_reverse]"}`} />
          <div className={`absolute inset-8 rounded-full border ${interagindo ? "border-green-400/60 animate-[heartbeat_1.1s_ease-in-out_infinite_0.2s]" : "border-purple-500/20"}`} />
          <div className={`absolute inset-12 rounded-full ${interagindo ? "bg-gradient-to-br from-green-500/10 to-emerald-400/10" : "bg-gradient-to-br from-purple-600/20 via-fuchsia-500/10 to-cyan-500/20"} blur-xl ${ativo ? "animate-pulse" : ""}`} />

          {/* marcadores */}
          {[0, 90, 180, 270].map((deg) => (
            <div key={deg} className="absolute inset-0" style={{ transform: `rotate(${deg}deg)` }}>
              <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-1 h-3 ${interagindo ? "bg-green-400 shadow-[0_0_12px_#22c55e]" : "bg-cyan-400 shadow-[0_0_8px_#22d3ee]"}`} />
            </div>
          ))}

          {/* logo central */}
          <button
            onClick={iniciarFluxo}
            disabled={ativo}
            className="relative z-10 group focus:outline-none"
            aria-label="Adicionar chamado"
          >
            <div className="absolute inset-0 rounded-full bg-purple-500/30 blur-3xl group-hover:bg-purple-400/50 transition" />
            <div className={`relative h-44 w-44 rounded-full bg-black/60 backdrop-blur border-2 border-purple-400/60 flex items-center justify-center overflow-hidden ${ativo ? "shadow-[0_0_60px_rgba(168,85,247,0.8)]" : "shadow-[0_0_30px_rgba(168,85,247,0.4)] group-hover:shadow-[0_0_50px_rgba(168,85,247,0.7)]"}`}>
              <img src={logoAsset.url} alt="R.S Solutions" className="h-32 w-32 object-contain drop-shadow-[0_0_10px_rgba(168,85,247,0.8)]" />
              {/* varredura */}
              {ativo && (
                <div className="absolute inset-0 overflow-hidden">
                  <div className="absolute -inset-x-4 h-1 bg-gradient-to-r from-transparent via-cyan-300 to-transparent animate-[scan_2s_linear_infinite] shadow-[0_0_15px_#22d3ee]" />
                </div>
              )}
            </div>
          </button>
        </div>

        {/* status */}
        <div className="text-center space-y-2 max-w-xl">
          <div className="text-[10px] tracking-[0.4em] text-cyan-400/60">// STATUS</div>
          <div className="text-lg md:text-xl text-cyan-100 min-h-[2rem]">
            {status}
            {ativo && <span className="inline-block ml-1 animate-pulse">▊</span>}
          </div>
          {erro && <div className="text-sm text-red-400">{erro}</div>}
        </div>

        {/* transcrições */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-2xl">
          <Painel label="ASSUNTO" valor={assunto} ativo={etapa === "ouvindo-assunto"} />
          <Painel label="DESCRIÇÃO" valor={descricao} ativo={etapa === "ouvindo-descricao"} />
        </div>

        {/* botão principal */}
        <button
          onClick={iniciarFluxo}
          disabled={ativo}
          className="relative px-8 py-3 text-sm tracking-[0.3em] font-bold text-white border-2 border-purple-400/60 bg-gradient-to-r from-purple-700/40 to-fuchsia-600/40 hover:from-purple-600/60 hover:to-fuchsia-500/60 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[0_0_25px_rgba(168,85,247,0.5)] hover:shadow-[0_0_40px_rgba(168,85,247,0.8)]"
          style={{ clipPath: "polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%)" }}
        >
          {ativo ? "PROCESSANDO..." : "▶ ADICIONAR CHAMADO"}
        </button>

        <div className="text-[10px] tracking-widest text-purple-300/40 text-center max-w-md">
          Toque no botão e fale naturalmente. O sistema irá perguntar o assunto e a descrição, e registrar diretamente na sua planilha.
        </div>
      </main>

      {/* rodapé HUD */}
      <footer className="relative z-10 px-6 py-3 border-t border-purple-500/20 flex justify-between text-[10px] tracking-widest text-cyan-400/50">
        <span>● ONLINE</span>
        <span>RAFAELSOLUTIONS // {new Date().toLocaleDateString("pt-BR")}</span>
        <span>SECURE</span>
      </footer>

      {showConfig && (
        <ConfigModal
          webhook={webhook}
          onSave={(v) => {
            salvarWebhook(v);
            setShowConfig(false);
          }}
          onClose={() => setShowConfig(false)}
        />
      )}

      {showVoz && (
        <VozModal
          vozes={vozes}
          cfg={ttsCfg}
          onChange={atualizarTts}
          onClose={() => setShowVoz(false)}
        />
      )}

      <style>{`
        @keyframes scan { 0% { top: 0 } 100% { top: 100% } }
        @keyframes heartbeat {
          0%, 100% { box-shadow: 0 0 0 rgba(34,197,94,0); border-color: rgba(74,222,128,0.5); }
          15% { box-shadow: 0 0 25px rgba(34,197,94,0.9), inset 0 0 15px rgba(34,197,94,0.4); border-color: rgba(74,222,128,1); }
          30% { box-shadow: 0 0 8px rgba(34,197,94,0.3); border-color: rgba(74,222,128,0.6); }
          45% { box-shadow: 0 0 35px rgba(34,197,94,1), inset 0 0 20px rgba(34,197,94,0.5); border-color: rgba(74,222,128,1); }
          60% { box-shadow: 0 0 5px rgba(34,197,94,0.2); border-color: rgba(74,222,128,0.5); }
        }
      `}</style>
    </div>
  );
}

function Painel({ label, valor, ativo }: { label: string; valor: string; ativo: boolean }) {
  return (
    <div className={`relative border ${ativo ? "border-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.4)]" : "border-purple-500/30"} bg-black/40 backdrop-blur p-4 transition-all`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`h-1.5 w-1.5 rounded-full ${ativo ? "bg-cyan-400 animate-pulse" : "bg-purple-500/50"}`} />
        <span className="text-[10px] tracking-[0.3em] text-cyan-300/70">{label}</span>
      </div>
      <div className="text-sm text-cyan-50 min-h-[1.5rem]">
        {valor || <span className="text-purple-400/30">— aguardando —</span>}
      </div>
    </div>
  );
}


const PLANILHA_URL = "https://docs.google.com/spreadsheets/d/1Xkqd-7IQ4M_7fJSjgc5WJSXhn7eMN1QQM9vhZKnhJ9s/edit";

function ConfigModal({ webhook, onSave, onClose }: { webhook: string; onSave: (v: string) => void; onClose: () => void }) {
  const [v, setV] = useState(webhook);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur p-4">
      <div className="relative max-w-2xl w-full bg-[#0a0420] border-2 border-purple-500/50 p-6 shadow-[0_0_60px_rgba(168,85,247,0.4)]">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg tracking-[0.3em] text-cyan-300">⚙ CONFIGURAÇÃO</h2>
          <button onClick={onClose} className="text-purple-300 hover:text-white">✕</button>
        </div>
        <div className="space-y-4 text-sm">
          <div>
            <a
              href={PLANILHA_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-xs tracking-widest text-green-300 hover:text-green-200 border border-green-500/30 px-3 py-2 bg-green-900/10 hover:bg-green-900/20 transition"
            >
              📊 ABRIR PLANILHA "Anotações do Assistente"
            </a>
          </div>
          <div>
            <label className="block text-xs tracking-widest text-cyan-300/70 mb-2">WEBHOOK URL (Google Apps Script)</label>
            <input
              type="url"
              value={v}
              onChange={(e) => setV(e.target.value)}
              placeholder="https://script.google.com/macros/s/..../exec"
              className="w-full bg-black/60 border border-purple-500/40 px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400"
            />
          </div>
          <details className="text-xs text-purple-200/80 border border-purple-500/20 p-3">
            <summary className="cursor-pointer text-cyan-300 tracking-widest">📋 COMO CRIAR O WEBHOOK (5 min)</summary>
            <ol className="mt-3 space-y-2 list-decimal list-inside leading-relaxed">
              <li>Abra sua planilha no Google Sheets.</li>
              <li>Menu <b>Extensões → Apps Script</b>.</li>
              <li>Apague o código existente e cole:</li>
            </ol>
            <pre className="mt-2 bg-black/60 p-3 text-[11px] text-cyan-200 overflow-x-auto border border-purple-500/30">{`const NOME_DA_ABA = "Anotações do Assistente";

function salvarChamado(dados) {
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = planilha.getSheetByName(NOME_DA_ABA) || planilha.getActiveSheet();
  sheet.appendRow([
    new Date(),
    dados.assunto || "Sem Assunto",
    dados.descricao || "Sem Descrição"
  ]);
  return ContentService.createTextOutput(JSON.stringify({ ok: true, aba: sheet.getName(), linha: sheet.getLastRow() }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const texto = e.postData && e.postData.contents ? e.postData.contents : "{}";
  const dados = texto.trim().startsWith("{") ? JSON.parse(texto) : Object.fromEntries(texto.split("&").map(p => p.split("=").map(decodeURIComponent)));
  return salvarChamado(dados);
}

function doGet(e) {
  return salvarChamado(e.parameter || {});
}`}</pre>
            <ol start={4} className="mt-3 space-y-2 list-decimal list-inside leading-relaxed">
              <li>Clique em <b>Implantar → Nova implantação</b>.</li>
              <li>Tipo: <b>App da Web</b>. Executar como: <b>Eu</b>. Acesso: <b>Qualquer pessoa</b>.</li>
              <li>Copie a URL gerada e cole acima.</li>
            </ol>
          </details>
          <div className="flex gap-2 justify-end pt-2">
            <button onClick={onClose} className="px-4 py-2 text-xs tracking-widest border border-purple-500/40 text-purple-200 hover:bg-purple-500/10">CANCELAR</button>
            <button onClick={() => onSave(v)} className="px-4 py-2 text-xs tracking-widest bg-purple-600 hover:bg-purple-500 text-white shadow-[0_0_20px_rgba(168,85,247,0.5)]">SALVAR</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function VozModal({
  vozes,
  cfg,
  onChange,
  onClose,
}: {
  vozes: SpeechSynthesisVoice[];
  cfg: TTSConfig;
  onChange: (patch: Partial<TTSConfig>) => void;
  onClose: () => void;
}) {
  const testar = () => {
    speakTTS("Olá, Muscilon! Esta é a voz da Maria. Pode ajustar como quiser.", cfg);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur p-4">
      <div className="relative max-w-lg w-full bg-[#0a0420] border-2 border-cyan-500/50 p-6 shadow-[0_0_60px_rgba(34,211,238,0.4)]">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg tracking-[0.3em] text-cyan-300">🎙 EQUALIZADOR DE VOZ</h2>
          <button onClick={onClose} className="text-cyan-300 hover:text-white">✕</button>
        </div>
        <div className="space-y-5 text-sm">
          <div>
            <label className="block text-xs tracking-widest text-cyan-300/70 mb-2">VOZ ({vozes.length} disponíveis em PT)</label>
            <select
              value={cfg.voiceName}
              onChange={(e) => onChange({ voiceName: e.target.value })}
              className="w-full bg-black/60 border border-cyan-500/40 px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400"
            >
              {vozes.length === 0 && <option value="">Carregando vozes…</option>}
              {vozes.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
            <p className="text-[10px] text-purple-300/60 mt-1">
              Dica: Maria (Microsoft) costuma ser feminina. Daniel/Ricardo são masculinas.
            </p>
          </div>

          <Slider label="VELOCIDADE" min={0.5} max={1.6} step={0.05} value={cfg.rate} onChange={(v) => onChange({ rate: v })} />
          <Slider label="TOM (PITCH)" min={0} max={2} step={0.1} value={cfg.pitch} onChange={(v) => onChange({ pitch: v })} />
          <Slider label="VOLUME" min={0} max={1} step={0.05} value={cfg.volume} onChange={(v) => onChange({ volume: v })} />

          <div className="flex gap-2 justify-end pt-2">
            <button onClick={testar} className="px-4 py-2 text-xs tracking-widest border border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/10">▶ TESTAR</button>
            <button onClick={onClose} className="px-4 py-2 text-xs tracking-widest bg-cyan-600 hover:bg-cyan-500 text-white shadow-[0_0_20px_rgba(34,211,238,0.5)]">FECHAR</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between text-xs tracking-widest text-cyan-300/70 mb-1">
        <span>{label}</span>
        <span className="text-cyan-200">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-cyan-400"
      />
    </div>
  );
}
