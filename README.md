# Discord Welcome/Goodbye Bot cu UI

Un bot Discord (discord.js v14) care trimite bannere de welcome/goodbye și oferă o interfață web pentru configurare (Express + EJS). Proiectul poate compune bannere statice (PNG) sau animate (GIF) și permite încărcări de imagini, role-based access și auto-role la join.

## Caracteristici
- Mesaje de welcome și goodbye personalizabile (placeholder `{user}`).
- Compoziție banner: suport pentru GIF animat (ffmpeg + palette) și overlay PNG (folosit pentru text/avatar).
- Interfață web pentru administrare per-server.
- Autentificare Discord (OAuth) pentru dashboard.
- Assign automat de rol la join (auto-role) configurabil.

## Cerințe
- Node.js 18+ (recomandat LTS)
- FFmpeg instalat în PATH (necesar pentru compunerea GIF-urilor)
- Un bot Discord cu token și intents setate

## Variabile de mediu
După clonare, copiezi `.env.example` în `.env` și completezi valorile necesare:

- `DISCORD_TOKEN` — token-ul bot-ului
- `SESSION_SECRET` — secret pentru sesiuni Express
- `CLIENT_ID`, `CLIENT_SECRET`, `CALLBACK_URL` — (opțional) pentru OAuth dashboard

## Instalare & rulare
Instalează dependențele și rulează în modul dezvoltare:

```powershell
npm install
npm run dev
```

Pentru producție:

```powershell
npm ci
npm start
```

Implicit, UI este disponibil la: `http://localhost:3000` (verifică `nodemon.json` / scripturi dacă portul diferă).

## Configurare Discord
1. În Discord Developer Portal, bifează `Server Members Intent` la Bot → Privileged Gateway Intents.
2. Invită botul în server cu permisiunile necesare (trimite mesaje, atașează fișiere, Manage Roles dacă folosești auto-role).

## Folosire UI
- Accesează `http://localhost:3000` și autentifică-te cu Discord (dacă OAuth este configurat).
- Alege serverul și configurează:
  - canalul de welcome/goodbye
  - mesajele (folosește `{user}` pentru mențiune)
  - allowed roles (care pot accesa dashboard)
  - `autoRoleId` (rol care se aplică automat la join)
  - poți încărca bannere locale (upload) sau folosi `bannerUrl`

## Endpoints utile
- `/guild/:id` — pagina de configurare pentru server
- `/guild/:id/test` — trigger pentru a trimite un banner de test (admin-only)
- `/api/preview/:id` — generează preview PNG/GIF
- `/api/overlay/:id` — generează overlay PNG (folosit și pentru preview)

## Observații tehnice
- Pentru GIF-uri animate serverul folosește FFmpeg (palettegen/paletteuse). Asigură-te că `ffmpeg` este pe `PATH`.
- Textul și avatarul sunt randate într-un overlay PNG pentru stabilitate (evită problemele cu drawtext în ffmpeg pe Windows).
- Dacă folosești auto-role, bot-ul trebuie să aibă permisiunea `Manage Roles` și rolul bot-ului trebuie să fie peste rolul configurat în ordinea rolurilor Discord.

## Depanare rapidă
- Văd erori legate de font sau ffmpeg — verifică că `ffmpeg` este instalat și funcțional:

```powershell
ffmpeg -version
```

- Nu apar serverele în dashboard — asigură-te că botul este online și că aplicația OAuth are scope-urile corecte (bot + identify + guilds).

## Contribuire & licență
- Modificări: deschide PR-uri sau issues în repository-ul de pe GitHub.
- Adaugă un fișier `LICENSE` dacă vrei să publici codul cu o licență clară.

---

Dacă vrei, mai adaug un exemplu de `.env` complet, un workflow GitHub Actions simplu sau un fișier `docker-compose` pentru rulare în container; spune-mi ce preferi.
