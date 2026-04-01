# 简历解析架构

- 版本：v1.1
- 日期：2026-03-23
- 状态：已切换到火山引擎文档解析链路

## 1. 模块职责

简历解析模块负责把用户上传的简历文件转成可读文本，生成 `resume_summary`，并把原始解析结果落盘到用户资料目录。

当前入口：

- `POST /v1/resume/parse`

当前落盘目录：

- `data/user_docs/<user_id>/profile/`

## 2. 当前支持格式

1. `txt/md/json/html/csv`
   - 直接读取文本。
2. `docx`
   - 使用 `mammoth` 提取正文。
3. `pdf`
   - 优先走 `Volcengine OCRPdf`。
   - 远程解析不可用时，回退到 `pdf-parse + mdls`。

## 3. PDF 当前链路

### 3.1 主链路

`PDF 上传 -> Node API -> Volcengine Python bridge -> OCRPdf -> 文本落盘 -> LLM 摘要`

### 3.2 责任拆分

#### `Volcengine OCRPdf`

1. 接收 PDF 或图片输入。
2. 按页做版面分析和 OCR。
3. 返回整本 `markdown` 和页级 `detail`。
4. Python 桥接脚本提取 `markdown / raw_text` 返回给 Node。

#### 本地 fallback

1. `pdf-parse`
   - 处理普通文本型 PDF。
2. `mdls`
   - macOS 下的额外文本提取兜底。

## 4. 当前真实行为

当前主链路已经切换为火山引擎 `OCRPdf`。

### 4.1 已确认的运行状态

真实调用返回中可看到：

- `parser = volcengine`
- `used_ocr = true`
- `fallback_used = false`

这说明远程文档解析成功，没有退回本地旧链路。

### 4.2 当前采用的输出方式

当前服务返回：

1. `data.markdown`
2. `data.detail`

后端优先使用 `markdown`，必要时再从 `detail` 中回收文本块。

## 5. 返回字段说明

`/v1/resume/parse` 当前会返回：

```json
{
  "user_id": "u_web_001",
  "resume_summary": "...",
  "saved_path": ".../resume-xxx.md",
  "parse_meta": {
    "parser": "volcengine|legacy",
    "used_ocr": true,
    "fallback_used": false,
    "quality": "good",
    "original_filename": "xxx.pdf",
    "remote_ocr_preview": "...",
    "volcengine_request_id": "...",
    "volcengine_time_elapsed": "5.13s"
  }
}
```

### 字段解释

- `parser`
  - 当前解析器来源。
- `used_ocr`
  - 是否调用远程文档解析。
- `fallback_used`
  - 是否退回本地 PDF 解析链路。
- `remote_ocr_preview`
  - 展示远程文档解析返回的 markdown 预览。
- `volcengine_request_id`
  - 火山引擎请求 ID，用于排查。
- `volcengine_time_elapsed`
  - 火山引擎返回的服务端耗时字段。

## 6. 环境变量

```env
RESUME_PDF_PARSER=volcengine
VOLC_ACCESSKEY=
VOLC_SECRETKEY=
VOLCENGINE_PYTHON_BIN=apps/api/.venv-sirchmunk/bin/python
VOLCENGINE_SCRIPT_PATH=scripts/parse_resume_volcengine.py
VOLCENGINE_TIMEOUT_MS=120000
VOLCENGINE_OCR_PAGE_NUM=16
VOLCENGINE_OCR_PARSE_MODE=auto
VOLCENGINE_OCR_TABLE_MODE=markdown
VOLCENGINE_OCR_FILTER_HEADER=true
```

## 7. 已知边界

1. 远程文档解析耗时仍高于本地 `pdf-parse`，但明显快于旧的第三方 OCR 链路。
2. `remote_ocr_preview` 仅用于诊断，不等于最终落盘文本。
3. Base64 上传存在 8MB 上限，超大文件需要拆页或走 URL。

## 8. 验收口径

当前简历解析模块的“成功”定义是：

1. 返回 `parser = volcengine`。
2. 返回 `used_ocr = true`。
3. 没有退回 `legacy`。
4. 落盘 markdown 内容可读，摘要质量可接受。
