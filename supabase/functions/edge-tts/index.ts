// Free neural TTS using Microsoft Edge's online speech service.
// No API key required. Returns base64 MP3 in JSON for easy data-URI playback.
//
// This taps the same backend Edge's "Read Aloud" uses — high-quality neural
// voices (Aria, Jenny, Guy, Christopher, Sonia, Ryan, etc.) at no cost.

import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Edge's TTS endpoint — this token is a public, hardcoded value used by every
// Edge browser install for the Read Aloud feature. Not a secret.
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const SEC_MS_GEC_VERSION = "1-130.0.2849.68";

// Microsoft now requires a Sec-MS-GEC token: SHA256 hex of
// `${windowsFileTimeTicks(rounded to 5 min)}${TRUSTED_CLIENT_TOKEN}`.
async function generateSecMsGec(): Promise<string> {
  const ticks = Math.floor(Date.now() / 1000) + 11644473600; // unix → Windows file time seconds
  const rounded = ticks - (ticks % 300); // round down to 5 min
  const windowsTicks = rounded * 10_000_000; // → 100ns ticks
  const data = new TextEncoder().encode(`${windowsTicks}${TRUSTED_CLIENT_TOKEN}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function buildWsUrl(connectionId: string, secMsGec: string): string {
  return (
    `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` +
    `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&Sec-MS-GEC=${secMsGec}` +
    `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}` +
    `&ConnectionId=${connectionId}`
  );
}

// Default voices per gender — top neural voices Edge ships.
const DEFAULT_FEMALE = "en-US-AriaNeural";
const DEFAULT_MALE = "en-US-GuyNeural";

// XML escaping for SSML body.
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Strip markdown / code / stage directions / emoji so the synth voices real prose.
function clean(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/:::ACTION[\s\S]*?:::/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\*[^*\n]+\*/g, "")
    .replace(/_[^_\n]+_/g, "")
    .replace(/\((?:laughs?|smiles?|sighs?|whispers?|chuckles?|grins?|pauses?)[^)]*\)/gi, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[#*_~>]/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu, "")
    .replace(/\bw\/\b/gi, "with")
    .replace(/\b&\b/g, "and")
    .replace(/\.{3,}/g, "…")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4500);
}

// Format a percent-style adjustment Edge expects (e.g. "+0%", "-10%", "+15%").
function pct(value: number): string {
  const v = Math.round(value);
  return `${v >= 0 ? "+" : ""}${v}%`;
}

// Build the SSML payload Edge's TTS service expects.
function buildSsml(opts: {
  text: string;
  voice: string;
  rate: number;     // -50..+50 (% offset)
  pitch: number;    // -50..+50 (Hz-ish; we use %)
  volume: number;   // -50..+50 (% offset)
}): string {
  const { text, voice, rate, pitch, volume } = opts;
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
    `<voice name='${voice}'>` +
    `<prosody pitch='${pct(pitch)}' rate='${pct(rate)}' volume='${pct(volume)}'>` +
    escapeXml(text) +
    `</prosody></voice></speak>`
  );
}

// Generate the request id Edge expects (32 hex chars).
function newRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Synthesize via WebSocket. Edge streams audio frames as binary messages
// prefixed with a small text header; we strip the header and concat.
async function synthesize(ssml: string): Promise<Uint8Array> {
  const requestId = newRequestId();
  const secMsGec = await generateSecMsGec();
  const ws = new WebSocket(buildWsUrl(requestId, secMsGec));
  ws.binaryType = "arraybuffer";

  const audioChunks: Uint8Array[] = [];

  return await new Promise<Uint8Array>((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { ws.close(); } catch (_) {}
      reject(new Error("Edge TTS timeout"));
    }, 30000);

    ws.onopen = () => {
      // 1) Speech config — request 24kHz mp3.
      const configMsg =
        `X-Timestamp:${new Date().toISOString()}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n` +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
                outputFormat: "audio-24khz-48kbitrate-mono-mp3",
              },
            },
          },
        });
      ws.send(configMsg);

      // 2) The SSML request.
      const ssmlMsg =
        `X-RequestId:${requestId}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${new Date().toISOString()}Z\r\n` +
        `Path:ssml\r\n\r\n` +
        ssml;
      ws.send(ssmlMsg);
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        // Text messages signal turn lifecycle. "Path:turn.end" => finished.
        if (event.data.includes("Path:turn.end")) {
          clearTimeout(timeout);
          ws.close();
          if (!audioChunks.length) {
            reject(new Error("No audio received from Edge TTS"));
            return;
          }
          const total = audioChunks.reduce((n, a) => n + a.length, 0);
          const merged = new Uint8Array(total);
          let off = 0;
          for (const c of audioChunks) {
            merged.set(c, off);
            off += c.length;
          }
          resolve(merged);
        }
      } else {
        // Binary frames: 2-byte header length prefix, then text header, then audio.
        const buf = new Uint8Array(event.data as ArrayBuffer);
        if (buf.length < 2) return;
        const headerLen = (buf[0] << 8) | buf[1];
        const audioStart = 2 + headerLen;
        if (audioStart >= buf.length) return;
        audioChunks.push(buf.slice(audioStart));
      }
    };

    ws.onerror = (e) => {
      clearTimeout(timeout);
      reject(new Error(`Edge TTS WebSocket error: ${(e as any)?.message ?? "unknown"}`));
    };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const text = clean(String(body.text ?? ""));
    if (!text) {
      return new Response(
        JSON.stringify({ error: "text required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const gender: "male" | "female" = body.gender === "male" ? "male" : "female";
    const voice =
      typeof body.voice === "string" && body.voice.length > 0
        ? body.voice
        : gender === "female"
        ? DEFAULT_FEMALE
        : DEFAULT_MALE;

    // Slight defaults for natural conversational pacing.
    const rate = typeof body.rate === "number" ? body.rate : -4;
    const pitch = typeof body.pitch === "number" ? body.pitch : 0;
    const volume = typeof body.volume === "number" ? body.volume : 0;

    const ssml = buildSsml({ text, voice, rate, pitch, volume });
    const audio = await synthesize(ssml);
    // base64Encode wants ArrayBuffer; pass the underlying buffer slice.
    const audioContent = base64Encode(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer);

    return new Response(
      JSON.stringify({ audioContent, mime: "audio/mpeg", voice }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("edge-tts error", e?.message ?? e);
    return new Response(
      JSON.stringify({ error: e?.message ?? "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
