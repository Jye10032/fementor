const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const mammoth = require('mammoth');
const { PDFParse } = require('pdf-parse');

const ROOT_DIR = path.resolve(__dirname, '../../../..');
const RESUME_PDF_PARSER = String(process.env.RESUME_PDF_PARSER || 'legacy').trim().toLowerCase();
const DEFAULT_PYTHON_BIN = path.join(ROOT_DIR, 'apps/api/.venv-sirchmunk/bin/python');
const DEFAULT_RUNTIME_PYTHON_BIN = process.env.RESUME_PARSE_PYTHON_BIN
  || (fs.existsSync(DEFAULT_PYTHON_BIN) ? DEFAULT_PYTHON_BIN : 'python3');
const VOLCENGINE_PYTHON_BIN = process.env.VOLCENGINE_PYTHON_BIN
  || DEFAULT_RUNTIME_PYTHON_BIN;
const VOLCENGINE_SCRIPT_PATH = process.env.VOLCENGINE_SCRIPT_PATH
  ? path.resolve(ROOT_DIR, process.env.VOLCENGINE_SCRIPT_PATH)
  : path.join(ROOT_DIR, 'scripts/parse_resume_volcengine.py');
const VOLCENGINE_TIMEOUT_MS = Number(process.env.VOLCENGINE_TIMEOUT_MS || 120000);
const formatElapsedMs = (startedAt) => `${Date.now() - startedAt}ms`;

