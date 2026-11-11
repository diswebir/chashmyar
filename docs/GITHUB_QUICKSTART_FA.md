# شروع سریع: فرستادن سورس به GitHub و ساخت خودکار

[بازگشت به README](../README.md) · [راهنمای کامل انتشار و بازیابی](RELEASE_GUIDE_FA.md) · [English: CI and release](CI_AND_RELEASE.md)

این راهنما برای زمانی است که می‌خواهید **GitHub Actions برنامه را بسازد**، نه اینکه روی رایانهٔ خودتان فایل اجرایی بسازید. برای ارسال، Git یا GitHub Desktop کافی است؛ نصب محلی Node.js، Rust، Visual Studio و WebView2 لازم نیست.

> **هشدار انتشار:** در تنظیم فعلی هر push به `main` ساخت و در صورت موفقیت، انتشار خودکار Release را درخواست می‌کند. اگر مخزن Public باشد، Release منتشرشده عمومی است و تأیید انسانی جداگانه ندارد. قبل از push، سورس و تنظیمات را بازبینی کنید. نخستین اجرای واقعی GitHub و عملکرد روی ویندوز را باید خودتان بررسی کنید؛ وجود workflow به معنی موفقیت تضمین‌شده نیست.

## ۱. استخراج کامل بسته

ZIP سورس را در یک مسیر کوتاه، مثلاً `C:\src\chashmyar`، استخراج کنید. PowerShell را **در پوشه‌ای باز کنید که `package.json` در آن قرار دارد**، نه در پوشهٔ بالاتر یا داخل `src-tauri`.

باید این موارد در ریشه باشند:

```text
.github/workflows/ci.yml            بررسی‌های مستقل CI
.github/workflows/release.yml       ساخت و انتشار خودکار ویندوز
assets/branding/                    تصویر تأییدشده و اطلاعات آیکن‌ها
src/ ، src-tauri/src/               سورس برنامه
src-tauri/icons/                    آیکن‌های جدید، از جمله ICO چنداندازه‌ای
src-tauri/vendor/tao/               وابستگی محلی اصلاح‌شده و مجوز آن
package.json ، package-lock.json    تعریف و قفل وابستگی‌های frontend
src-tauri/Cargo.lock                قفل وابستگی‌های Rust
scripts/ ، tests/ ، docs/           ابزارها، آزمون‌ها و مستندات
```

`.github`، `.gitignore` و `.gitattributes` در بعضی فایل‌منیجرها مخفی‌اند؛ **آن‌ها را حذف نکنید**. پوشه‌های `node_modules`، `dist`، `src-tauri/target` و `release` در ZIP سورس لازم نیستند و در `.gitignore` نادیده گرفته می‌شوند. فایل اجرایی جدید داخل این بسته وجود ندارد؛ فایل‌های اجرایی قدیمی ۲.۴.۳ نیز نشان جدید را ندارند.

## ۲. ساخت مخزن خالی و تنظیم Actions

