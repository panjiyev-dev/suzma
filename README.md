# Suzma — 5000 so'z (Mnemonika)

Bir oyda 5000 ta ingliz so'zini yodlashga mo'ljallangan Telegram Mini App. Har bir so'z kulgili/esda qoladigan **mnemonika** (assotsiatsiya) bilan beriladi va so'zlar Instagram Reels uslubida yuqoriga surib o'rganiladi. O'rganilgan so'zlar ilmiy asoslangan **3 · 7 · 14 kunlik takrorlash tizimi** orqali unutilmasdan uzoq xotiraga o'tkaziladi.

## Asosiy imkoniyatlar

- **Reels formatidagi o'quv oqimi** — so'zni yuqoriga surib keyingisiga o'tish, kartaga bosib tarjima/mnemonikani ko'rish, karnaycha orqali talaffuzni eshitish (Web Speech API).
- **3 · 7 · 14 takrorlash** — har bir o'rganilgan kun avtomatik ravishda 3, 7 va 14 kundan keyin takrorlashga chiqadi.
- **Takrorlash mashqlari** — so'zlarni moslashtirish (matching) va 4 variantli test shaklida, aralashtirilgan holda, xato qilingan so'zlar qayta-qayta so'raladi.
- **30 kunlik reja** — kunlar bo'yicha progress, umumiy statistika.
- **Tungi/yorug' rejim**, Telegram Mini App integratsiyasi (tema, xavfsiz zonalar, Back Button, haptika).
- **Telegram bot** — kanalga obuna tekshiruvi, kontakt orqali ro'yxatdan o'tish, admin statistikasi va foydalanuvchilar ro'yxati.
- **Qurilmalar orasida sinxronizatsiya** — progress serverga (SQLite) saqlanadi, Telegram ilovasini boshqa qurilmada ochsangiz ham davom etadi.

## Loyiha tuzilishi

```
.
├── index.html      # Ilova markupi
├── style.css       # Barcha stillar (tungi/yorug' tema)
├── app.js          # Ilova mantig'i (reels, SRS, takrorlash mashqlari, Telegram SDK)
├── data.js         # 4946 ta so'z (so'z, talaffuz, tarjima, mnemonika)
├── text.txt        # So'zlarning xom manba fayli
└── bot/            # Telegram bot + progress-sinxronizatsiya API
    ├── index.js         # Bot (grammY) + Express API server
    ├── db.js            # SQLite (foydalanuvchilar, progress, faollik)
    ├── verifyInitData.js # Telegram Mini App initData'ni xavfsiz tekshirish (HMAC)
    └── .env.example     # Kerakli muhit o'zgaruvchilari namunasi
```

## O'rnatish va ishga tushirish

### Frontend (Mini App)

Statik fayllar (`index.html`, `style.css`, `app.js`, `data.js`) har qanday statik hosting'da (Netlify, GitHub Pages va h.k.) ishlaydi — build jarayoni shart emas.

### Bot + API

```bash
cd bot
npm install
cp .env.example .env   # so'ng .env faylini haqiqiy qiymatlar bilan to'ldiring
npm start
```

`.env` uchun kerakli o'zgaruvchilar:

| O'zgaruvchi | Tavsif |
|---|---|
| `BOT_TOKEN` | BotFather'dan olingan bot tokeni |
| `WEBAPP_URL` | Mini App joylashtirilgan HTTPS manzil |
| `ADMIN_ID` | Admin panelga kirish huquqiga ega Telegram ID |
| `CHANNEL_USERNAME` | Ro'yxatdan o'tishdan oldin obuna talab qilinadigan kanal (`@` belgisisiz) |
| `PORT` | API serveri porti (standart: 3000) |

**Eslatma:** Kanalga obuna tekshiruvi ishlashi uchun bot shu kanalga **admin** sifatida qo'shilgan bo'lishi kerak, aks holda `getChatMember` so'rovi xatolik qaytaradi.
