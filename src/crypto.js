// Password hashing via Node's built-in crypto.scrypt — deliberately avoids
// pulling in a third-party bcrypt package for the one piece of code where
// fewer dependencies = smaller attack surface.
const crypto = require('crypto');

const KEY_LEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, KEY_LEN).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const candidate = crypto.scryptSync(password, salt, KEY_LEN).toString('hex');
  // Constant-time comparison — avoids leaking timing information about how
  // much of the hash matched.
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { hashPassword, verifyPassword };