1. در [GitHub: New repository](https://github.com/new) یک مخزن جدید بسازید. برای دانلود عمومی **Public** انتخاب کنید؛ Release مخزن Private فقط برای افراد دارای دسترسی است.
2. چون README و LICENSE در سورس هستند، هنگام ساخت مخزن خالی، گزینهٔ ساخت خودکار README، `.gitignore` و مجوز را انتخاب نکنید.
3. در **Settings → Actions → General** بررسی کنید Actions و actionهای استفاده‌شده مجاز باشند. مرحلهٔ انتشار در workflow صریحاً `contents: write` درخواست می‌کند؛ سیاست مخزن/سازمان و ruleset تگ‌ها نباید ساخت تگ و Release توسط `github-actions[bot]` را منع کنند. نیازی به قرار دادن توکن شخصی یا گواهی در سورس نیست.
4. محدودیت مصرف، دسترسی runner ویندوز و سیاست‌های حساب یا سازمان می‌توانند اجرای Actions را متوقف کنند؛ وضعیت و هزینه‌های احتمالی حساب خود را بررسی کنید.

## ۳. ثبت سورس و push با Git

[Git for Windows](https://git-scm.com/downloads/win) را نصب کنید و در PowerShell ریشهٔ پروژه، در صورت نیاز نام و ایمیل commit خود را تنظیم کنید:

```powershell
git config --global user.name "نام شما"
git config --global user.email "ایمیل شما"
git init -b main
git add .
git status --short
```

برای اطمینان از ثبت پوشهٔ مخفی، قفل‌ها و وابستگی محلی، دستور زیر باید مسیرهای نام‌برده را نمایش دهد:

```powershell
git ls-files -- .github/workflows/ci.yml .github/workflows/release.yml package-lock.json src-tauri/Cargo.lock src-tauri/vendor/tao/CHASHMYAR_PATCH.md src-tauri/icons/icon.ico
```

اگر مسیری نمایش داده نشد، قبل از ادامه ZIP و مسیر استخراج را بررسی کنید. در `git status` نباید توکن، گواهی، اطلاعات شخصی، `node_modules`، `dist`، `target` یا `release` ثبت شده باشند. سپس `OWNER` و `REPOSITORY` را با مشخصات واقعی مخزن خود جایگزین کنید:

```powershell
git commit -m "Prepare ChashmYar source"
git remote add origin https://github.com/OWNER/REPOSITORY.git
git push -u origin main
```

برای ورود از Git Credential Manager یا GitHub Desktop استفاده کنید؛ رمز و توکن را در URL، فایل یا workflow ننویسید. اگر از توکن شخصی برای انتقال فایل workflow استفاده می‌کنید، GitHub ممکن است مجوز مربوط به workflow را نیز بخواهد.

**روش GitHub Desktop:** مخزن خالی را clone کنید، همهٔ محتویات سورس استخراج‌شده ــ از جمله موارد مخفی ــ را داخل آن کپی کنید، تغییرات را بازبینی و commit کنید، سپس branch `main` را push کنید. اگر مخزن از قبل تاریخچه دارد نیز ابتدا آن را clone و تغییرات را با تاریخچهٔ موجود ادغام کنید؛ این راهنما دستور force-push نمی‌دهد.

## ۴. نتیجه را در GitHub ببینید

1. وارد **Actions → Automatic Windows release** شوید و اجرای مربوط به commit خود را باز کنید.
2. سه job را بررسی کنید: تخصیص نسخه، ساخت و آزمون ویندوز x64، و انتشار. گردش جداگانهٔ **CI** نیز اجرا می‌شود، اما گردش انتشار به نتیجهٔ آن گردش جداگانه وابسته نیست؛ کنترل‌های خودش را اجرا می‌کند.
3. پس از موفقیت، صفحهٔ **Releases** را باز کنید. انتظار می‌رود پنج دارایی وجود داشته باشند: نصب‌کننده، پرتابل، `SHA256SUMS.txt`، `LICENSE` و `THIRD_PARTY_NOTICES.txt`. GitHub دو آرشیو Source code را جداگانه نمایش می‌دهد.
4. برای نسخهٔ نمونهٔ ۲.۴.۴ پس از دانلود، هش‌ها را با فایل همان Release مقایسه کنید:

```powershell
Get-FileHash .\ChashmYar_2.4.4_x64-setup.exe -Algorithm SHA256
Get-FileHash .\ChashmYar-2.4.4-portable.exe -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

شماره را با نسخهٔ واقعی جایگزین کنید. این مقایسه امضای ناشر نیست؛ خروجی پیش‌فرض بی‌امضا است و ممکن است SmartScreen هشدار دهد. نصب‌کننده و نسخهٔ پرتابل به WebView2 نیاز دارند. روی ویندوز واقعی طبق [چک‌لیست انتشار](RELEASE_GUIDE_FA.md) آزمایش کنید؛ ساخت runner به‌تنهایی عملکرد نصب، فوکوس، صدا و گاما را ثابت نمی‌کند.

## ۵. شمارهٔ نسخه و دفعات بعد

نسخهٔ پایهٔ این سورس `2.4.3` است. اگر تگ پایدار بالاتری وجود نداشته باشد، اولین push موفق معمولاً `v2.4.4` و push موفق بعدی معمولاً `v2.4.5` می‌سازد. `main` همچنان نسخهٔ پایه را نشان می‌دهد؛ سورسِ تگ و اجرایی‌ها با نسخهٔ تخصیص‌یافته هماهنگ می‌شوند. برای انتشار عادی تگ دستی نسازید و Patch را دستی بالا نبرید.

برای تغییر بعدی، تغییرات را ابتدا آزمایش و بازبینی کنید، سپس:

```powershell
git checkout main
git pull --ff-only origin main
git add .
git status --short
git commit -m "Describe the change"
git push origin main
```

تگ ناسازگار، خطای build، شکست تست، مجوز ناکافی، محدودیت صف یا اجرای قدیمی می‌توانند مانع انتشار شوند؛ هر push لزوماً به Release تبدیل نمی‌شود. برای دلایل، اجرای مجدد، Draft یا تگ باقی‌مانده و کار با artifact اصلی، [راهنمای کامل انتشار](RELEASE_GUIDE_FA.md) را ببینید. Draft ناتمام را بدون بررسی دستی Publish نکنید و دارایی نسخهٔ منتشرشده را بی‌صدا جایگزین نکنید.
