const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

function getCertificatePaths(config) {
  const certificatesDir = config.certificatesDir || path.join(__dirname, '..', 'certificates');
  return {
    certificatesDir,
    keyPath: path.join(certificatesDir, config.httpsKeyFile || 'chitrac.key'),
    certPath: path.join(certificatesDir, config.httpsCertFile || 'chitrac.crt')
  };
}

function certificateFilesExist(config) {
  const { keyPath, certPath } = getCertificatePaths(config);
  return fs.existsSync(keyPath) && fs.existsSync(certPath);
}

function loadHttpsCredentials(config) {
  const { keyPath, certPath } = getCertificatePaths(config);
  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  };
}

async function generateSelfSignedCertificate(config, options = {}) {
  if (process.platform !== 'linux') {
    const error = new Error('SSL certificate generation is only supported on Linux servers');
    error.status = 400;
    throw error;
  }

  const { certificatesDir, keyPath, certPath } = getCertificatePaths(config);
  await fs.promises.mkdir(certificatesDir, { recursive: true });

  const commonName = `${options.commonName || config.systemName || 'ChiTrac'}`.trim() || 'ChiTrac';
  const days = Number.isFinite(Number(options.days)) ? `${Number(options.days)}` : '3650';

  await execFileAsync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:4096',
    '-sha256',
    '-days',
    days,
    '-nodes',
    '-keyout',
    keyPath,
    '-out',
    certPath,
    '-subj',
    `/CN=${commonName}`
  ]);

  return {
    certificatesDir,
    keyPath,
    certPath
  };
}

module.exports = {
  getCertificatePaths,
  certificateFilesExist,
  loadHttpsCredentials,
  generateSelfSignedCertificate
};
