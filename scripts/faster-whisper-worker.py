import argparse
import json
import sys
import time
from pathlib import Path


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def normalize_language(value):
    if not value:
        return "zh"
    lowered = value.replace("_", "-").lower()
    if lowered.startswith("zh"):
        return "zh"
    return lowered.split("-", 1)[0]


def load_model(args):
    from faster_whisper import WhisperModel

    cache_dir = str(Path(args.cache_dir).resolve()) if args.cache_dir else None
    started_at = time.time()
    try:
        model = WhisperModel(
            args.model,
            device=args.device,
            compute_type=args.compute_type,
            download_root=cache_dir,
        )
        return model, args.device, args.compute_type, False, None, round((time.time() - started_at) * 1000)
    except Exception as first_error:
        if args.device == "cpu":
            raise
        model = WhisperModel(
            args.model,
            device="cpu",
            compute_type="int8",
            download_root=cache_dir,
        )
        return model, "cpu", "int8", True, str(first_error), round((time.time() - started_at) * 1000)


def transcribe(model, request, model_name, device, compute_type):
    started_at = time.time()
    audio = Path(request["audio"]).resolve()
    segments, info = model.transcribe(
        str(audio),
        language=normalize_language(request.get("language", "zh-CN")),
        beam_size=int(request.get("beamSize", 3)),
        vad_filter=True,
        condition_on_previous_text=False,
    )
    collected = []
    segment_payload = []
    for segment in segments:
        text = segment.text.strip()
        if not text:
            continue
        collected.append(text)
        segment_payload.append(
            {
                "start": segment.start,
                "end": segment.end,
                "text": text,
                "avgLogprob": segment.avg_logprob,
                "noSpeechProb": segment.no_speech_prob,
            }
        )
    return {
        "id": request.get("id"),
        "ok": True,
        "provider": "faster-whisper",
        "model": model_name,
        "device": device,
        "computeType": compute_type,
        "language": getattr(info, "language", normalize_language(request.get("language", "zh-CN"))),
        "languageProbability": getattr(info, "language_probability", None),
        "duration": getattr(info, "duration", None),
        "transcript": " ".join(collected).strip(),
        "segments": segment_payload,
        "processingMs": round((time.time() - started_at) * 1000),
    }


def main():
    parser = argparse.ArgumentParser(description="Persistent faster-whisper worker.")
    parser.add_argument("--model", default="large-v3-turbo")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--compute-type", default="default")
    parser.add_argument("--cache-dir", default=None)
    args = parser.parse_args()

    model, device, compute_type, fallback_used, fallback_reason, load_ms = load_model(args)
    emit(
        {
            "type": "ready",
            "ok": True,
            "provider": "faster-whisper",
            "model": args.model,
            "device": device,
            "computeType": compute_type,
            "fallbackUsed": fallback_used,
            "fallbackReason": fallback_reason,
            "loadMs": load_ms,
        }
    )

    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
            emit(transcribe(model, request, args.model, device, compute_type))
        except Exception as error:
            request_id = None
            try:
                request_id = json.loads(line).get("id")
            except Exception:
                pass
            emit({"id": request_id, "ok": False, "provider": "faster-whisper", "error": str(error)})


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit({"type": "ready", "ok": False, "provider": "faster-whisper", "error": str(error)})
        sys.exit(1)
