---
title: Rushokh
emoji: 📚
colorFrom: green
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
---

# رسوخ — الباك إند (Backend)

باك إند منصة "رسوخ" لأكاديمية العلم الشرعي. مبني بـ **Node.js + Express**، وقاعدة بيانات
**SQLite** عبر وحدة `node:sqlite` المدمجة مع Node.js (بدون الحاجة لتثبيت حزمة native
تحتاج بيئة بناء/ترجمة).

> ⚠️ **متطلب مهم:** يحتاج المشروع Node.js **الإصدار 22.5.0 أو أحدث** لأن `node:sqlite`
> ميزة مدمجة حديثة. تحقق بالأمر `node -v`.
> إن كنت تفضل استخدام إصدار Node أقدم، يمكن استبدال `db/database.js` بحزمة
> `better-sqlite3` التقليدية (نفس الاستدعاءات `prepare/run/get/all` متوافقة تقريبًا).

## التشغيل

```bash
npm install
cp .env.example .env      # اختياري: لو ما حطيتش JWT_SECRET هيتولّد مفتاح عشوائي لوحده
npm run seed               # يبني قاعدة البيانات ويعبئها ببيانات تجريبية
npm start                  # يشغل السيرفر على http://localhost:4000
```

بعد التشغيل، افتح المتصفح على **http://localhost:4000** مباشرة — هتظهر
`index.html` تلقائيًا لأن السيرفر بقى يقدّم ملفات الواجهة من مجلد `public/`
بجانب الـ API، فمفيش داعي تفتح ملفات الـ HTML يدويًا.

### حسابات تجريبية بعد التشغيل (`npm run seed`)

| الدور  | البريد               | كلمة المرور |
|--------|-----------------------|-------------|
| مشرف   | admin@rasokh.test     | admin123    |
| طالب   | ahmed@rasokh.test     | student123  |

> دي للتجربة على جهازك بس. أول تشغيل تلقائي (`start.bat` أو Docker، عن طريق `db/ensure-seed.js`)
> **مابيستخدمهاش**: بيعمل المشرف بـ `ADMIN_EMAIL` / `ADMIN_PASSWORD` لو موجودين، وإلا بكلمة مرور
> عشوائية بتظهر مرة واحدة في شباك السيرفر، ومن غير طالب تجريبي.

## البنية

```
rasokh-backend/
├── server.js              # نقطة الدخول، يربط كل المسارات
├── db/
│   ├── schema.sql          # مخطط الجداول الـ14
│   ├── database.js         # اتصال SQLite + تنفيذ المخطط تلقائيًا
│   ├── seed.js              # بيانات تجريبية (npm run seed)
│   └── rasokh.db            # ملف قاعدة البيانات (يُنشأ تلقائيًا)
├── middleware/
│   └── auth.js              # توليد/التحقق من JWT + التحقق من الدور (طالب/مشرف)
└── routes/
    ├── auth.js               # تسجيل / دخول طالب / دخول مشرف
    ├── curriculum.js         # جلب منهج الطالب مع حالة كل مرحلة
    ├── progress.js           # تحديث تقدم الحلقات/الكتب + تقرير الطالب + الشهادة
    ├── tests.js               # جلب اختبار + تسليم إجابات وتصحيحها
    └── admin/
        ├── content.js         # CRUD: مراحل، أقسام، ربط، سلاسل، حلقات، كتب
        ├── tests.js            # CRUD: اختبارات وأسئلة وخيارات
        └── students.js         # قائمة الطلاب، منع/تفعيل، حذف، تقرير المشرف
```

## جداول قاعدة البيانات (مطابقة للوثيقة الأصلية)

`students` · `admins` · `stages` · `subjects` · `stage_subject` · `series` ·
`episodes` · `books` · `student_episode_progress` · `student_book_progress` ·
`tests` · `questions` · `options` · `student_test_attempts`

## توثيق الـ API

جميع المسارات تبدأ بـ `/api`. المسارات المحمية تحتاج ترويسة:
`Authorization: Bearer <token>`

