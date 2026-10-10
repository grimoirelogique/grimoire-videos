// Lecture et écriture de scripts/.env (une clef par ligne, CLEF=valeur). Les clefs restent dans ce fichier, jamais ailleurs.
const fs = require('fs'), path = require('path');
const ENV_PATH = path.join(__dirname, '.env');
function lire(){
  const env = {};
  if (fs.existsSync(ENV_PATH)) for (const l of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && !l.trim().startsWith('#')) env[m[1]] = m[2].replace(/\s+#.*$/, '').trim(); }   // un commentaire après la valeur est ignoré
  for (const k of Object.keys(process.env)) if (/^(META_|R2_|GH_VIDEOS_|HEBERGEMENT$|YT_|PUBLIER_|UPLOAD_POST_|TIKTOK_)/.test(k) && !env[k]) env[k] = process.env[k];   // GitHub Actions : secrets en variables d'environnement
  return env;
}
function ecrire(cles){
  let s = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  for (const [k, v] of Object.entries(cles)) {
    const re = new RegExp(`^${k}=.*$`, 'm');
    s = re.test(s) ? s.replace(re, `${k}=${v}`) : s + (s && !s.endsWith('\n') ? '\n' : '') + `${k}=${v}\n`;
  }
  fs.writeFileSync(ENV_PATH, s, { mode: 0o600 });
}
module.exports = { lire, ecrire, ENV_PATH };
