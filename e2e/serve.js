// e2e/serve.js — سيرفر لاختبارات المتصفح: قاعدة بيانات مؤقتة فيها بيانات التجربة، وتتمسح لما يقفل.
// مع E2E_MAIL=1 بيشغّل كمان سيرفر إيميل وهمي (تأكيد البريد ونسيت كلمة المرور شغّالين)،
// وصفحة صغيرة على E2E_MAILBOX_PORT الاختبارات بتقرا منها آخر كود وصل لأي بريد:
//   GET /code?to=<email>&kind=verify|reset
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rasokh-e2e-"));
process.env.DB_PATH = path.join(dir, "e2e.db");
process.env.JWT_SECRET = "e2e-secret-".padEnd(48, "x");
process.env.TRUST_PROXY = "";
process.env.SMTP_HOST = process.env.SMTP_USER = process.env.SMTP_PASS = process.env.MAIL_FROM = "";

async function startMailbox() {
  const { SMTPServer } = require("smtp-server");
  const { simpleParser } = require("mailparser");
  const messages = [];
  const smtp = new SMTPServer({
    secure: false, disabledCommands: ["STARTTLS"], authMethods: ["PLAIN", "LOGIN"], logger: false,
    onAuth(auth, session, cb) { cb(null, { user: auth.username }); },
    onData(stream, session, cb) { simpleParser(stream).then(m => { messages.push(m); cb(); }, cb); },
  });
  await new Promise(resolve => smtp.listen(0, "127.0.0.1", resolve));
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = String(smtp.server.address().port);
  process.env.SMTP_USER = "sender@e2e.test";
  process.env.SMTP_PASS = "test";

  const box = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const to = url.searchParams.get("to");
    const kind = url.searchParams.get("kind");
    const m = messages
      .filter(x => x.to.value[0].address === to)
      .filter(x => kind === "reset" ? /كلمة المرور/.test(x.subject) : !/كلمة المرور/.test(x.subject))
      .slice(-1)[0];
    const code = m ? (m.subject.match(/\d{6}/) || [])[0] : null;
    res.writeHead(code ? 200 : 404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code }));
  });
  await new Promise(resolve => box.listen(Number(process.env.E2E_MAILBOX_PORT), "127.0.0.1", resolve));
  return () => { smtp.close(); box.close(); };
}

(async () => {
  const stopMailbox = process.env.E2E_MAIL === "1" ? await startMailbox() : () => {};

  require("../db/seed").seed();
  const app = require("../server");
  const port = Number(process.env.E2E_PORT) || 4199;
  const server = app.listen(port, "127.0.0.1", () => console.log(`e2e server on ${port}`));

  function shutdown() {
    stopMailbox();
    server.close(() => {
      try { require("../db/database").close(); } catch (e) { /* مقفولة */ }
      fs.rmSync(dir, { recursive: true, force: true });
      process.exit(0);
    });
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
})();