### المصادقة (عامة)
| الطريقة | المسار                  | الوصف                          |
|---------|--------------------------|----------------------------------|
| POST    | `/auth/register`         | تسجيل طالب جديد                  |
| POST    | `/auth/login`            | دخول واحد للطالب والمشرف: الرد فيه `role` (`admin` أو `student`) |
| POST    | `/auth/admin-login`      | دخول مشرف بس (للسكريبتات)         |
| POST    | `/auth/verify-email`     | `{ email, code }`: تأكيد البريد بالكود، وبعده دخول على طول |
| POST    | `/auth/resend-code`      | `{ email }`: كود تأكيد جديد (دقيقة بين كل كود والتاني) |
| POST    | `/auth/forgot-password`  | `{ email }`: كود تغيير كلمة المرور على البريد (للطلاب، ومحتاج إعدادات `SMTP_*`). الرد واحد سواء البريد متسجّل أو لأ |
| POST    | `/auth/reset-password`   | `{ email, code, new_password }`: كلمة مرور جديدة بالكود، وبعدها دخول على طول |

لو تأكيد البريد شغّال (إعدادات `SMTP_*`): `register` بيرجّع `{ needs_verification, email }` من غير توكن،
و`login` لطالب بريده مش متأكد بيرجّع 403 بـ `needs_verification`.

### الطالب (يتطلب توكن طالب)
| الطريقة | المسار                              | الوصف                                    |
|---------|--------------------------------------|---------------------------------------------|
| GET     | `/curriculum`                        | المنهج الكامل بحالة كل مرحلة (مكتملة/حالية/مقفلة) |
| POST    | `/progress/episode`                  | `{ episode_id, listened }`                    |
| POST    | `/progress/book`                     | `{ book_id, current_page }`                   |
| GET     | `/progress/me/report`                | تقرير الطالب: `completed` / `in_progress`     |
| GET     | `/progress/certificate/:stageId`     | نسبة الإنجاز وبيانات الشهادة                 |
| GET     | `/tests/:id`                         | أسئلة الاختبار (بدون كشف الإجابة الصحيحة)     |
| POST    | `/tests/:id/attempt`                 | `{ answers:[{question_id, option_id}] }`      |

| POST    | `/account/password`                  | الطالب يغيّر كلمة المرور: `{ current_password, new_password }` |

### المشرف (يتطلب توكن مشرف)
| الطريقة | المسار                                | الوصف                                  |
|---------|----------------------------------------|--------------------------------------------|
| GET     | `/admin/content/tree`                  | عرض شجري كامل لكل المحتوى                  |
| POST    | `/admin/content/stages`                | إضافة مرحلة                                 |
| POST    | `/admin/content/subjects`              | إضافة قسم                                   |
| POST    | `/admin/content/stage-subject`         | ربط قسم بمرحلة                              |
| POST    | `/admin/content/series`                | إضافة سلسلة                                 |
| POST    | `/admin/content/episodes`              | إضافة حلقة                                  |
| POST    | `/admin/content/books`                 | إضافة كتاب                                  |
| DELETE  | `/admin/content/{stages,subjects,stage-subject,series,episodes,books}/:id` | حذف |
| GET     | `/admin/tests`                         | كل الاختبارات مع أسئلتها                    |
| POST    | `/admin/tests`                         | إنشاء اختبار: `{ series_id, title, pass_percent }` |
| POST    | `/admin/tests/questions`               | إضافة سؤال: `{ test_id, text, options:[{text,is_correct}] }` |
| DELETE  | `/admin/tests/:id`                     | حذف اختبار                                  |
| DELETE  | `/admin/tests/questions/:id`           | حذف سؤال                                    |
| GET     | `/admin/students`                      | قائمة الطلاب                                |
| PATCH   | `/admin/students/:id/block`            | `{ is_blocked: true/false }`                |
| DELETE  | `/admin/students/:id`                  | حذف طالب                                    |
| GET     | `/admin/students/:id/report`           | تقرير: `finished` (تم الانتهاء) / `started` (بدأ ولم ينتهِ) + تقدم المرحلة |
| PATCH   | `/admin/students/:id/stage`            | نقل الطالب يدويًا: `{ stage_id, reset }`. الرجوع لمرحلة خلّصها بيرد 409 `needs_reset`، ومع `reset: true` بيمسح تقدمه فيها وفي اللي بعدها عشان يعيدها |
| GET     | `/admin/account/me`                    | بيانات المشرف الحالي                        |
| POST    | `/admin/account/password`              | `{ current_password, new_password }`        |
| GET/POST| `/admin/account/admins`                | عرض/إضافة مشرفين `{ full_name, email, password }` |
| DELETE  | `/admin/account/admins/:id`            | حذف مشرف (غير نفسك وغير آخر مشرف)          |
| PATCH   | `/admin/content/{stages,subjects,series,episodes,books}/:id` | تعديل جزئي (الحقول المبعوتة بس). السلسلة: `{ name, url }` |
| POST    | `/admin/content/reorder`               | `{ kind: stages|stage-subject|series|episodes|books, ids:[...] }` |
| PATCH   | `/admin/tests/:id`                     | `{ title, pass_percent }`                   |
| PATCH   | `/admin/tests/questions/:id`           | `{ text, options:[{text,is_correct}] }` (إجابة صحيحة واحدة) |
| PATCH   | `/admin/students/:id/password`         | كلمة مرور جديدة لطالب: `{ new_password }`   |
| GET     | `/admin/reports/students.xlsx`         | تقرير Excel: ملخص الطلاب + التقدم في كل مادة |

