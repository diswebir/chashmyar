/* ============================================================================
 * Bilingual (fa / en) runtime.
 *
 * Design notes
 * ------------
 * • The Persian UI is the source of truth; `t("متن فارسی")` looks the string up
 *   in the generated dictionary and returns its English twin when the active
 *   language is `en`. A missing entry falls back to Persian, never to a key.
 * • `t` also understands `{placeholders}` so a single string can carry numbers
 *   that are formatted with the right digits (Persian ۰-۹ or Latin 0-9).
 * • Direction (`dir`) and digits are derived from the language, so every window
 *   flips correctly without hard-coding `dir="rtl"` in each component.
 * ==========================================================================*/

import { useCallback } from "react";
import { DICT_EN, DICT_FA } from "./dict";
import { digitsForLocale, setLocale } from "./persian";
import { useAppStore } from "../store/useAppStore";

export type Lang = "fa" | "en";
export type Theme = "dark" | "light";

/** Strings added in v2.1 that do not appear in the generated dictionary. */
const EXTRA: Record<string, string> = {
  // v2.3: clear alerts, accessible actions and evidence-based activity labels.
  "{n}٪": "{n}%",
  "بدون داده کافی": "Not enough data",
  "امروز: {done} از {total} مورد ثبت‌شده": "Today: {done} of {total} recorded outcomes",
  "امتیاز هفت روز: {score}": "Seven-day score: {score}",
  "نمودار هفت‌روزه زمان تایمر کاری و پایبندی به مراقبت چشم": "Seven-day chart of work-timer time and eye-care adherence",
  "زمان تایمر کاری": "Work-timer time",
  "پایبندی به مراقبت چشم": "Eye-care adherence",
  "گزارش فعالیت و مراقبت": "Activity and care report",
  "نمایی از رویدادهای ثبت‌شده در هفت روز گذشته": "Recorded timer events over the past seven days",
  "زمان تایمر کاری امروز": "Work-timer time today",
  "مجموع هفت روز: {v}": "Seven-day total: {v}",
  "تمرین کوتاه: {a} · استراحت طبیعی: {b}": "Short exercises: {a} · Natural breaks: {b}",
  "هفت روز: {a} · جریمه قفل: {b}": "Seven days: {a} · Lock penalties: {b}",
  "نظم زمان‌بندی کار": "Work-timer regularity",
  "نسبت تایمرهای استراحت کامل و تمرین کوتاه که تا انتها رسیدند به همه موارد پایان‌یافته یا زود بسته‌شده.": "The share of full-break and short-exercise timers that reached the end, among all completed or closed early.",
  "نسبت نوبت‌های کاری که بدون تعویق به پایان رسیدند به کل نوبت‌های پایان‌یافته، تعویق‌شده یا زود متوقف‌شده.": "The share of work sessions completed without snoozing among sessions completed on time, delayed or ended early.",
  "این امتیازها فقط بر اساس رویدادهای تایمر هستند؛ سلامت پزشکی چشم، انجام واقعی تمرین یا کیفیت کار را تشخیص نمی‌دهند. موارد در حال اجرا و پیش‌نمایش تمرین در امتیاز حساب نمی‌شوند. سوابق قدیمی بدون نتیجهٔ کافی همچنان در آمار حفظ می‌شوند اما وارد امتیاز نمی‌شوند.": "These scores reflect timer events only; they do not diagnose eye health, verify exercise or assess work quality. Ongoing timers and exercise previews are excluded. Older records without sufficient outcome data remain in the totals but are excluded from the scores.",
  "ستون سبز: زمان تایمر کاری · نارنجی: تعویق · خط آبی: پایبندی به مراقبت چشم": "Green bars: work-timer time · orange: snoozes · blue line: eye-care adherence",
  "امتیازهای روزانه": "Daily scores",
  "مراقبت چشم / نظم زمان‌بندی کار": "Eye-care adherence / work-timer regularity",
  "امتیاز هفتگی از مجموع تعداد رویدادها محاسبه می‌شود، نه میانگین روزهای بدون داده.": "Weekly scores use aggregate event counts; days without data are not averaged in.",
  "بستن اعلان": "Close alert",
  "برای افزودن زمان انتخاب کنید": "Choose an amount to add",
  "افزودن {n} دقیقه": "Add {n} minutes",
  "تمرین کوتاه در حین کار": "Short exercise during work",
  "فعال‌سازی تمرین کوتاه در حین کار": "Enable the short exercise during work",
  "تمرین کوتاه در حال اجرا": "Short exercise in progress",
  "مدت تمرین کوتاه": "Short exercise duration",
  "بستن تمرین کوتاه": "Close short exercise",
  "اگر استراحت کامل نزدیک‌تر از این مقدار باشد، تمرین کوتاه اجرا نمی‌شود": "The short exercise is skipped when a full break is closer than this",
  "چشم‌یار دمای رنگ نمایشگر را تنظیم می‌کند و با زمان‌بندی کار، تمرین کوتاه در حین کار و حرکت‌های کششی به مراقبت از چشم و بدن کمک می‌کند.": "ChashmYar adjusts display colour temperature and supports eye and body care with focused work, a short exercise during work and gentle stretches.",
  // v2.2: redesigned break room, animated movements and revised copy.
  "مکثی برای حال بهتر": "A moment to recharge",
  "پیش‌نمایش": "Preview",
  "قفل سخت‌گیرانه فعال": "Strict lock active",
  "زمان استراحت": "Break timer",
  "فرصتی برای تازه شدن": "Time to recharge",
  "نکته‌های مراقبتی": "Care tips",
  "هر بار، یک یادآوری کوچک": "A little reminder for your day",
  "انتخاب نکته": "Choose a tip",
  "حرکت‌های ساده برای یک استراحت بهتر": "Gentle movements for a better break",
  "لطفاً از پشت میز بلند شوید": "Please stand up from your desk",
  "برای انجام تمرین‌ها بایستید و حرکت‌ها را آرام و کنترل‌شده انجام دهید.": "Stand up to exercise and move slowly and with control.",
  "راهنمای تصویری حرکت": "Animated movement guide",
  "تمرین چشم": "Eye exercise",
  "تمرین بدن": "Body exercise",
  "چگونه انجام دهیم؟": "How to do it",
  "تمرین‌ها خاموش هستند — فقط نفس بکشید و استراحت کنید": "Exercises are off — take a breath and relax",
  "قبلی": "Previous",
  "انتخاب تمرین": "Choose an exercise",
  "حرکت‌ها را بدون درد انجام دهید؛ اگر ایستادن برایتان ممکن نیست، آن‌ها را نشسته انجام دهید.": "Move within a pain-free range. If you cannot stand, do the movements while seated.",
  "به بدن خود فرصت حرکت و استراحت بدهید": "Give yourself time to move and rest",
  "هر ۲۰ دقیقه، ۲۰ ثانیه به جسمی در فاصله حدود ۶ متری نگاه کنید.": "Every 20 minutes, look at something about 6 metres away for 20 seconds.",
  "پلک زدن طبیعی به مرطوب ماندن سطح چشم کمک می‌کند.": "Blinking naturally helps keep the surface of your eyes moist.",
  "روشنایی صفحه را با نور محیط هماهنگ کنید و بازتاب‌های مزاحم را کاهش دهید.": "Match screen brightness to your surroundings and reduce distracting glare.",
  "در طول روز گاهی از جای خود بلند شوید و چند قدم آرام بردارید.": "Stand up from time to time and take a few gentle steps.",
  "بالای نمایشگر را نزدیک به سطح چشم و صفحه را در فاصله راحت قرار دهید.": "Keep the top of your display near eye level and the screen at a comfortable distance.",
  "هنگام کار، شانه‌ها را رها نگه دارید و هر چند وقت یک‌بار وضعیت بدن را تغییر دهید.": "Keep your shoulders relaxed and change your posture from time to time.",
  "پس از هر حرکت، چند نفس آرام بکشید و به بدن خود فرصت استراحت بدهید.": "After each movement, take a few slow breaths and give yourself time to rest.",
  "نگاه آرام به چپ و راست": "Gentle left and right gaze",
  "حدود ۲۰ ثانیه": "About 20 seconds",
  "سر ثابت؛ حرکت آرام چشم‌ها": "Keep your head still; move your eyes gently",
  "سرتان را ثابت نگه دارید و روبه‌رو نگاه کنید.": "Keep your head still and look straight ahead.",
  "فقط با چشم‌ها، نقطه را به‌آرامی به چپ و راست دنبال کنید.": "Using only your eyes, follow the dot gently left and right.",
  "چند بار پلک بزنید و به چشم‌ها فشار نیاورید.": "Blink a few times and avoid straining your eyes.",
  "نگاه آرام به بالا و پایین": "Gentle up and down gaze",
  "بدون حرکت دادن سر": "Keep your head still",
  "سر و گردن را در حالت راحت و ثابت نگه دارید.": "Keep your head and neck still and comfortable.",
  "فقط با چشم‌ها، نقطه را آرام به بالا و پایین دنبال کنید.": "Using only your eyes, follow the dot gently up and down.",
  "در دامنه راحت حرکت کنید و چند بار پلک بزنید.": "Stay within a comfortable range and blink a few times.",
  "دنبال کردن مسیر هشت": "Follow the figure eight",
  "نقطه را آرام دنبال کنید": "Follow the dot gently",
  "سرتان را ثابت نگه دارید و شانه‌ها را رها کنید.": "Keep your head still and relax your shoulders.",
  "با چشم‌ها، نقطه را در مسیر هشت دنبال کنید.": "Follow the dot along the figure-eight path with your eyes.",
  "اگر احساس خستگی یا ناراحتی دارید، حرکت را متوقف کنید.": "Stop if you feel tired or uncomfortable.",
  "نگاه به دوردست": "Look into the distance",
  "۲۰ ثانیه": "20 seconds",
  "به بیرون صفحه نگاه کنید، نه به تصویر": "Look away from the screen, not at the picture",
  "نگاهتان را از صفحه نمایش بردارید.": "Look away from the screen.",
  "به جسمی در فاصله حدود ۶ متری نگاه کنید.": "Look at something about 6 metres away.",
  "۲۰ ثانیه به دوردست نگاه کنید و به‌طور طبیعی پلک بزنید.": "Look into the distance for 20 seconds and blink naturally.",
  "کشش آرام گردن": "Gentle neck stretch",
  "۳ بار برای هر سمت": "3 times on each side",
  "شانه‌ها پایین و رها": "Keep your shoulders down and relaxed",
  "صاف بایستید و شانه‌ها را پایین و رها نگه دارید.": "Stand tall and keep your shoulders down and relaxed.",
  "سر را آرام به سمت یک شانه خم کنید؛ شانه را بالا نبرید.": "Gently tilt your head toward one shoulder without raising the shoulder.",
  "۵ ثانیه مکث کنید، به مرکز برگردید و سمت دیگر را تکرار کنید.": "Hold for 5 seconds, return to centre and repeat on the other side.",
  "حرکت آرام مچ دست": "Gentle wrist movement",
  "۵ بار برای هر دست": "5 times with each hand",
  "حرکت از مفصل مچ، بدون فشار": "Move from the wrist without forcing it",
  "در حالت ایستاده، یک دست را با آرنج راحت مقابل خود نگه دارید.": "While standing, hold one arm in front of you with the elbow relaxed.",
  "مچ دست را به‌آرامی بالا و پایین ببرید؛ انگشتان را رها نگه دارید.": "Gently move your wrist up and down, keeping your fingers relaxed.",
  "چند بار تکرار کنید، سپس همین حرکت را با دست دیگر انجام دهید.": "Repeat a few times, then do the same with the other hand.",
  "بالا و پایین بردن شانه‌ها": "Raise and lower the shoulders",
  "۵ بار": "5 times",
  "آرام بالا، آرام پایین": "Gently up, gently down",
  "صاف بایستید و دست‌ها را کنار بدن رها کنید.": "Stand tall with your arms relaxed by your sides.",
  "شانه‌ها را به‌آرامی به سمت گوش‌ها ببرید و ۳ ثانیه نگه دارید.": "Gently raise your shoulders toward your ears and hold for 3 seconds.",
  "شانه‌ها را آرام پایین بیاورید و حرکت را تکرار کنید.": "Slowly lower your shoulders and repeat.",
  "کشش پهلو در حالت ایستاده": "Standing side stretch",
  "حرکت کوتاه و کنترل‌شده": "Keep the movement small and controlled",
  "صاف بایستید و پاها را به‌اندازه عرض لگن باز کنید.": "Stand tall with your feet about hip-width apart.",
  "یک دست را آرام در امتداد ران پایین ببرید و به همان سمت خم شوید.": "Slide one hand gently down your thigh and lean to that side.",
  "پس از ۲ ثانیه به مرکز برگردید و سمت دیگر را تکرار کنید.": "After 2 seconds, return to centre and repeat on the other side.",
  "تمرین‌های بدن": "Body exercises",
  "کشیدن با ماوس یا استفاده از دکمه‌های − و +": "Drag with the mouse or use the − and + buttons",
  "{m} تا پایان این مرحله کاری باقی مانده است. کار خود را ذخیره کنید.": "{m} left in this work session. Save your work.",
  "زمان‌های پومودورو — با ماوس بکشید": "Pomodoro timings — drag with the mouse to adjust",
  "مدت مکث ماوس روی نوار بالا پیش از باز شدن ویجت": "How long to hover over the top strip before the widget opens",
  "تایمر متوقف شد؛ می‌توانید از همان‌جا ادامه دهید.": "Timer paused; you can resume where you left off.",
  "سه عادت کوچک برای مراقبت از چشم‌ها": "Three small habits to help care for your eyes",
  "بدون حرکت دادن سر، فقط با چشم‌ها دنبال کنید": "Follow using only your eyes, without moving your head",
  "نفس آرام بکشید و شانه‌ها را رها کنید": "Breathe slowly and relax your shoulders",
  "به یک نقطه دور نگاه کنید": "Look at a distant point",
  "هرچه کلوین کمتر باشد، رنگ نور گرم‌تر است": "Lower Kelvin values make the light warmer",
  "چرخه {a} از {b} — {c} جلسه کامل‌شده در این اجرا": "Cycle {a} of {b} — {c} work sessions completed this run",
  "جلسه‌های این اجرا": "Sessions this run",
  "سقف تعویق در هسته برنامه بررسی و اعمال می‌شود": "The snooze limit is enforced by the timer engine",
  "حرکت آرام چشم‌ها و نگاه به دوردست": "Gentle eye movement and looking into the distance",
  "تمرین‌های ایستاده بدن": "Standing body movements",
  "حرکت‌های ملایم گردن، مچ، شانه و پهلو": "Gentle movements for the neck, wrists, shoulders and sides",
  "فاصله نمایش تمرین بعدی": "Time between exercises",
  "نوار باریک چسبیده به لبه بالا یا کپسول شناور قابل جابه‌جایی": "A slim top-edge strip or movable floating capsule",
  "کپسول شناور که می‌توانید آن را در صفحه جابه‌جا کنید": "A floating capsule that you can move around the screen",
  // Complete translations for v2.1 screens, live values and analytics.
  "استراحت کامل / کوتاه": "Full / micro breaks",
  "جریمه قفل": "Lock penalty",
  "کار عمیق (ساعت)": "Deep work (hours)",
  "تعداد تعویق": "Snoozes",
  "نمره سلامت چشم": "Eye-care score",
  "هفت روز گذشته — کار عمیق، تعویق‌ها، جریمه‌ها و نمره سلامت چشم": "Last seven days — deep work, snoozes, penalties and eye-care score",
  "۶ متر (یا ۲۰ فوت) دورتر را نگاه کن — ۲۰ ثانیه": "Look 6 metres (20 feet) away for 20 seconds",
  "هر ۲۰ دقیقه، ۲۰ ثانیه به فاصله ۶ متری نگاه کن؛ عضلات مژگانی چشم آزاد می‌شوند.": "Every 20 minutes, look about 6 metres away for 20 seconds to give your eyes a break.",
  "پلک زدن آگاهانه می‌تواند به کاهش خشکی چشم کمک کند — ۱۰ پلک کامل و آرام.": "Conscious blinking can help with dry eyes — try 10 slow, complete blinks.",
  "روشنایی صفحه باید هم‌سطح روشنایی اتاق باشد؛ کنتراست زیاد، خستگی می‌آورد.": "Match your screen brightness to your room; excessive contrast can be tiring.",
  "هر ساعت یک‌بار از جا بلند شو؛ نشستن طولانی گردن و کمر را تحت فشار می‌گذارد.": "Stand up once an hour; prolonged sitting can strain your neck and back.",
  "قانون ۲۰-۲۰-۲۰ ساده‌ترین ابزار پیشگیری از سندرم بینایی رایانه است.": "The 20-20-20 rule is an easy way to give your eyes regular breaks.",
  "مانیتور را هم‌تراز چشم بگیر و ۵۰ تا ۷۰ سانتی‌متر فاصله بده.": "Keep your monitor at eye level and 50 to 70 centimetres away.",
  "بعد از هر تمرین، چند نفس عمیق و آرام بکش تا آرام‌تر شوی.": "After each exercise, take a few slow, deep breaths to relax.",
  "تلاش برای خروج از صفحه استراحت شناسایی شد!": "An attempt to leave the break screen was detected!",
  "{s} ثانیه جریمه به زمان استراحت اضافه شد — مجموع جریمه‌ها: {n} بار": "{s} seconds added to the break — total penalties: {n}",
  "بستن": "Close",
  "مرحله {a} از {b} — {c} مرحله کاری کامل شده": "Stage {a} of {b} — {c} work sessions completed",
  "صفحه تا پایان استراحت قفل است": "Screen locked until the end of the break",
  "{n} جریمه": "{n} penalties",
  "تا پایان استراحت": "until the break ends",
  "طول استراحت": "Break length",
  "تعویق استفاده‌شده": "Snoozes used",
  "{a} از {b}": "{a} of {b}",
  "تمرین‌ها خاموش هستند — فقط نفس بکش و استراحت کن": "Exercises are off — just breathe and relax",
  "حرکت {n}": "Exercise {n}",
  "نکته {n}": "Tip {n}",
  "خروج اضطراری:": "Emergency exit:",
  "{n} ثانیه": "{n} seconds",
  "نگه دار تا باز شود": "Hold to unlock",
  "قفل اضطراری باز شد — به کار خود بازگرد": "Emergency unlock complete — return to work",
  "پایان زودهنگام استراحت": "End the break early",
  "بازگرداندن ویجت به لبه بالای صفحه": "Return the widget to the top edge",
  "مرحله {a} از {b}": "Stage {a} of {b}",
  "۲۰-۲۰-۲۰ فعال": "20-20-20 active",
  "به مدت {n} ثانیه به فاصله ۶ متری نگاه کنید و ۱۰ بار کامل پلک بزنید.": "Look 6 metres away for {n} seconds and blink fully 10 times.",
  "سازنده و نسخه": "Creator and version",
  "چشم‌یار": "ChashmYar",
  "نگهبان چشم و تمرکز شما — نسخه {v}": "Your eye-care and focus companion — version {v}",
  "محافظ خاموش": "Eye care off",
  "روشنایی": "Brightness",
  "رنگ‌ایمن:": "Colour-safe:",
  "توقف خودکار (غیبت {n} دقیقه)": "Auto-paused (away {n} min)",
  "مرحله بعدی": "Next stage",
  "استراحت {m} دقیقه‌ای در {left}": "A {m}-minute break in {left}",
  "ساعت سیستم": "System time",
  "منبع دما": "Temperature source",
  "چرخه {a} از {b} — {c} جلسه کامل‌شده امروز": "Cycle {a} of {b} — {c} work sessions completed",
  "{n} جلسه": "{n} sessions",
  "سه عادت کوچک که چشم‌هایت را سالم نگه می‌دارد": "Three small habits for taking care of your eyes",
  "وضعیت موتور رنگ:": "Colour engine:",
  "— لایه گرمای نرم‌افزاری فعال شد.": " — software warm-colour overlay is active.",
  "شروع شب": "Night starts",
  "پایان شب": "Night ends",
  "پیش‌فرض": "Defaults",
  "لیست خالی است — همه برنامه‌ها فیلتر می‌شوند.": "The list is empty — the filter applies to all apps.",
  "وضعیت لحظه‌ای:": "Current status:",
  "فیلتر موقتاً کنار رفته — {app}": "Filter temporarily suspended — {app}",
  "فیلتر فعال روی کل سیستم": "Filter active system-wide",
  "دما در LUT:": "LUT temperature:",
  "(در حال گذار به {k}K)": "(transitioning to {k}K)",
  "مقادیر دکمه‌های تعویق (دقیقه)": "Snooze button values (minutes)",
  "دکمه {i}": "Button {i}",
  "غیبت فعلی:": "Current idle time:",
  "— تایمر متوقف است و با اولین حرکت ماوس ادامه می‌یابد": "— paused; resumes when you return",
  "نمایش آزمایشی": "Show preview",
  "فاصله تکرار": "Repeat interval",
  "خروج اضطراری (Ctrl + Shift)": "Emergency exit (Ctrl + Shift)",
  "اگر پنجره قفل مینیمایز شود یا فوکوس از دست برود، زمان استراحت افزایش می‌یابد": "Adds time if the lock window is minimised or loses focus",
  "Ctrl+Alt+Del قابل بلاک نیست، پس جریمه اعمال می‌شود": "Ctrl+Alt+Del cannot be blocked, so a penalty can be applied",
  "جریمه‌های این استراحت:": "Penalties in this break:",
  "ثبت در HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run": "Registered in HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
  "چسبیده به لبه بالا": "Docked to the top edge",
  "نمایش هشدار ۳۰ ثانیه‌ای": "Preview the pre-break alert",
  "پیش‌نمایش صفحه قفل": "Preview the break screen",
  "بازگرداندن گاما به ۶۵۰۰K": "Restore gamma to 6500K",
  "خروج امن از چشم‌یار": "Quit ChashmYar safely",
  "اگر برنامه رفتار غیرمنتظره داشت، فایل": "If the app behaves unexpectedly, send",
  "را بفرستید. برای تست سلامت سیستم‌عامل (گاما، قلاب کیبورد، WebView2) فایل اجرایی را با": ". To test system compatibility (gamma, keyboard hook and WebView2), run the executable with",
  "اجرا کنید.": ".",
  "درباره چشم‌یار": "About ChashmYar",
  "چشم‌یار دمای رنگ نمایشگر را با Gamma Ramp سخت‌افزاری تنظیم می‌کند، روشنایی را نرم‌تر کم می‌کند و با پومودوروی سخت‌گیرانه، استراحت‌های ۲۰-۲۰-۲۰ و تمرین‌های کششی از چشم و بدن شما محافظت می‌کند.": "ChashmYar adjusts display colour temperature using hardware gamma, dims the screen, and encourages healthier routines with focused work, 20-20-20 breaks and desk stretches.",
  "به‌زودی استراحت شروع می‌شود": "Your break starts soon",
  "سقف تعویق مجاز ({n} بار) پر شده است. استراحت در {left} دیگر آغاز می‌شود.": "The snooze limit ({n}) has been reached. Your break begins in {left}.",
  "تعویق‌های باقی‌مانده:": "Snoozes remaining:",
  "از {n}": "of {n}",
  "زمان اضافه کن": "Add time",
  "بستن این پیام": "Dismiss this message",
  "زنجیره {n} روزه": "{n}-day streak",
  "بهترین روز: {day}": "Best day: {day}",
  "از ۱۰۰ — {label}": "out of 100 — {label}",
  "میانگین هفته: {n}": "Weekly average: {n}",
  "مجموع هفته: {v}": "Weekly total: {v}",
  "{n} استراحت": "{n} breaks",
  "کوتاه ۲۰-۲۰-۲۰: {a} · طبیعی: {b}": "20-20-20: {a} · natural: {b}",
  "{n} بار": "{n} times",
  "هفته: {a} · جریمه قفل: {b}": "This week: {a} · lock penalties: {b}",
  "{h} ساعت و {m} دقیقه": "{h} hr {m} min",
  "{h} ساعت": "{h} hr",
  "{m} دقیقه": "{m} min",
  "فرمول نمره: شروع از ۱۰۰ — هر تعویق ۳−، هر خروج اضطراری ۱۰−، هر جریمه قفل ۵−؛ هر استراحت کامل ۲+، هر استراحت کوتاه ۱+ و هر استراحت طبیعی ۱+.": "Score starts at 100: −3 per snooze, −10 per emergency exit, −5 per penalty; +2 per completed break, +1 per micro break and +1 per natural break (bonuses and score are capped).",
  "شنبه": "Saturday",
  "یکشنبه": "Sunday",
  "دوشنبه": "Monday",
  "سه‌شنبه": "Tuesday",
  "چهارشنبه": "Wednesday",
  "پنجشنبه": "Thursday",
  "جمعه": "Friday",
  "شروع شمارش استراحت": "Start break countdown",
  "ادامه شمارش استراحت": "Resume break countdown",
  "بستن پیش‌نمایش": "Close preview",
  "پیش‌نمایش صفحه استراحت": "Break screen preview",
  "نگه داشتن کلیدها برای مدت تعیین‌شده، مستقل از زبان صفحه‌کلید": "Hold the keys for the configured duration, regardless of keyboard layout",
  "ساعت را به شکل ساعت:دقیقه وارد کنید": "Enter time as hours:minutes",
  "بازگرداندن گاما و خاموش کردن فیلتر": "Restore gamma and turn off the filter",
  "تم روشن": "Light theme",
  "تم تاریک": "Dark theme",
  "ظاهر برنامه": "Appearance",
  "روشن و تمیز برای محیط‌های پرنور": "Bright and clean for well-lit rooms",
  "تیره و ملایم برای شب و کار طولانی": "Dark and calm for night work",
  "زبان": "Language",
  "فارسی": "Persian",
  "انگلیسی": "English",
  "تغییر زبان کل برنامه": "Change the language of the whole app",
  "سازنده": "Creator",
  "رضا جنترانی": "Reza Jantrani",
  "ساخته شده با قلب برای چشمان شما": "Made with love for your eyes",
  "وب‌سایت سازنده": "Creator website",
  "شروع استراحت": "Start break",
  "شروع استراحت همین حالا": "Start a break right now",
  "همین حالا استراحت کن": "Take a break now",
  "استراحت فوری": "Instant break",
  "تأخیر باز شدن ویجت": "Widget open delay",
  "میلی‌ثانیه": "ms",
  "برای تغییر مقدار بکشید": "Drag to change the value",
  "ورزش بعدی": "Next exercise",
  "ورزش قبلی": "Previous exercise",
  "نکته": "Tip",
  "نکته‌های امروز": "Today's tips",
  "تمرین": "Exercise",
  "از": "of",
  "تمرین‌های چشم و بدن": "Eye and body drills",
  "بدون حرکت دادن سر، فقط با چشم‌ها دنبال کن": "Follow with your eyes only — keep your head still",
  "نفس عمیق بکش و شانه‌ها را رها کن": "Take a deep breath and drop your shoulders",
  "۳۰ ثانیه به یک نقطه دور نگاه کن": "Look at a distant point for 30 seconds",
  "تایمر متوقف شد — از همان‌جا ادامه بده": "Timer paused — resume from exactly where you stopped",
  "ادامه بده": "Continue",
  "استراحت کوتاه فعال": "Micro break running",
  "ثانیه مانده": "seconds left",
  "پایان": "Finish",
  "برو به داشبورد": "Go to the dashboard",
  "داشبورد باز شد": "Dashboard opened",
  "پنجره اصلی": "Main window",
  "حرکت بعدی": "Next move",
  "حرکت قبلی": "Previous move",
  "شروع تمرین": "Start drill",
  "آماده‌ای؟": "Ready?",
  "چشم‌ها را ببند": "Close your eyes",
  "چند لحظه به خودت استراحت بده": "Give yourself a moment to rest",
  "دقیقه دیگر": "min to go",
  "وقت استراحت": "Break time",
  "قفل صفحه فعال است": "Screen lock is active",
  "کلیدهای Alt+Tab و کلید ویندوز در طول استراحت غیرفعال هستند":
    "Alt+Tab and the Windows key are disabled during the break",
  "هنوز استراحت لازم نیست": "No break needed yet",
  "ویجت به حالت چسبیده برگشت": "Widget snapped back to the top edge",
  "ویجت جدا شد — هر جا بخواهی بکشش": "Widget detached — drag it wherever you like",
  "موقعیت ویجت ذخیره شد": "Widget position saved",
  "نمی‌توانم این کار را انجام دهم": "That action is unavailable",
  "تنظیمات": "Settings",
  "ویجت شناور": "Floating widget",
  "چسبیده به بالا": "Docked to the top",
  "امروز": "Today",
  "این هفته": "This week",
  "میانگین نمره": "Average score",
  "بهترین روز": "Best day",
  "روز پیوسته": "day streak",
  "ثبت نشده": "not recorded",
  "استراحت‌های کوتاه": "Micro breaks",
  "استراحت‌های طبیعی": "Natural breaks",
  "ساعت کار عمیق": "deep-work hours",
  "دقیقه کار عمیق": "minutes of deep work",
  "هفته": "week",
  "روز": "Daylight",
  "دقیقه": "min",
  "ثانیه": "s",
  "ساعت": "hour",
  "بار": "times",
  "نمره": "score",
  "خوب": "Good",
  "بهتر": "Better",
  "عالی‌ترین": "Best",
  "ممنون که به چشمانت اهمیت می‌دهی": "Thank you for caring about your eyes",
  "خروج از برنامه": "Quit the app",
  "درباره": "About",
  "نسخه": "Version",
  "پوشه لاگ و گزارش خطا": "Log folder & error report",
  "آزمون سلامت (self-test)": "Health self-test",
  "گزارش راه‌اندازی در این فایل ذخیره می‌شود": "The startup report is written to this file",
  "برای بررسی سلامت سیستم روی همین دستگاه": "To health-check this machine, run",
  "روشن": "Light",
  "تاریک": "Dark",
};

