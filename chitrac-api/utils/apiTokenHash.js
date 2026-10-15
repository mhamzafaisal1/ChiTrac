const crypto = require('node:crypto');

// bcrypt truncates at 72 bytes; JWTs must be digested before hashing in new records.
function tokenHashInput(token, version) {
  return version === 2 ? crypto.createHash('sha256').update(token).digest('hex') : token;
}

module.exports = { tokenHashInput };