## ملاحظات تصميم مهمة

- **الانتقال بين المراحل تلقائي** (`lib/stage-progress.js`): الطالب ينتقل للمرحلة التالية
  لما يسمع كل الحلقات، ويخلّص كل الكتب، وينجح في كل اختبارات المرحلة اللي فيها أسئلة.
  الإتمام بيتسجّل في `student_stage_completions` وعليه بتتصرف الشهادة (برقم `RSK-000001`).
  المشرف يقدر ينقل الطالب يدويًا من قائمة الطلاب. لو رجّعه لمرحلة كان خلّصها، ده معناه "يعيدها":
  تقدمه فيها وفي كل اللي بعدها وشهاداتها بيتمسحوا بعد تأكيد المشرف (وإلا كان هيرجع لوحده للمرحلة التالية).
- **المراحل المقفلة** بترجع من غير محتوى، والسيرفر بيرفض أي تقدم أو اختبار في مرحلة مقفولة.
- **تصحيح الاختبارات يتم بالكامل في السيرفر** — لا تُرسل الإجابة الصحيحة للمتصفح
  إطلاقًا عند جلب الأسئلة، فقط عند التسليم يُقارن السيرفر ويحفظ النتيجة.
- **الأمان:** مفتاح الجلسات بيتقرا من `JWT_SECRET` أو بيتولّد عشوائيًا في `db/.jwt-secret`
  (مفيش مفتاح مكتوب في الكود). محاولات الدخول الغلط محدودة لكل جهاز (فمحدش يقدر يقفل حساب غيره)،
  وعنوان الجهاز بيتاخد من ترويسات البروكسي بس لو جاية من cloudflared على نفس الجهاز أو مع `TRUST_PROXY=1`.
  كلمة المرور 8 أحرف على الأقل،
  والروابط `http/https` بس، وكل نص بيتعرض في الصفحات بيتحوّل لنص آمن قبل العرض.
  المنع والحذف بيسروا فورًا حتى على الجلسات المفتوحة.
  ترويسات: CSP (سكريبتات وطلبات من الموقع بس، وخطوط Google، والفيديو والكتب من أي رابط https)،
  وPermissions-Policy، وHSTS لما الزيارة HTTPS. والردود بتتضغط (gzip)، وأي رابط غلط بيطلّع `public/404.html`.
- **نسيت كلمة المرور:** كود على البريد بنفس نظام كود التأكيد (`lib/email-codes.js`)، طلب واحد في الدقيقة و5 في الساعة
  لكل بريد. المشرف اللي ينسى: مشرف تاني يحطله كلمة مرور، أو `npm run create-admin`.
- **رسايل الخانات:** `public/forms.js` بيعرض الخانات الناقصة أو الغلط بتصميم الموقع في كل الفورمز بدل فقاعة المتصفح.
- **تأكيد البريد** (`lib/email-verification.js`): لو إعدادات `SMTP_*` موجودة، الطالب الجديد بيوصله كود من 6 أرقام
  (صالح 15 دقيقة، 5 محاولات غلط بالكتير، وكود جديد كل دقيقة بالكتير)، ومايقدرش يدخل قبل ما يكتبه.
  كود مش رابط، عشان رابط الموقع العام بيتغيّر. الطلاب اللي سجّلوا قبل الميزة دي بيتعتبروا متأكدين.
  من غير الإعدادات، التسجيل بيشتغل زي الأول.
- **عرض داخل الموقع:** `public/media.js` بيحوّل روابط يوتيوب (فيديو أو قائمة تشغيل)، وGoogle Drive/Docs،
  وفيميو، وملفات PDF/MP4/MP3 لعرض جوه نافذة في الموقع. أي رابط تاني بيفتح في تبويب جديد.
- **حماية البيانات:** `npm run seed` بيرفض يمسح قاعدة بيانات فيها بيانات (إلا مع `--force` وبعد نسخة
  احتياطية)، والسيرفر بيعمل نسخة احتياطية في `backups/` عند التشغيل وكل 12 ساعة (آخر 30 نسخة).
