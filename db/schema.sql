-- ============================================================
-- منصة رسوخ - مخطط قاعدة البيانات (SQLite)
-- ============================================================
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS students (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name       TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  phone           TEXT,
  age             INTEGER,
  address         TEXT,
  password_hash   TEXT NOT NULL,
  current_stage_id INTEGER,
  is_blocked      INTEGER NOT NULL DEFAULT 0,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (current_stage_id) REFERENCES stages(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name       TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  order_index     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS subjects (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  icon            TEXT
);

-- ربط الأقسام بالمراحل (many-to-many)
CREATE TABLE IF NOT EXISTS stage_subject (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id        INTEGER NOT NULL,
  subject_id      INTEGER NOT NULL,
  order_index     INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (stage_id) REFERENCES stages(id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
  UNIQUE(stage_id, subject_id)
);

CREATE TABLE IF NOT EXISTS series (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_subject_id    INTEGER NOT NULL,
  name                TEXT NOT NULL,
  url                 TEXT,
  order_index         INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (stage_subject_id) REFERENCES stage_subject(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS episodes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id       INTEGER NOT NULL,
  title           TEXT NOT NULL,
  url             TEXT,
  duration        TEXT,
  order_index     INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS books (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id       INTEGER NOT NULL,
  title           TEXT NOT NULL,
  file_url        TEXT,
  total_pages     INTEGER NOT NULL DEFAULT 0,
  order_index     INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS student_episode_progress (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id      INTEGER NOT NULL,
  episode_id      INTEGER NOT NULL,
  listened        INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
  UNIQUE(student_id, episode_id)
);

CREATE TABLE IF NOT EXISTS student_book_progress (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id      INTEGER NOT NULL,
  book_id         INTEGER NOT NULL,
  current_page    INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
  UNIQUE(student_id, book_id)
);

CREATE TABLE IF NOT EXISTS tests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id       INTEGER NOT NULL,
  title           TEXT NOT NULL,
  pass_percent    INTEGER NOT NULL DEFAULT 60,
  FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS questions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id         INTEGER NOT NULL,
  text            TEXT NOT NULL,
  -- mcq (اختيار من متعدد) | true_false (صح وغلط) | fill (أكمل) | essay (مقالي)
  type            TEXT NOT NULL DEFAULT 'mcq',
  points          INTEGER NOT NULL DEFAULT 1,
  -- أكمل: قائمة الإجابات المقبولة (JSON). مقالي: إجابة نموذجية للمصحح (نص). غيرهم: فاضي
  answer_key      TEXT,
  order_index     INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS options (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id     INTEGER NOT NULL,
  text            TEXT NOT NULL,
  is_correct      INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS student_test_attempts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id      INTEGER NOT NULL,
  test_id         INTEGER NOT NULL,
  score           INTEGER NOT NULL,
  passed          INTEGER NOT NULL,
  -- graded: النتيجة نهائية | pending: فيه أسئلة مقالية مستنية تصحيح المشرف (passed = 0 لحد ما تتصحح)
  status          TEXT NOT NULL DEFAULT 'graded',
  attempted_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE
);

-- إتمام الطالب لمرحلة (يُسجَّل تلقائيًا عند الانتقال، ويُستخدم لإصدار الشهادة)
CREATE TABLE IF NOT EXISTS student_stage_completions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id      INTEGER NOT NULL,
  stage_id        INTEGER NOT NULL,
  completed_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (stage_id) REFERENCES stages(id) ON DELETE CASCADE,
  UNIQUE(student_id, stage_id)
);

-- كود تأكيد البريد المستني (واحد لكل طالب). الوقت بالمللي ثانية.
CREATE TABLE IF NOT EXISTS email_verifications (
  student_id      INTEGER PRIMARY KEY,
  code_hash       TEXT NOT NULL,
  expires_at      INTEGER NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  sent_at         INTEGER NOT NULL,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

-- كود تغيير كلمة المرور (نسيت كلمة المرور)، بنفس شكل جدول تأكيد البريد
CREATE TABLE IF NOT EXISTS password_resets (
  student_id      INTEGER PRIMARY KEY,
  code_hash       TEXT NOT NULL,
  expires_at      INTEGER NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  sent_at         INTEGER NOT NULL,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_stage_subject_stage ON stage_subject(stage_id);
CREATE INDEX IF NOT EXISTS idx_series_stage_subject ON series(stage_subject_id);
CREATE INDEX IF NOT EXISTS idx_episodes_series ON episodes(series_id);
CREATE INDEX IF NOT EXISTS idx_books_series ON books(series_id);
CREATE INDEX IF NOT EXISTS idx_sep_student ON student_episode_progress(student_id);
CREATE INDEX IF NOT EXISTS idx_sbp_student ON student_book_progress(student_id);
CREATE INDEX IF NOT EXISTS idx_questions_test ON questions(test_id);
CREATE INDEX IF NOT EXISTS idx_options_question ON options(question_id);
-- إجابة الطالب على كل سؤال في كل محاولة (عشان تصحيح المقالي ومراجعة الإجابات)
CREATE TABLE IF NOT EXISTS student_answers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id      INTEGER NOT NULL,
  question_id     INTEGER NOT NULL,
  option_id       INTEGER,
  answer_text     TEXT,
  -- 1 صح | 0 غلط | NULL مستني تصحيح (مقالي)
  is_correct      INTEGER,
  points_awarded  REAL,
  max_points      INTEGER NOT NULL DEFAULT 1,
  feedback        TEXT,
  graded_at       TEXT,
  FOREIGN KEY (attempt_id) REFERENCES student_test_attempts(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_answers_attempt ON student_answers(attempt_id);

CREATE INDEX IF NOT EXISTS idx_attempts_student ON student_test_attempts(student_id);