const normalizeExtractedText = (input) => String(input || '')
  .replace(/\u0000/g, '')
  .replace(/\r/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const hasUsablePdfText = (input) => normalizeExtractedText(input).length >= 80;

const hasCommand = (name) => {
  if (String(name || '').includes(path.sep)) {
    try {
      fs.accessSync(name, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  const result = spawnSync('which', [name], { encoding: 'utf8' });
  return result.status === 0 && String(result.stdout || '').trim().length > 0;
};

const createTempFileFromBuffer = ({ ext, fileBuffer }) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fementor-resume-'));
  const tempFile = path.join(tempDir, `resume${ext || ''}`);
  fs.writeFileSync(tempFile, fileBuffer);
  return {
    filePath: tempFile,
    cleanup: () => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    },
  };
};

const extractPdfTextWithPdfParse = async ({ fileBuffer }) => {
  const parser = new PDFParse({ data: fileBuffer });
  try {
    const result = await parser.getText();
    return normalizeExtractedText(result?.text || '');
  } finally {
    try {
      await parser.destroy();
    } catch {}
  }
};

const parseJsonOutput = (raw) => {
  try {
    const parsed = JSON.parse(String(raw || '').trim());
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const runVolcengineResumeParser = ({ filename, fileBuffer }) => {
  const startedAt = Date.now();
  if (RESUME_PDF_PARSER !== 'volcengine') {
    console.log('[resume.parse.pdf.volcengine.skip]', {
      filename,
      reason: 'volcengine_disabled',
      elapsed_ms: 0,
    });
    return { ok: false, reason: 'volcengine_disabled' };
  }
  if (!fs.existsSync(VOLCENGINE_SCRIPT_PATH)) {
    console.log('[resume.parse.pdf.volcengine.skip]', {
      filename,
      reason: 'volcengine_script_missing',
      elapsed_ms: 0,
    });
    return { ok: false, reason: 'volcengine_script_missing' };
  }

  try {
    const tempPdf = createTempFileFromBuffer({
      ext: path.extname(String(filename || '')).toLowerCase() || '.pdf',
      fileBuffer,
    });
    try {
      const result = spawnSync(
        VOLCENGINE_PYTHON_BIN,
        [VOLCENGINE_SCRIPT_PATH, tempPdf.filePath],
        {
          encoding: 'utf8',
          timeout: VOLCENGINE_TIMEOUT_MS,
          env: process.env,
        },
      );
      if (result.error) {
        console.log('[resume.parse.pdf.volcengine.error]', {
          filename,
          reason: result.error.message || 'volcengine_spawn_failed',
          elapsed_ms: Date.now() - startedAt,
        });
        return { ok: false, reason: result.error.message || 'volcengine_spawn_failed' };
      }
      const parsed = parseJsonOutput(result.stdout);
      if (!parsed || parsed.ok !== true) {
        console.log('[resume.parse.pdf.volcengine.fail]', {
          filename,
          reason: parsed?.error || String(result.stderr || '').trim() || 'volcengine_parse_failed',
          elapsed_ms: Date.now() - startedAt,
        });
        return {
          ok: false,
          reason: parsed?.error || String(result.stderr || '').trim() || 'volcengine_parse_failed',
          raw_stdout_preview: normalizeExtractedText(String(result.stdout || '')).slice(0, 400),
          raw_stderr_preview: normalizeExtractedText(String(result.stderr || '')).slice(0, 400),
        };
      }

      console.log('[resume.parse.pdf.volcengine.ok]', {
        filename,
        used_ocr: Boolean(parsed.used_ocr),
        text_length: normalizeExtractedText(parsed.raw_text || parsed.markdown || '').length,
        elapsed_ms: Date.now() - startedAt,
      });
      return {
        ok: true,
        parser: String(parsed.parser || 'volcengine'),
        used_ocr: Boolean(parsed.used_ocr),
        markdown: normalizeExtractedText(parsed.markdown || ''),
        raw_text: normalizeExtractedText(parsed.raw_text || parsed.markdown || ''),
        debug: parsed.debug || null,
      };
    } finally {
      tempPdf.cleanup();
    }
  } catch (error) {
    console.log('[resume.parse.pdf.volcengine.error]', {
      filename,
      reason: error?.message || String(error),
      elapsed_ms: Date.now() - startedAt,
    });
    return {
      ok: false,
      reason: error?.message || String(error),
    };
  }
};

const buildVolcengineParseMeta = ({ filename, result }) => ({
  parser: result.parser || 'volcengine',
  used_ocr: Boolean(result.used_ocr),
  quality: 'good',
  original_filename: filename,
  remote_ocr_preview: normalizeExtractedText(result.markdown || result.raw_text).slice(0, 300),
  volcengine_request_id: String(result.debug?.request_id || '').trim(),
  volcengine_time_elapsed: String(result.debug?.time_elapsed || '').trim(),
});

const extractResumeTextFromBinary = async ({ filename, fileBase64, buffer }) => {
  const startedAt = Date.now();
  const ext = path.extname(String(filename || '')).toLowerCase();
  const fileBuffer = buffer && Buffer.isBuffer(buffer)
    ? buffer
    : Buffer.from(String(fileBase64 || ''), 'base64');

  if (!fileBuffer.length) {
    throw new Error('empty file content');
  }

  if (ext === '.pdf') {
    console.log('[resume.parse.binary.start]', {
      filename,
      ext,
      size_bytes: fileBuffer.length,
    });
    if (RESUME_PDF_PARSER === 'volcengine') {
      const volcengineResult = runVolcengineResumeParser({ filename, fileBuffer });
      if (!volcengineResult.ok || !hasUsablePdfText(volcengineResult.raw_text)) {
        throw new Error(volcengineResult.reason || 'volcengine pdf parse failed');
      }
      console.log('[resume.parse.binary.done]', {
        filename,
        ext,
        parser: volcengineResult.parser,
        text_length: String(volcengineResult.raw_text || '').length,
        elapsed_ms: Date.now() - startedAt,
      });
      return {
        text: volcengineResult.raw_text,
        parse_meta: buildVolcengineParseMeta({ filename, result: volcengineResult }),
      };
    }

    const pdfParseStartedAt = Date.now();
    const primaryText = await extractPdfTextWithPdfParse({ fileBuffer });
    console.log('[resume.parse.pdf.pdf_parse.done]', {
      filename,
      text_length: primaryText.length,
      usable: hasUsablePdfText(primaryText),
      elapsed_ms: Date.now() - pdfParseStartedAt,
    });
    if (hasUsablePdfText(primaryText)) {
      console.log('[resume.parse.binary.done]', {
        filename,
        ext,
        parser: 'legacy',
        stage: 'pdf_parse',
        text_length: primaryText.length,
        elapsed_ms: Date.now() - startedAt,
      });
      return {
        text: primaryText,
        parse_meta: {
          parser: 'legacy',
          used_ocr: false,
          quality: 'good',
          original_filename: filename,
        },
      };
    }

    console.log('[resume.parse.binary.fail]', {
      filename,
      ext,
      elapsed_ms: Date.now() - startedAt,
    });
    throw new Error('pdf text extraction returned insufficient text');
  }

  if (ext === '.docx') {
    console.log('[resume.parse.binary.start]', {
      filename,
      ext,
      size_bytes: fileBuffer.length,
    });
    const mammothStartedAt = Date.now();
    const parsed = await mammoth.extractRawText({ buffer: fileBuffer });
    const text = normalizeExtractedText(parsed?.value || '');
    console.log('[resume.parse.binary.done]', {
      filename,
      ext,
      parser: 'mammoth',
      text_length: text.length,
      extract_elapsed_ms: Date.now() - mammothStartedAt,
      elapsed_ms: Date.now() - startedAt,
    });
    return {
      text,
      parse_meta: {
        parser: 'mammoth',
        used_ocr: false,
        quality: 'good',
      },
    };
  }

  throw new Error(`unsupported binary resume extension: ${ext || 'unknown'}`);
};

module.exports = {
  normalizeExtractedText,
  extractResumeTextFromBinary,
  hasUsablePdfText,
};