- **الاختبارات:**
  - `npm test`: اختبارات السيرفر (`tests/`). كل ملف بيشغّل نسخة من الموقع بقاعدة بيانات مؤقتة،
    فمابتلمسش بياناتك. بتغطي الدخول والتسجيل، المنهج والتقدم والانتقال بين المراحل، الاختبارات والتصحيح،
    لوحة المشرف، تأكيد البريد (بسيرفر إيميل وهمي)، الأمان، وأول تشغيل.
  - `npm run test:e2e`: اختبارات متصفح حقيقي بـ Playwright (`e2e/`)، على Edge المتسطّب في الجهاز.
    لو مش موجود: `npx playwright install chromium` وبعدين `PW_CHANNEL=chromium npm run test:e2e`.
  - الاتنين بيشتغلوا لوحدهم على GitHub مع كل رفع (`.github/workflows/tests.yml`).
  - `node scripts/smoke-test.js`: فحص سريع لسيرفر شغّال على بيانات التجربة.
- **تقرير المشرف** يلتزم بالوثيقة: يعرض فقط "تم الانتهاء" و"بدأ ولم ينتهِ"، ولا
  يذكر أبدًا ما لم يبدأ الطالب فيه.
- ميزة **رفع ملفات PDF** غير مُنفذة بعد في هذا الباك إند (فقط حقل `file_url` في
  جدول `books` جاهز لاستقبال رابط الملف لاحقًا) — تحتاج مكتبة رفع ملفات (multer)
  ونقطة تخزين (مجلد محلي أو تخزين سحابي) في مرحلة لاحقة.

## النشر على الإنترنت (عشان أي حد من أي جهاز يفتح المنصة)

السيرفر بيقدّم الواجهة والـ API من نفس الرابط، فأي طريقة من دول بتشغّل المنصة كلها.

### ١) من جهازك: `start.bat` + Cloudflare Tunnel (الطريقة المستخدمة حاليًا)

- ثبّت cloudflared مرة واحدة: `winget install --id Cloudflare.cloudflared`
- `start.bat` بيسحب آخر نسخة من GitHub، ويشغّل الموقع، ويفتح شباك فيه رابط عام `https://....trycloudflare.com`.
  `update.bat` بيسحب التحديثات والموقع بيعيد تشغيل نفسه.
- **الرابط بيتغيّر** كل مرة شباك الرابط يتقفل أو الجهاز ينام، فابعته للطلاب من جديد.
  لرابط ثابت محتاج Named Tunnel بحساب Cloudflare ودومين.
- خلّي الجهاز **ما ينامش** طول ما الموقع شغّال (Settings → System → Power).
- البيانات والنسخ الاحتياطية على الجهاز نفسه (`db/` و `backups/`).

### ٢) Docker (Hugging Face Spaces أو أي استضافة تدعم Docker)

- الـ `Dockerfile` جاهز، والسيرفر بيشتغل على بورت 7860، و`TRUST_PROXY=1` متظبطة فيه.
- حط `ADMIN_EMAIL` و `ADMIN_PASSWORD` كـ Secrets عشان حساب المشرف في أول تشغيل،
  وإلا كلمة المرور بتطلع عشوائية في الـ Logs.
- ⚠️ القرص في الخطط المجانية **مش دائم**: أي إعادة تشغيل بتمسح قاعدة البيانات ومفتاح الجلسات.
  للاستخدام الحقيقي لازم تخزين دائم تربطه بـ `DB_PATH`، و`JWT_SECRET` ثابت.

### متغيرات البيئة

| المتغير | الاستخدام |
|---------|-----------|
| `PORT` | بورت السيرفر (افتراضي 4000) |
| `DB_PATH` | مكان ملف قاعدة البيانات (افتراضي `db/rasokh.db`) |
| `JWT_SECRET` | مفتاح الجلسات. لو فاضي بيتولّد ويتحفظ في `db/.jwt-secret` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | حساب المشرف في أول تشغيل بس (قاعدة بيانات فاضية) |
| `TRUST_PROXY` | `1` لو السيرفر ورا بروكسي بيضيف `x-forwarded-for` (زي Hugging Face) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | إرسال كود تأكيد البريد (مع Gmail: `smtp.gmail.com` و 465 و"كلمة مرور للتطبيقات"). فاضيين = التأكيد مقفول |
| `MAIL_FROM` | اسم وبريد المرسل (اختياري، الافتراضي `رسوخ <SMTP_USER>`) |

