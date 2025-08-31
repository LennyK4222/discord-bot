# Discord Welcome/Goodbye Bot cu UI modern

Un bot Discord (discord.js v14) cu mesaje de welcome/goodbye și UI web modern (Express + EJS + Tailwind via CDN) pentru configurare. Banner-ul din mesaje poate fi un GIF animat (URL).

## Cerințe
- Node.js 18+
- Token de bot Discord (și activat intentul Server Members)

## Instalare
1. Clonează/Descarcă proiectul
2. Copiază `.env.example` în `.env` și setează `DISCORD_TOKEN`
3. Instalează dependențe:

```bash
npm install
```

4. Rulează în dev:
```bash
npm run dev
```
Sau producție:
```bash
npm start
```

UI-ul pornește pe `http://localhost:3000`

## Permisiuni / Intents
- În [Discord Developer Portal](https://discord.com/developers/applications) → Bot → Privileged Gateway Intents → bifează "Server Members Intent".
- Invită botul în server cu permisiuni de a citi/scrie în canalele dorite.

## Configurare
- Deschide `http://localhost:3000` pentru a vedea serverele unde este botul.
- Pentru fiecare server:
  - setează `welcomeChannelId` (obligatoriu pentru mesaje de welcome)
  - `goodbyeChannelId` (opțional; dacă lipsește, se va folosi channel-ul de welcome)
  - `welcomeMessage` și `goodbyeMessage` (suportă placeholder `{user}`)
  - `bannerUrl` – link către un GIF animat (ex: `https://media.giphy.com/media/.../giphy.gif`)

## Format mesaje
- Welcome: "Bine ai venit, {user}!" → înlocuiește `{user}` cu mențiune (@)
- Goodbye: "La revedere, {user}!" → înlocuiește `{user}` cu nume/tag

## Note
- Fișierul de configurare este `data/config.json`.
- Dacă nu vezi serverele în UI, asigură-te că botul e online și invitat.
- Pentru a obține Channel ID, activează "Developer Mode" în Discord, click dreapta pe canal → Copy ID.
