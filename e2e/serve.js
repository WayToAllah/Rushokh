// e2e/serve.js — سيرفر لاختبارات المتصفح: قاعدة بيانات مؤقتة فيها بيانات التجربة، وتتمسح لما يقفل
const path = require("path");
const fs = require("fs");
const os = require("os");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rasokh-e2e-"));
process.env.DB_PATH = path.join(dir, "e2e.db");
process.env.JWT_SECRET = "e2e-secret-".padEnd(48, "x");
process.env.TRUST_PROXY = "";
process.env.SMTP_HOST = process.env.SMTP_USER = process.env.SMTP_PASS = "";

require("../db/seed").seed();
const app = require("../server");
const port = Number(process.env.E2E_PORT) || 4199;
const server = app.listen(port, "127.0.0.1", () => console.log(`e2e server on ${port}`));

function shutdown() {
  server.close(() => {
    try { require("../db/database").close(); } catch (e) { /* مقفولة */ }
    fs.rmSync(dir, { recursive: true, force: true });
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
