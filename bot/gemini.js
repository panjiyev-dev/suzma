const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-flash-latest';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

async function callGemini(prompt, temperature = 0.7) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY topilmadi');
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature },
    }),
  });
  if (!res.ok) throw new Error('Gemini xatosi: ' + res.status);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini bo\'sh javob qaytardi');
  return JSON.parse(text);
}

const ANALYSIS_PROMPT_HEADER = `Siz til o'rganish ilovasi uchun foydalanuvchi profilini tahlil qiluvchi yordamchisiz.
Quyida foydalanuvchi anketa savollariga bergan javoblari JSON ko'rinishida berilgan.
Shu javoblar asosida quyidagi JSON obyektni qaytaring (FAQAT JSON, boshqa hech narsa yozmang):

{
  "planDays": <30 dan 45 gacha butun son — foydalanuvchining kuniga ajrata oladigan vaqti va hozirgi darajasiga qarab, 4946 ta so'zni necha kunda o'rganishi maqsadga muvofiq>,
  "tone": <"soft" yoki "firm" — agar foydalanuvchi "menga tashqi bosim kerak" degan bo'lsa yoki ilgari 3+ marta til o'rganishni tashlab ketgan bo'lsa "firm", aks holda "soft">,
  "painPoint": <foydalanuvchining o'z so'zlari asosida, 1 gapda, agar til o'rganmasa nimani yo'qotishi (masalan: "ish imkoniyati", "orzu qilgan mamlakatga borish", "otasiga yordam berish")>,
  "hopePoint": <foydalanuvchining o'z so'zlari asosida, 1 gapda, agar til o'rgansa hayoti qanday o'zgarishi (masalan: "dasturchi bo'lib, ota-onasiga to'kin hayot berish")>
}

Foydalanuvchi javoblari:
`;

export async function analyzeProfile(answers) {
  try {
    const prompt = ANALYSIS_PROMPT_HEADER + JSON.stringify(answers, null, 2);
    const result = await callGemini(prompt);
    const planDays = Math.min(45, Math.max(30, Math.round(Number(result.planDays)) || 35));
    const tone = result.tone === 'firm' ? 'firm' : 'soft';
    return {
      planDays,
      tone,
      painPoint: String(result.painPoint || '').slice(0, 300) || 'maqsadingizga yetolmaslik',
      hopePoint: String(result.hopePoint || '').slice(0, 300) || 'orzu qilgan hayotga erishish',
    };
  } catch (e) {
    console.error('Gemini analyzeProfile xatosi:', e.message);
    return { planDays: 35, tone: 'soft', painPoint: 'maqsadingizga yetolmaslik', hopePoint: 'orzu qilgan hayotga erishish' };
  }
}

