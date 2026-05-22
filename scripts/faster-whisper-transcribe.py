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


def transcribe(audio, model_name, language, device, compute_type, cache_dir, beam_size):
    from faster_whisper import WhisperModel

    started_at = time.time()
    model = WhisperModel(
        model_name,
        device=device,
        compute_type=compute_type,
        download_root=cache_dir,
    )
    segments, info = model.transcribe(
        str(audio),
        language=normalize_language(language),
        beam_size=beam_size,
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
        "ok": True,
        "provider": "faster-whisper",
        "model": model_name,
        "device": device,
        "computeType": compute_type,
        "language": getattr(info, "language", normalize_language(language)),
        "languageProbability": getattr(info, "language_probability", None),
        "duration": getattr(info, "duration", None),
        "transcript": " ".join(collected).strip(),
        "segments": segment_payload,
        "processingMs": round((time.time() - started_at) * 1000),
    }


def main():
    parser = argparse.ArgumentParser(description="Transcribe audio with faster-whisper.")
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", default="large-v3-turbo")
    parser.add_argument("--language", default="zh-CN")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--compute-type", default="default")
    parser.add_argument("--cache-dir", default=None)
    parser.add_argument("--beam-size", type=int, default=3)
    args = parser.parse_args()

    audio = Path(args.audio).resolve()
    if not audio.exists():
        raise FileNotFoundError(f"Audio file does not exist: {audio}")

    cache_dir = str(Path(args.cache_dir).resolve()) if args.cache_dir else None
    try:
        emit(
            transcribe(
                audio,
                args.model,
                args.language,
                args.device,
                args.compute_type,
                cache_dir,
                args.beam_size,
            )
        )
        return
    except Exception as first_error:
        if args.device == "cpu":
            raise
        fallback_compute_type = "int8"
        try:
            payload = transcribe(
                audio,
                args.model,
                args.language,
                "cpu",
                fallback_compute_type,
                cache_dir,
                args.beam_size,
            )
            payload["fallbackUsed"] = True
            payload["fallbackReason"] = str(first_error)
            emit(payload)
            return
        except Exception as second_error:
            emit(
                {
                    "ok": False,
                    "provider": "faster-whisper",
                    "model": args.model,
                    "device": args.device,
                    "computeType": args.compute_type,
                    "error": str(second_error),
                    "firstError": str(first_error),
                }
            )
            sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit({"ok": False, "provider": "faster-whisper", "error": str(error)})
        sys.exit(1)
