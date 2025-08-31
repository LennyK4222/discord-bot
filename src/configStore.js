import { promises as fs } from 'fs';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'config.json');

async function ensure() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  try {
    await fs.access(dataFile);
  } catch {
    await fs.writeFile(dataFile, JSON.stringify({}, null, 2));
  }
}

export async function getAllConfigs() {
  await ensure();
  try {
    const data = await fs.readFile(dataFile, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export async function getGuildConfig(guildId) {
  const all = await getAllConfigs();
  return all[guildId] || {};
}

export async function setGuildConfig(guildId, cfg) {
  const all = await getAllConfigs();
  all[guildId] = { ...(all[guildId] || {}), ...cfg };
  await fs.writeFile(dataFile, JSON.stringify(all, null, 2));
}