const MAP = new Map<string, string>();
DICT_FA.forEach((fa, i) => {
  const en = DICT_EN[i];
  if (en) MAP.set(fa, en);
});
Object.entries(EXTRA).forEach(([fa, en]) => MAP.set(fa, en));

let activeLang: Lang = "fa";

export function getLang(): Lang {
  return activeLang;
}

export function setLang(lang: Lang) {
  if (lang === activeLang) return;
  activeLang = lang;
  setLocale(lang);
}

/** Numbers inside translated strings follow the active language's digits. */
function formatVars(vars?: Record<string, string | number>, lang: Lang = activeLang): Record<string, string> {
  const out: Record<string, string> = {};
  if (!vars) return out;
  for (const [k, v] of Object.entries(vars)) {
    out[k] = typeof v === "number" ? digitsForLocale(v, lang) : v;
  }
  return out;
}

export function fill(template: string, vars?: Record<string, string | number>, lang: Lang = activeLang): string {
  if (!vars) return template;
  const values = formatVars(vars, lang);
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? values[key] : match,
  );
}

/** Translate a Persian string; `vars` are injected into `{placeholders}`. */
export function tr(lang: Lang, fa: string, vars?: Record<string, string | number>): string {
  const text = lang === "en" ? (MAP.get(fa) ?? fa) : fa;
  return digitsForLocale(fill(text, vars, lang), lang);
}

/** Bare translator for code that already knows the language (no React). */
export function translate(fa: string, vars?: Record<string, string | number>): string {
  return tr(activeLang, fa, vars);
}

/**
 * Shorthand used by every component: `t("محافظ چشم")`.
 *
 * The active language lives in module scope (kept in sync with the Rust
 * settings snapshot) and windows are re-mounted when it changes, so a plain
 * function is enough — no hook plumbing in a hundred call sites.
 */
export const t = translate;

/**
 * React hook: `const t = useT()` then `t("محافظ چشم")` or
 * `t("مرحله {a} از {b}", { a: 2, b: 4 })`.
 */
export function useT() {
  const lang = (useAppStore((s) => s.snapshot.settings.system.language) ?? "fa") as Lang;
  if (lang !== activeLang) setLang(lang);
  return useCallback(
    (fa: string, vars?: Record<string, string | number>) => tr(lang, fa, vars),
    [lang],
  );
}

export function isRtl(lang: Lang): boolean {
  return lang !== "en";
}

export function dirOf(lang: Lang): "rtl" | "ltr" {
  return isRtl(lang) ? "rtl" : "ltr";
}
