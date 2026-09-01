const multer = require('multer');
const path = require('path');
const fs = require('fs');

function makeStorage(subfolder) {
  const dest = path.join(__dirname, '..', 'uploads', subfolder);
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dest),
    filename: (req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}${path.extname(file.originalname)}`);
    }
  });
}

const imageFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|webp/;
  const ok = allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype);
  if (ok) return cb(null, true);
  cb(new Error('Only image files (jpg, jpeg, png, webp) are allowed.'));
};

const uploadOcr = multer({
  storage: makeStorage('ocr'),
  fileFilter: imageFilter,
  limits: { fileSize: 8 * 1024 * 1024 } // 8MB
});

const uploadPhoto = multer({
  storage: makeStorage('photos'),
  fileFilter: imageFilter,
  limits: { fileSize: 4 * 1024 * 1024 }
});

const uploadSelfie = multer({
  storage: makeStorage('selfies'),
  fileFilter: imageFilter,
  limits: { fileSize: 6 * 1024 * 1024 }
});

// Batch employee import (CSV/Excel) — kept in memory (not written to disk)
// since the file is parsed once and discarded, never served back to a browser.
const importFileFilter = (req, file, cb) => {
  const allowed = /csv|xlsx|xls/;
  const ok = allowed.test(path.extname(file.originalname).toLowerCase());
  if (ok) return cb(null, true);
  cb(new Error('Only .csv, .xlsx, or .xls files are allowed.'));
};

const uploadImportFile = multer({
  storage: multer.memoryStorage(),
  fileFilter: importFileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

module.exports = { uploadOcr, uploadPhoto, uploadSelfie, uploadImportFile };
