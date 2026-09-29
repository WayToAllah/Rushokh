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
| PATCH   | `/admin/students/:id/stage`            | نقل الطالب يدويًا: `{ stage_id }`            |
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
  المشرف يقدر ينقل الطالب يدويًا من قائمة الطلاب.
- **المراحل المقفلة** بترجع من غير محتوى، والسيرفر بيرفض أي تقدم أو اختبار في مرحلة مقفولة.
- **تصحيح الاختبارات يتم بالكامل في السيرفر** — لا تُرسل الإجابة الصحيحة للمتصفح
  إطلاقًا عند جلب الأسئلة، فقط عند التسليم يُقارن السيرفر ويحفظ النتيجة.
- **الأمان:** مفتاح الجلسات بيتقرا من `JWT_SECRET` أو بيتولّد عشوائيًا في `db/.jwt-secret`
  (مفيش مفتاح مكتوب في الكود). محاولات الدخول الغلط محدودة، وكلمة المرور 8 أحرف على الأقل،
  والروابط `http/https` بس، وكل نص بيتعرض في الصفحات بيتحوّل لنص آمن قبل العرض.
  المنع والحذف بيسروا فورًا حتى على الجلسات المفتوحة.
- **عرض داخل الموقع:** `public/media.js` بيحوّل روابط يوتيوب (فيديو أو قائمة تشغيل)، وGoogle Drive/Docs،
  وفيميو، وملفات PDF/MP4/MP3 لعرض جوه نافذة في الموقع. أي رابط تاني بيفتح في تبويب جديد.
- **حماية البيانات:** `npm run seed` بيرفض يمسح قاعدة بيانات فيها بيانات (إلا مع `--force` وبعد نسخة
  احتياطية)، والسيرفر بيعمل نسخة احتياطية في `backups/` عند التشغيل وكل 12 ساعة (آخر 30 نسخة).
- **اختبار سريع:** `node scripts/smoke-test.js` والسيرفر شغّال على بيانات التجربة.
- **تقرير المشرف** يلتزم بالوثيقة: يعرض فقط "تم الانتهاء" و"بدأ ولم ينتهِ"، ولا
  يذكر أبدًا ما لم يبدأ الطالب فيه.
- ميزة **رفع ملفات PDF** غير مُنفذة بعد في هذا الباك إند (فقط حقل `file_url` في
  جدول `books` جاهز لاستقبال رابط الملف لاحقًا) — تحتاج مكتبة رفع ملفات (multer)
  ونقطة تخزين (مجلد محلي أو تخزين سحابي) في مرحلة لاحقة.

## النشر على الإنترنت (عشان أي حد من أي جهاز يفتح المنصة)

المشروع دلوقتي **يقدّم الواجهة والـ API من نفس السيرفر** (ملفات `public/index.html`
و `public/student.html`)، فمجرد ما تنشر السيرفر ده، كل حاجة هتشتغل من رابط واحد.
هنستخدم **Render.com** لأنه بسيط ومجاني للبداية.

### الخطوات

1. **ارفع المشروع على GitHub**
   - اعمل حساب على github.com لو معندكش
   - اعمل مستودع (Repository) جديد وارفع مجلد `rasokh-backend` بالكامل عليه
     (لو مش عارف تستخدم git من التيرمينال، GitHub Desktop برنامج بواجهة رسومية
     بيسهّل الموضوع: https://desktop.github.com)

2. **اعمل حساب على Render**
   - روح على https://render.com وسجّل (تقدر تسجل بحساب GitHub مباشرة)

3. **أنشئ Web Service جديد**
   - من لوحة Render: **New +** → **Web Service**
   - اختر المستودع اللي رفعته
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - اختر الخطة **Free** للتجربة

4. **أضف متغير البيئة**
   - في تبويب **Environment**، أضف:
     - `JWT_SECRET` = أي نص عشوائي طويل (سر التوقيع، غيّره عن القيمة الافتراضية)

5. **جهّز قاعدة البيانات أول مرة**
   - بعد أول نشر ناجح، افتح تبويب **Shell** في Render (بجانب صفحة الخدمة)
   - نفّذ فيه: `npm run seed`
   - ده بيعبي قاعدة البيانات ببيانات تجريبية (أو تقدر تضيف مراحل/مشرفين حقيقيين
     بنفسك عبر مسارات `/api/admin/...` بدل الـ seed)

6. **افتح الرابط**
   - Render هيديك رابط زي: `https://rasokh-backend-xxxx.onrender.com`
   - افتحه من أي جهاز وأي مكان — هيفتح `index.html` مباشرة ويشتغل مع نفس الباك إند

### ⚠️ ملاحظة مهمة عن حفظ البيانات (SQLite)

الخطة المجانية على Render **قرصها غير دائم (ephemeral)** — يعني لو السيرفر
أعيد تشغيله (بيحصل تلقائيًا بعد فترة خمول)، ممكن تتصفّر بيانات قاعدة البيانات.
هذا مقبول للتجربة، لكن للاستخدام الحقيقي المستمر تحتاج واحد من اثنين:
- **ترقية لخطة مدفوعة في Render مع Persistent Disk** (قرص دائم تربطه بمسار
  `db/rasokh.db`)، أو
- **الانتقال لاحقًا لقاعدة بيانات مُدارة** (PostgreSQL على Render نفسه مثلاً)
  بدل SQLite — تغيير أكبر يحتاج تعديل طبقة الاتصال بقاعدة البيانات.

للتجربة والعرض على أشخاص من أماكن مختلفة، الخطة المجانية كافية تمامًا.

