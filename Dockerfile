# Dockerfile — لتشغيل منصة رسوخ على Hugging Face Spaces (أو أي استضافة تدعم Docker)
FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Hugging Face بيشغّل الحاوية بمستخدم رقمه 1000 (وهو نفس مستخدم node في الصورة دي)،
# فلازم يكون صاحب المجلد عشان يقدر يكتب ملف قاعدة البيانات
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
ENV PORT=7860
# الطلبات بتعدّي على بروكسي الاستضافة، فحد المحاولات بياخد عنوان الزائر من x-forwarded-for
ENV TRUST_PROXY=1
EXPOSE 7860

# يعبّي قاعدة البيانات لو فاضية، بعدين يشغّل السيرفر.
# حط ADMIN_EMAIL و ADMIN_PASSWORD كـ Secrets، وإلا كلمة مرور المشرف بتطلع عشوائية في الـ Logs.
CMD ["sh", "-c", "node db/ensure-seed.js && node server.js"]
