# فِهم | FHM — النسخة المصححة

هذه النسخة تحافظ على تصميم FHM المرفق (الشعار، الألوان، الأقسام) وتصلح أخطاء الربط التي كانت تمنع بعض الوظائف من العمل.

## أهم الإصلاحات
- الحفاظ على `fhm-logo.jpg` واستخدامه فعليًا عند التشغيل عبر Node.
- عرض الموضوع السابع باسم **الحج والعمرة** مع إبقاء اسم قاعدة البيانات الداخلي **الحج**.
- إصلاح اختبار الفهم ليتعامل مع `correct_answer` سواء كان نص الإجابة أو رقم الخيار.
- إصلاح اختبار تحديد المستوى.
- عند اختيار English، تستخدم الأسئلة الحالية العربية من قاعدة البيانات مع ترجمة واجهة/أسئلة الاختبار الموجودة، بينما إجابات الذكاء الاصطناعي تُطلب بالإنجليزية من نفس RAG المعتمد.
- إضافة خدمة ملفات ثابتة حتى يظهر الشعار والملفات بشكل صحيح عند `localhost:3000`.
- لا يوجد `knowledge.json` كمصدر للإجابات؛ الإجابات تمر عبر Supabase Edge Function وpgvector RAG الموجودين في مشروع FHM.

## التشغيل
يتطلب Node.js 18+.

في PowerShell داخل مجلد المشروع:

```powershell
$env:SUPABASE_URL="https://rcfegidbradmhmksroah.supabase.co"
$env:SUPABASE_KEY="ضع_هنا_Publishable_or_Anon_Key"
node server.js
```

ثم افتحي:

`http://localhost:3000`

إذا كانت قراءة جدول `questions` محجوبة عندك، يمكن استخدام `SUPABASE_SERVICE_ROLE_KEY` **على جهازك فقط**، ولا يوضع داخل `index.html` ولا يرفع إلى GitHub.

## المعمارية
Browser → local Node server → Supabase Edge Function `generate-answer` → pgvector RAG → Gemini.

المتصفح ينشئ embedding بحجم 384 باستخدام `Xenova/multilingual-e5-small`، وهو نفس الحجم المستخدم في قاعدة chunks الحالية.
