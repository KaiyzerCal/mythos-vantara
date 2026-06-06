"""
MAVIS Self-Hosted Whisper Server
OpenAI Whisper API-compatible endpoint using faster-whisper.
Zero API cost, private, runs on any CPU VPS.

Usage: POST /v1/audio/transcriptions (same as OpenAI Whisper API)
"""
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from faster_whisper import WhisperModel
import tempfile, os

app = FastAPI(title="MAVIS Whisper Server")

MODEL_SIZE  = os.getenv("WHISPER_MODEL", "base")   # base | small | medium | large-v3
DEVICE      = os.getenv("WHISPER_DEVICE", "cpu")   # cpu | cuda (GPU)
COMPUTE     = os.getenv("WHISPER_COMPUTE", "int8")  # int8 (CPU) | float16 (GPU)

print(f"Loading Whisper model: {MODEL_SIZE} on {DEVICE} ({COMPUTE})")
whisper_model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE)
print("Whisper model ready.")


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_SIZE, "device": DEVICE}


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    model: str = Form("whisper-1"),        # ignored — we use the loaded model
    language: str = Form(None),
    response_format: str = Form("json"),
    temperature: float = Form(0.0),
):
    audio_bytes = await file.read()
    if len(audio_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty audio file")

    filename = file.filename or "audio.webm"
    suffix = "." + filename.rsplit(".", 1)[-1] if "." in filename else ".webm"

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        kwargs = {}
        if language and language not in ("auto", ""):
            kwargs["language"] = language

        segments, info = whisper_model.transcribe(
            tmp_path,
            beam_size=5,
            vad_filter=True,   # skip silent sections — faster, cleaner
            **kwargs,
        )
        text = " ".join(seg.text for seg in segments).strip()

        if response_format == "verbose_json":
            return {
                "task": "transcribe",
                "language": info.language,
                "duration": round(info.duration, 2),
                "text": text,
            }
        return {"text": text}
    finally:
        os.unlink(tmp_path)
