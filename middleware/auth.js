// middleware/auth.js
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "rasokh-dev-secret-change-me";

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

// يتحقق من وجود توكن صالح ويضع بيانات المستخدم في req.user
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "الرجاء تسجيل الدخول أولاً." });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, role: 'student' | 'admin' }
    next();
  } catch (err) {
    return res.status(401).json({ error: "الجلسة منتهية أو غير صالحة، الرجاء تسجيل الدخول مجدداً." });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: "ليست لديك صلاحية للوصول لهذا المورد." });
    }
    next();
  };
}

module.exports = { signToken, requireAuth, requireRole, JWT_SECRET };
