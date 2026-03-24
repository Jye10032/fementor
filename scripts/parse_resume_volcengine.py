#!/usr/bin/env python3
import base64
import json
import os
import sys
import time


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))


def log_stage(stage, **fields):
    payload = {"stage": stage, **fields}
    sys.stderr.write(f"[resume.volcengine] {json.dumps(payload, ensure_ascii=False)}\n")
    sys.stderr.flush()


def normalize_text(value):
    return str(value or "").replace("\u0000", "").replace("\r", "\n").strip()


def load_file_as_base64(file_path):
    with open(file_path, "rb") as handle:
        return base64.b64encode(handle.read()).decode()


def extract_text_from_detail(detail):
    if isinstance(detail, str):
      try:
          detail = json.loads(detail)
      except Exception:
          return ""

    if not isinstance(detail, list):
        return ""

    page_chunks = []
    for page in detail:
        page_md = normalize_text(page.get("page_md")) if isinstance(page, dict) else ""
        if page_md:
            page_chunks.append(page_md)
            continue
        blocks = page.get("textblocks") if isinstance(page, dict) else []
        block_text = "\n".join(
            normalize_text(block.get("text"))
            for block in blocks
            if isinstance(block, dict) and normalize_text(block.get("text"))
        ).strip()
        if block_text:
            page_chunks.append(block_text)
    return "\n\n".join(page_chunks).strip()


def resolve_credentials():
    access_key = (
        os.getenv("VOLC_ACCESSKEY")
        or os.getenv("VOLCENGINE_ACCESS_KEY")
        or os.getenv("ACCESS_KEY")
        or ""
    ).strip()
    secret_key = (
        os.getenv("VOLC_SECRETKEY")
        or os.getenv("VOLCENGINE_SECRET_KEY")
        or os.getenv("SECRET_KEY")
        or ""
    ).strip()
    return access_key, secret_key


def main():
    if len(sys.argv) < 2:
        emit({"ok": False, "error": "file_path is required"})
        return 1

    file_path = sys.argv[1]
    if not os.path.exists(file_path):
        emit({"ok": False, "error": "file not found"})
        return 1

    try:
        from volcengine.visual.VisualService import VisualService
    except Exception as error:
        emit({"ok": False, "error": f"volcengine import failed: {error}"})
        return 0

    access_key, secret_key = resolve_credentials()
    overall_started_at = time.time()
    file_type = "image" if os.path.splitext(file_path)[1].lower() in {".png", ".jpg", ".jpeg", ".bmp"} else "pdf"
    page_num = int(os.getenv("VOLCENGINE_OCR_PAGE_NUM", "16"))
    parse_mode = os.getenv("VOLCENGINE_OCR_PARSE_MODE", "auto").strip() or "auto"
    table_mode = os.getenv("VOLCENGINE_OCR_TABLE_MODE", "markdown").strip() or "markdown"
    filter_header = os.getenv("VOLCENGINE_OCR_FILTER_HEADER", "true").strip() or "true"

    try:
        log_stage(
            "request.start",
            file_path=file_path,
            file_type=file_type,
            page_num=page_num,
            parse_mode=parse_mode,
            has_access_key=bool(access_key),
            has_secret_key=bool(secret_key),
        )
        encode_started_at = time.time()
        image_base64 = load_file_as_base64(file_path)
        log_stage(
            "file.encode.done",
            elapsed_ms=round((time.time() - encode_started_at) * 1000, 2),
            base64_length=len(image_base64),
        )

        form = {
            "image_base64": image_base64,
            "image_url": "",
            "version": "v3",
            "file_type": file_type,
            "page_start": 0,
            "page_num": page_num,
            "parse_mode": parse_mode,
            "table_mode": table_mode,
            "filter_header": filter_header,
        }

        service_started_at = time.time()
        visual_service = VisualService()
        if access_key and secret_key:
            visual_service.set_ak(access_key)
            visual_service.set_sk(secret_key)
        log_stage("ocr_pdf.start")
        response = visual_service.ocr_pdf(form)
        log_stage(
            "ocr_pdf.done",
            elapsed_ms=round((time.time() - service_started_at) * 1000, 2),
            code=response.get("code") if isinstance(response, dict) else None,
            message=response.get("message") if isinstance(response, dict) else None,
            request_id=response.get("request_id") if isinstance(response, dict) else None,
            time_elapsed=response.get("time_elapsed") if isinstance(response, dict) else None,
        )

        data = response.get("data") if isinstance(response, dict) else None
        markdown = normalize_text((data or {}).get("markdown"))
        detail = (data or {}).get("detail")
        raw_text = markdown or extract_text_from_detail(detail)

        emit({
            "ok": bool(raw_text),
            "parser": "volcengine",
            "used_ocr": True,
            "markdown": markdown,
            "raw_text": raw_text,
            "debug": {
                "code": response.get("code") if isinstance(response, dict) else None,
                "message": response.get("message") if isinstance(response, dict) else None,
                "request_id": response.get("request_id") if isinstance(response, dict) else None,
                "time_elapsed": response.get("time_elapsed") if isinstance(response, dict) else None,
                "detail_preview": detail[:2] if isinstance(detail, list) else detail,
            },
        })
        log_stage(
            "request.done",
            elapsed_ms=round((time.time() - overall_started_at) * 1000, 2),
            ok=bool(raw_text),
            text_length=len(raw_text),
        )
        return 0
    except Exception as error:
        log_stage("error", error=str(error), elapsed_ms=round((time.time() - overall_started_at) * 1000, 2))
        emit({"ok": False, "error": str(error)})
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
