import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const chamadoSchema = z.object({
  webhook: z.string().url(),
  assunto: z.string().optional().default(""),
  descricao: z.string().optional().default(""),
});

export const enviarChamado = createServerFn({ method: "POST" })
  .inputValidator((data) => chamadoSchema.parse(data))
  .handler(async ({ data }) => {
    const webhookUrl = new URL(data.webhook);
    const isGoogleScript =
      webhookUrl.hostname === "script.google.com" &&
      webhookUrl.pathname.startsWith("/macros/s/") &&
      webhookUrl.pathname.endsWith("/exec");

    if (!isGoogleScript) {
      throw new Error("Use a URL /exec do Google Apps Script.");
    }

    const assunto = (data.assunto ?? "").trim() || "Sem Assunto";
    const descricao = (data.descricao ?? "").trim() || "Sem Descrição";
    const payload = { assunto, descricao };

    const isSuccessResponse = (text: string) => {
      const clean = text.trim();
      try {
        const parsed = JSON.parse(clean);
        return parsed?.ok === true && Boolean(parsed?.linha || parsed?.row || parsed?.line);
      } catch {
        return false;
      }
    };

    const getUrl = new URL(webhookUrl.toString());
    getUrl.searchParams.set("assunto", assunto);
    getUrl.searchParams.set("descricao", descricao);

    const tryRequest = async (url: string, init: RequestInit) => {
      const r = await fetch(url, init);
      const t = await r.text();
      return { status: r.status, ok: r.ok, text: t };
    };

    let res = await tryRequest(webhookUrl.toString(), {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "application/json;charset=UTF-8", Accept: "application/json, text/plain, */*" },
      body: JSON.stringify(payload),
    });

    // Fallback: alguns scripts antigos aceitam GET com query params.
    if (!res.ok || /sign in|accounts\.google\.com|authorization/i.test(res.text) || !isSuccessResponse(res.text)) {
      res = await tryRequest(getUrl.toString(), {
        method: "GET",
        redirect: "follow",
        headers: { Accept: "application/json, text/plain, */*" },
      });
    }

    // Último fallback: POST form-urlencoded.
    if (!res.ok || /sign in|accounts\.google\.com|authorization/i.test(res.text) || !isSuccessResponse(res.text)) {
      const formBody = new URLSearchParams(payload).toString();
      res = await tryRequest(webhookUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", Accept: "application/json, text/plain, */*" },
        body: formBody,
        redirect: "follow",
      });
    }

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          "Acesso negado (401/403). No Apps Script: Implantar → Gerenciar implantações → editar → 'Quem tem acesso: Qualquer pessoa', salvar e copiar a NOVA URL /exec.",
        );
      }
      throw new Error(`Apps Script respondeu ${res.status}: ${res.text.slice(0, 200)}`);
    }

    if (/sign in|authorization|accounts\.google\.com|<html/i.test(res.text)) {
      throw new Error(
        "O Apps Script está pedindo login. Reimplante com 'Quem tem acesso: Qualquer pessoa' e cole a NOVA URL /exec aqui.",
      );
    }

    if (/^ERRO/i.test(res.text.trim())) {
      throw new Error(res.text.slice(0, 200));
    }

    if (!isSuccessResponse(res.text)) {
      throw new Error(
        "O Apps Script respondeu, mas não confirmou que salvou na planilha. Atualize o código do Apps Script pelo modelo da configuração e gere uma nova versão.",
      );
    }

    return { ok: true, resposta: res.text.slice(0, 200) };
  });