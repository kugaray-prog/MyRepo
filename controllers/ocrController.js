const pool = require('../config/db');
const ocrService = require('../services/ocrService');
const config = require('../config/config');
const { logAction } = require('../services/auditService');

// POST /api/ocr/verify  (multipart: image; body: expected_employee_code optional)
async function verifyId(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'An ID card image is required.' });
    }

    const imagePath = `/uploads/ocr/${req.file.filename}`;
    const absolutePath = req.file.path;

    const { text, confidence } = await ocrService.extractText(absolutePath);
    const { employeeCode, nameGuess } = ocrService.parseIdCard(text);

    let result = 'unreadable';
    let matchedEmployee = null;

    if (!text || text.trim().length < 3) {
      result = 'unreadable';
    } else if (confidence < config.ocr.minConfidence) {
      result = 'low_confidence';
    } else if (!employeeCode) {
      result = 'unreadable';
    } else {
      const [rows] = await pool.query(
        `SELECT e.*, d.name AS department_name FROM employees e
         JOIN departments d ON e.department_id = d.id WHERE e.employee_code = ?`,
        [employeeCode]
      );
      if (!rows[0]) {
        result = 'wrong_id';
      } else if (rows[0].status === 'Inactive') {
        result = 'expired';
      } else {
        matchedEmployee = rows[0];
        result = 'matched';
      }
    }

    const [insertResult] = await pool.query(
      `INSERT INTO ocr_records (employee_id, image_path, extracted_text, extracted_employee_code, extracted_name, confidence, result)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [matchedEmployee ? matchedEmployee.id : null, imagePath, text, employeeCode, nameGuess, confidence, result]
    );

    await logAction({ adminId: req.admin ? req.admin.id : null, action: 'ocr_verify', module: 'ocr', details: { result, employeeCode }, ip: req.ip });

    res.json({
      success: result === 'matched',
      result,
      ocrRecordId: insertResult.insertId,
      confidence,
      extractedEmployeeCode: employeeCode,
      extractedName: nameGuess,
      employee: matchedEmployee
        ? {
            id: matchedEmployee.id,
            employee_code: matchedEmployee.employee_code,
            full_name: matchedEmployee.full_name,
            department: matchedEmployee.department_name
          }
        : null,
      message: ocrResultMessage(result)
    });
  } catch (err) {
    next(err);
  }
}

function ocrResultMessage(result) {
  const messages = {
    matched: 'Identity verified successfully.',
    wrong_employee: 'The scanned ID does not match the logged-in employee.',
    wrong_id: 'No employee record matches this ID.',
    unreadable: 'Could not read the ID card. Please retake the photo with better lighting.',
    duplicate: 'This ID has already been used for attendance today.',
    expired: 'This employee record is inactive.',
    low_confidence: 'OCR confidence too low. Please retake the photo.'
  };
  return messages[result] || 'Verification failed.';
}

// GET /api/ocr/records
async function getOcrRecords(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT o.*, e.full_name, e.employee_code FROM ocr_records o
       LEFT JOIN employees e ON o.employee_id = e.id
       ORDER BY o.created_at DESC LIMIT 100`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
}

module.exports = { verifyId, getOcrRecords };
