const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const mammoth = require('mammoth');
const { PDFParse } = require('pdf-parse');

const ROOT_DIR = path.resolve(__dirname, '../../../..');
const RESUME_PDF_PARSER = String(process.env.RESUME_PDF_PARSER || 'legacy').trim().toLowerCase();
const DEFAULT_DOCLING_PYTHON = path.join(ROOT_DIR, 'apps/api/.venv-sirchmunk/bin/python');
const DOCLING_PYTHON_BIN = process.env.DOCLING_PYTHON_BIN
  || (fs.existsSync(DEFAULT_DOCLING_PYTHON) ? DEFAULT_DOCLING_PYTHON : 'python3');
const DOCLING_SCRIPT_PATH = process.env.DOCLING_SCRIPT_PATH
  ? path.resolve(ROOT_DIR, process.env.DOCLING_SCRIPT_PATH)
  : path.join(ROOT_DIR, 'scripts/parse_resume_docling.py');
const DOCLING_TIMEOUT_MS = Number(process.env.DOCLING_TIMEOUT_MS || 90000);

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

const extractPdfTextWithMdls = ({ filePath }) => {
  if (!filePath || !hasCommand('mdls')) return '';
  const result = spawnSync(
    'mdls',
    ['-raw', '-name', 'kMDItemTextContent', filePath],
    { encoding: 'utf8' },
  );
  if (result.error || result.status !== 0) return '';
  const output = String(result.stdout || '').trim();
  if (!output || output === '(null)') return '';
  return normalizeExtractedText(output);
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

const parseDoclingOutput = (raw) => {
  try {
    const parsed = JSON.parse(String(raw || '').trim());
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const pickDoclingPreview = (debug) =>
  String(
    debug?.pages?.[0]?.vlm_text_preview
      || debug?.remote_ocr?.content_preview
      || debug?.remote_ocr?.preview
      || debug?.remote_ocr?.body_preview
      || '',
  ).trim();

const runDoclingResumeParser = ({ filename, fileBuffer }) => {
  if (RESUME_PDF_PARSER !== 'docling') {
    return { ok: false, reason: 'docling_disabled' };
  }
  if (!fs.existsSync(DOCLING_SCRIPT_PATH)) {
    return { ok: false, reason: 'docling_script_missing' };
  }

  const tempPdf = createTempFileFromBuffer({
    ext: path.extname(String(filename || '')).toLowerCase() || '.pdf',
    fileBuffer,
  });

  try {
    const result = spawnSync(
      DOCLING_PYTHON_BIN,
      [DOCLING_SCRIPT_PATH, tempPdf.filePath],
      {
        encoding: 'utf8',
        timeout: DOCLING_TIMEOUT_MS,
        env: process.env,
      },
    );
    if (result.error) {
      return { ok: false, reason: result.error.message || 'docling_spawn_failed' };
    }
    const parsed = parseDoclingOutput(result.stdout);
    if (!parsed || parsed.ok !== true) {
      return {
        ok: false,
        reason: parsed?.error || String(result.stderr || '').trim() || 'docling_parse_failed',
        raw_stdout_preview: normalizeExtractedText(String(result.stdout || '')).slice(0, 400),
        raw_stderr_preview: normalizeExtractedText(String(result.stderr || '')).slice(0, 400),
      };
    }

    return {
      ok: true,
      parser: String(parsed.parser || 'docling'),
      used_ocr: Boolean(parsed.used_ocr),
      markdown: normalizeExtractedText(parsed.markdown || ''),
      raw_text: normalizeExtractedText(parsed.raw_text || parsed.markdown || ''),
      debug: parsed.debug || null,
    };
  } finally {
    tempPdf.cleanup();
  }
};

const summarizeResume = (resumeText) => {
  const lines = String(resumeText || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

  const skillHints = ['react', 'vue', 'angular', 'typescript', 'javascript', 'node', 'zustand', 'redux'];
  const lowered = lines.join(' ').toLowerCase();
  const skills = skillHints.filter((item) => lowered.includes(item)).slice(0, 6);
  const yearsMatch = lowered.match(/(\d+)\s*年/);
  const years = yearsMatch ? `${yearsMatch[1]}年经验` : '经验年限未明确';
  const topLines = lines.slice(0, 3).join('；').slice(0, 140);

  return `候选人${years}，核心技能：${skills.join('、') || '待补充'}。简历摘要：${topLines || '待补充'}`;
};

const extractResumeTextFromBinary = async ({ filename, fileBase64, buffer }) => {
  const ext = path.extname(String(filename || '')).toLowerCase();
  const fileBuffer = buffer && Buffer.isBuffer(buffer)
    ? buffer
    : Buffer.from(String(fileBase64 || ''), 'base64');

  if (!fileBuffer.length) {
    throw new Error('empty file content');
  }

  if (ext === '.pdf') {
    const doclingResult = runDoclingResumeParser({ filename, fileBuffer });
    if (doclingResult.ok && hasUsablePdfText(doclingResult.raw_text)) {
      return {
        text: doclingResult.raw_text,
        parse_meta: {
          parser: doclingResult.parser || 'docling',
          used_ocr: Boolean(doclingResult.used_ocr),
          fallback_used: false,
          quality: 'good',
          original_filename: filename,
          remote_ocr_preview: pickDoclingPreview(doclingResult.debug),
          format_fallback: doclingResult.debug?.format_fallback || '',
          docling_stdout_preview: '',
          docling_stderr_preview: '',
        },
      };
    }

    try {
      const primaryText = await extractPdfTextWithPdfParse({ fileBuffer });
      if (hasUsablePdfText(primaryText)) {
        return {
          text: primaryText,
          parse_meta: {
            parser: 'legacy',
            used_ocr: false,
            fallback_used: Boolean(doclingResult.reason),
            quality: 'good',
            original_filename: filename,
            fallback_reason: doclingResult.reason || '',
            docling_stdout_preview: doclingResult.raw_stdout_preview || '',
            docling_stderr_preview: doclingResult.raw_stderr_preview || '',
            remote_ocr_preview: pickDoclingPreview(doclingResult.debug),
            format_fallback: doclingResult.debug?.format_fallback || '',
          },
        };
      }
    } catch {}

    const tempPdf = createTempFileFromBuffer({ ext, fileBuffer });
    try {
      const fallbackText = extractPdfTextWithMdls({ filePath: tempPdf.filePath });
      if (hasUsablePdfText(fallbackText)) {
        return {
          text: fallbackText,
          parse_meta: {
            parser: 'legacy',
            used_ocr: false,
            fallback_used: true,
            quality: 'good',
            original_filename: filename,
            fallback_reason: doclingResult.reason || 'pdf_parse_insufficient',
            docling_stdout_preview: doclingResult.raw_stdout_preview || '',
            docling_stderr_preview: doclingResult.raw_stderr_preview || '',
            remote_ocr_preview: pickDoclingPreview(doclingResult.debug),
            format_fallback: doclingResult.debug?.format_fallback || '',
          },
        };
      }
    } finally {
      tempPdf.cleanup();
    }

    throw new Error('pdf text extraction failed or returned insufficient text');
  }

  if (ext === '.docx') {
    const parsed = await mammoth.extractRawText({ buffer: fileBuffer });
    return {
      text: normalizeExtractedText(parsed?.value || ''),
      parse_meta: {
        parser: 'mammoth',
        used_ocr: false,
        fallback_used: false,
        quality: 'good',
      },
    };
  }

  throw new Error(`unsupported binary resume extension: ${ext || 'unknown'}`);
};

module.exports = {
  normalizeExtractedText,
  summarizeResume,
  extractResumeTextFromBinary,
  parseDoclingOutput,
  pickDoclingPreview,
  hasUsablePdfText,
};
