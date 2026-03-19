#!/usr/bin/env python3
import json
import os
import sys
from io import BytesIO


def trim_preview(value, limit=2000):
    return str(value or "").strip()[:limit]


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))


def call_openai_vision_probe(page_image, base_url, api_key, model):
    try:
        import base64

        import requests

        if page_image is None:
            return {"ok": False, "error": "page_image_missing"}

        img_io = BytesIO()
        page_image.convert("RGBA").save(img_io, "PNG")
        image_base64 = base64.b64encode(img_io.getvalue()).decode("utf-8")

        payload = {
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{image_base64}"},
                        },
                        {
                            "type": "text",
                            "text": "Convert these pdf pages to markdown.",
                        },
                    ],
                }
            ],
        }
        response = requests.post(
            f"{base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=float(os.getenv("DOCLING_REMOTE_TIMEOUT", "90")),
        )
        body_preview = trim_preview(response.text)

        content_preview = ""
        parse_error = None
        try:
            parsed = response.json()
            content = (((parsed.get("choices") or [{}])[0].get("message") or {}).get("content"))
            if isinstance(content, list):
                content_preview = trim_preview(json.dumps(content, ensure_ascii=False))
            else:
                content_preview = trim_preview(content)
        except Exception as error:
            parse_error = str(error)

        return {
            "ok": response.ok,
            "status_code": response.status_code,
            "body_preview": body_preview,
            "content_preview": content_preview,
            "parse_error": parse_error,
        }
    except Exception as error:
        return {"ok": False, "error": str(error)}


def build_converter():
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import VlmPipelineOptions
    from docling.datamodel.pipeline_options_vlm_model import ApiVlmOptions
    from docling.pipeline.vlm_pipeline import ResponseFormat, VlmPipeline

    api_key = os.getenv("DOCLING_API_KEY") or os.getenv("OPENAI_API_KEY")
    base_url = (os.getenv("DOCLING_BASE_URL") or os.getenv("OPENAI_BASE_URL") or "").rstrip("/")
    model = os.getenv("DOCLING_VLM_MODEL") or "deepseek-ocr"

    if api_key and base_url:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        api_options = ApiVlmOptions(
            prompt="Convert these pdf pages to markdown.",
            url=f"{base_url}/chat/completions",
            headers=headers,
            params={"model": model},
            timeout=float(os.getenv("DOCLING_REMOTE_TIMEOUT", "90")),
            response_format=ResponseFormat.DEEPSEEKOCR_MARKDOWN,
        )
        pipeline_options = VlmPipelineOptions(
            enable_remote_services=True,
            generate_page_images=True,
            vlm_options=api_options,
        )
        return DocumentConverter(
            format_options={
                InputFormat.PDF: PdfFormatOption(
                    pipeline_cls=VlmPipeline,
                    pipeline_options=pipeline_options,
                )
            }
        ), True, {
            "base_url": base_url,
            "model": model,
        }

    return DocumentConverter(), False, {}


def collect_page_debug(result):
    pages_debug = []
    page_texts = []
    for page in list(getattr(result, "pages", []) or [])[:2]:
        prediction = getattr(getattr(page, "predictions", None), "vlm_response", None)
        prediction_text = getattr(prediction, "text", "") if prediction else ""
        if prediction_text.strip():
            page_texts.append(prediction_text.strip())
        pages_debug.append(
            {
                "page_no": getattr(page, "page_no", None),
                "has_image": getattr(page, "image", None) is not None,
                "vlm_text_preview": trim_preview(prediction_text),
                "vlm_tokens": getattr(prediction, "num_tokens", None) if prediction else None,
                "vlm_stop_reason": str(getattr(prediction, "stop_reason", "")) if prediction else None,
            }
        )
    return pages_debug, page_texts


def main():
    if len(sys.argv) < 2:
        emit({"ok": False, "error": "pdf_path is required"})
        return 1

    pdf_path = sys.argv[1]
    if not os.path.exists(pdf_path):
        emit({"ok": False, "error": "pdf file not found"})
        return 1

    try:
        from docling.document_converter import DocumentConverter
    except Exception as error:
        emit({"ok": False, "error": f"docling import failed: {error}"})
        return 0

    try:
        converter, using_remote_ocr, converter_meta = build_converter()
        result = converter.convert(pdf_path)
        document = result.document
        markdown = ""
        if hasattr(document, "export_to_markdown"):
            markdown = document.export_to_markdown() or ""
        page_debug, page_texts = collect_page_debug(result)
        text = markdown.strip()
        format_fallback = None
        if not text and page_texts:
            # Some OpenAI-compatible OCR providers return plain markdown/text instead of
            # DeepSeek OCR's bbox-annotated format. Preserve that text so the API can still succeed.
            markdown = "\n\n".join(page_texts)
            text = markdown.strip()
            format_fallback = "page_vlm_text"
        remote_debug = None
        if using_remote_ocr and page_debug:
            api_key = os.getenv("DOCLING_API_KEY") or os.getenv("OPENAI_API_KEY")
            base_url = (os.getenv("DOCLING_BASE_URL") or os.getenv("OPENAI_BASE_URL") or "").rstrip("/")
            model = os.getenv("DOCLING_VLM_MODEL") or "deepseek-ocr"
            first_page_image = None
            first_page = list(getattr(result, "pages", []) or [])[:1]
            if first_page:
                page = first_page[0]
                first_page_image = getattr(getattr(page, "image", None), "pil_image", None)
                if first_page_image is None and hasattr(page, "get_image"):
                    try:
                        first_page_image = page.get_image(scale=1.0)
                    except Exception:
                        first_page_image = None
            remote_debug = call_openai_vision_probe(first_page_image, base_url, api_key, model)
        emit({
            "ok": bool(text),
            "parser": "docling",
            "used_ocr": using_remote_ocr,
            "markdown": markdown,
            "raw_text": text,
            "debug": {
                "remote_ocr": remote_debug,
                "converter_meta": converter_meta,
                "pages": page_debug,
                "format_fallback": format_fallback,
            },
        })
        return 0
    except Exception as error:
        emit({"ok": False, "error": f"docling convert failed: {error}"})
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
