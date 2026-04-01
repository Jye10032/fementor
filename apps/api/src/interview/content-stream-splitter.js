const { extractJsonObject } = require('../llm');

const CONTENT_MARKER_RE = /"content"\s*:\s*"/;

/**
 * Creates a stateful stream splitter that buffers structural JSON fields
 * and streams the `content` field tokens in real time.
 *
 * Usage:
 *   const splitter = createContentStreamSplitter({ onContentToken, onComplete });
 *   for await (const token of streamCompletion(...)) { await splitter.feed(token); }
 *   return splitter.end();
 */
function createContentStreamSplitter({ onContentToken }) {
  let buffer = '';
  let contentStarted = false;
  let markerCheckedUpTo = 0;

  return {
    async feed(token) {
      buffer += token;

      if (contentStarted) {
        if (typeof onContentToken === 'function') {
          await onContentToken(token);
        }
        return;
      }

      // Only check new portion of buffer for the marker
      const searchFrom = Math.max(0, markerCheckedUpTo - 15);
      const match = CONTENT_MARKER_RE.exec(buffer.slice(searchFrom));
      if (match) {
        contentStarted = true;
        const markerEnd = searchFrom + match.index + match[0].length;
        const afterMarker = buffer.slice(markerEnd);
        if (afterMarker && typeof onContentToken === 'function') {
          await onContentToken(afterMarker);
        }
      }
      markerCheckedUpTo = buffer.length;
    },

    end() {
      const parsed = extractJsonObject(buffer);
      if (!parsed) {
        throw new Error('Failed to parse unified LLM response JSON');
      }

      // If content never streamed (field wasn't last or marker not found),
      // the parsed.content is still available for the caller to use
      const contentText = String(parsed.content || '').trim();

      // Clean up: remove trailing JSON artifacts from streamed content
      // (the last token may include `"}\n` etc.)
      // The parsed.content from extractJsonObject is the authoritative value.

      return {
        ...parsed,
        content: contentText,
        _contentWasStreamed: contentStarted,
      };
    },
  };
}

module.exports = { createContentStreamSplitter };