const MESSAGE_PROMPT_HEADER = `Siz o'zbek tilida yozuvchi, so'z bilan odamning yuragiga ta'sir qila oladigan ijodkorsiz. Sizga Telegram bot uchun eslatma xabari kerak — lekin ODDIY, KLİŞE, "korporativ-motivatsion" matn EMAS, balki foydalanuvchi o'qigan zahoti to'xtab, o'ylanib qoladigan, JONLI va SAMIMIY matn.

QATTIQ TAQIQLANGAN klişe iboralar (bularni HECH QACHON ishlatmang): "orzu qilgan hayotingiz sari intilish", "maqsadingizga yetolmaslik xavfi", "harakatni qayta boshlang", "o'zingizga ishoning", "bugun birinchi qadam" va shunga o'xshash umumiy, ma'nosiz-jarangli iboralar. Bular hech kimning yuragiga tegmaydi.

Buning o'rniga:
- Foydalanuvchining O'ZI aytgan aniq tafsilotlarni (hopePoint, painPoint) so'zma-so'z emas, balki JONLI TASVIRGA aylantirib ishlating — masalan "dasturchi bo'lish" o'rniga "kod yozayotgan, o'z loyihasini ko'rsatib turgan o'zingizni" kabi ko'z oldiga keltiring.
- Gaplar QISQA emas, balki BIR-BIRIGA BOG'LIQ, oqimdek davom etadigan bo'lsin — xuddi bitta fikr asta-sekin kuchayib, avjiga chiqib, so'ng chaqiriq bilan tugagandek. Har gap oldingi gapning davomi bo'lsin, uzilib qolgan alohida jumlalar EMAS.
- 4-6 ta gapdan iborat, to'liq, ichi to'q, obrazli xabar yozing — juda qisqa (2-3 gap) bo'lmasin.
- She'riy, obrazli til ishlatishdan qo'rqmang ("erkin va yorug' kunlar", "ichingizdagi alanga hali o'chgani yo'q" kabi jonli metaforalar juda yaxshi ishlaydi) — bu ohangni SAQLANG va rivojlantiring.
- To'g'ridan-to'g'ri, samimiy, xuddi yaqin do'sti/murabbiyi gapirayotgandek murojaat qiling — rasmiy ohang YO'Q.
- Aniq tafsilot va jonli, obrazli tasvir bilan hissiyotga chuqur tegib o'ting, keyin asta-sekin harakatga undang.
- Oxiri qisqa va kuchli chaqiriq bilan tugasin (masalan "Hoziroq." yoki "Besh daqiqa. Shu yetarli.").
- Xabar ichida 2-4 ta O'RINLI emoji ishlating — matnning eng hissiy nuqtalarini kuchaytirish uchun (masalan ⏳🔥💭✨🚪 kabi), lekin bezak sifatida emas, balki matnning bir qismi sifatida joylashtiring. Har gap oxiriga bittadan tirqab qo'yilgan emoji emas — tabiiy joylarga.

QAT'IY TAQIQLAR (mazmun bo'yicha, HECH QACHON buzilmasin):
- Ota-ona, farzand yoki har qanday yaqin insonning o'limi, kasalligi yoki azob-uqubati bilan qo'rqitish yoki bunga ishora qilish MUTLAQO TAQIQLANADI.
- Foydalanuvchini haqoratlash yoki kamsituvchi laqab bilan atash MUTLAQO TAQIQLANADI.
- Soxta tahdid berish (masalan "dastur butunlay yopiladi", "hisobingiz o'chiriladi") MUTLAQO TAQIQLANADI.

Uslub namunasi (buni SO'ZMA-SO'Z ko'chirmang, faqat OHANG, RITM va EMOJI ISHLATISH USULINI his qiling — bu MISOL 5/5 baho olgan, aynan shu darajada bo'lishi kerak):
"Aziz, uch kunlik sukunat to'plangan natijalarni nolga qaytardi ⏳. O'zing bir vaqtlar zavq bilan ko'z oldingga keltirgan o'sha erkin va yorug' kunlar bugun ham seni sabrsizlik bilan kutayotgan edi 💭. Lekin har bir to'xtab qolgan kun o'sha chiroyli kelajakni sendan biroz uzoqlashtirayotgandek, go'yo erishmoqchi bo'lgan barcha narsang yarim yo'lda qolib ketayotgandek tuyuladi ✨. Ichingdagi o'sha alanga hali o'chgani yo'q, faqat bugun unga ozgina e'tibor va iliqlik berishing kerak, xolos. Ilovani och va bor-yo'g'i bitta darsni tugatib qo'y 🔥. Besh daqiqa. Shu yetarli."

Xabar 2-4 qisqa gapdan iborat, o'zbek tilida, Telegram xabari sifatida yozilsin, HAQIQATAN kuchli va yodda qoladigan bo'lsin — bu shunchaki eslatma emas, foydalanuvchi hayotidagi haqiqiy burilish nuqtasi bo'lsin.

Kiritilgan ma'lumotlar:
- Daraja (level): {LEVEL} (1 = 1 kun kirmagan — yumshoqroq, lekin baribir jonli va samimiy; 2 = 2 kun ketma-ket — jiddiyroq; 3 = 3 kun — progress 0'ga qaytdi, eng kuchli, eng chuqur ta'sir qiluvchi xabar)
- Ohang (tone): {TONE} ("firm" bo'lsa birroz qattiqroq va to'g'ridan-to'g'ri, "soft" bo'lsa mehribonroq, lekin ikkalasi ham jonli bo'lishi shart)
- Ism: {NAME}
- Yo'qotayotgani (painPoint): {PAIN}
- Umid qilayotgani (hopePoint): {HOPE}

FAQAT quyidagi JSON obyektni qaytaring: {"message": "<xabar matni>"}
`;

const FALLBACK_MESSAGES = {
  1: [
    (name, hope) => `${name}. Kecha jim o'tdingiz. Faqat bitta kun — lekin ${hope} shu kichik kunlardan yig'iladi. Besh daqiqa. Hoziroq.`,
    (name, hope) => `${name}, bir kun o'tkazib yubordingiz. Kichkina, bilaman. Lekin ${hope} ham xuddi shunday kichik kunlardan boshlanadi. Bugun ochib ko'ring.`,
  ],
  2: [
    (name, hope, pain) => `${name}. Ikki kun. Ikki kun jim. Bu orada ${pain} bir qadam yaqinlashdi. Xohlaysizmi shunday davom etishini? Hozir qaytib, buni to'xtating.`,
    (name, hope, pain) => `${name}, ikkinchi kun ham ketdi. ${hope} — shuni aytgandingiz. Bugun ham jim tursangiz, ertaga aytish qiyinlashadi. Ochib ko'ring — besh daqiqa yetarli.`,
  ],
  3: [
    (name, hope, pain) => `${name}. Uch kun. Progress 0'ga qaytdi. Lekin siz emas — siz hali ham ${hope} deb orzu qilyapsiz, to'g'rimi? Bugun qayta boshlang. Bu safar oxirigacha.`,
    (name, hope, pain) => `${name}, 3 kun jim turdingiz, dastur qaytadan boshlashga majbur bo'ldi. ${pain} — buni his qilyapsizmi? Hoziroq oching. Bitta kun, boshqasidan farq qiladi.`,
  ],
};

export async function generateEngagementMessage({ level, tone, painPoint, hopePoint, firstName }) {
  const name = firstName || 'Do\'stim';
  try {
    const prompt = MESSAGE_PROMPT_HEADER
      .replace('{LEVEL}', level)
      .replace('{TONE}', tone || 'soft')
      .replace('{NAME}', name)
      .replace('{PAIN}', painPoint || '')
      .replace('{HOPE}', hopePoint || '');
    const result = await callGemini(prompt, 1.0);
    const message = String(result.message || '').trim();
    if (!message) throw new Error('bo\'sh xabar');
    return message;
  } catch (e) {
    console.error('Gemini generateEngagementMessage xatosi:', e.message);
    const variants = FALLBACK_MESSAGES[level] || FALLBACK_MESSAGES[1];
    const pick = variants[Math.floor(Math.random() * variants.length)];
    return pick(name, hopePoint || 'maqsadingiz', painPoint || 'imkoniyatingiz');
  }
}
