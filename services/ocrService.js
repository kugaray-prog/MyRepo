const Tesseract = require('tesseract.js');
const path = require('path');

const TESSDATA_PATH = path.join(__dirname, '..', 'tessdata');

/**
 * Runs Tesseract OCR on the given image path and returns raw text + confidence.
 * Uses a locally bundled eng.traineddata (see /tessdata) so this works fully
 * offline / behind restrictive firewalls, with no runtime CDN dependency.
 */
async function extractText(imagePath) {
  try {
    const { data } = await Tesseract.recognize(imagePath, 'eng', {
      langPath: TESSDATA_PATH,
      gzip: true,
      cacheMethod: 'none',
      logger: () => {} // silence per-tile progress logs
    });
    return {
      text: data.text || '',
      confidence: data.confidence || 0 // 0-100
    };
  } catch (err) {
    // Never let an OCR engine failure (bad image, corrupted upload, etc.) crash the process.
    console.error('OCR extraction failed:', err.message);
    return { text: '', confidence: 0 };
  }
}

/**
 * Parses raw OCR text looking for an employee code (e.g. E001, EMP-001)
 * and attempts to match a name line against known employees.
 */
function parseIdCard(rawText) {
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const codeMatch = rawText.match(/\b([A-Z]{1,4}-?\d{2,6})\b/);
  const employeeCode = codeMatch ? codeMatch[1].replace('-', '') : null;

  // Heuristic: the longest alphabetic line is likely the printed name
  const nameLine = lines
    .filter((l) => /^[A-Za-z.,'\s]{4,}$/.test(l))
    .sort((a, b) => b.length - a.length)[0] || null;

  return { employeeCode, nameGuess: nameLine, lines };
}

module.exports = { extractText, parseIdCard };
