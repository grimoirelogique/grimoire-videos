// ============================================================
//  GRIMOIRE LOGIQUE — hébergement temporaire des vidéos sur Cloudflare R2 (gratuit jusqu'à 10 Go)
//  Instagram va chercher la vidéo à une adresse publique : on la dépose sur R2 le temps de la publication, puis on la retire.
//  API S3 signée (SigV4) écrite à la main : aucune dépendance.
//
//  scripts/.env :
//    R2_ACCOUNT_ID=…          identifiant de compte Cloudflare (page R2 → « Account ID »)
//    R2_ACCESS_KEY_ID=…       jeton d'API R2 (« Manage R2 API Tokens » → Object Read & Write)
//    R2_SECRET_ACCESS_KEY=…
//    R2_BUCKET=grimoire       nom du bucket
//    R2_PUBLIC_URL=https://pub-xxxx.r2.dev   adresse publique du bucket (Settings → Public access → r2.dev)
//
//  node r2.js --deposer chemin.mp4 [--cle nom.mp4]   |  --retirer nom.mp4  |  --lister
// ============================================================
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { lire } = require('./env');

const sha256 = (d) => crypto.createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function config(){
  const env = lire();
  for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL']) if (!env[k]) throw new Error(`${k} manque dans scripts/.env (voir docs/meta.md)`);
  return env;
}
const pret = () => { try { config(); return true; } catch { return false; } };

// Requête S3 signée vers R2 (région « auto »)
async function requete(methode, cle, corps, contentType){
  const env = config();
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const chemin = `/${env.R2_BUCKET}/${cle.split('/').map(enc).join('/')}`;
  const now = new Date(), amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''), jour = amzDate.slice(0, 8);
  const payloadHash = corps ? sha256(corps) : sha256('');
  const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  if (contentType) headers['content-type'] = contentType;
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonical = [methode, chemin, '', ...Object.keys(headers).sort().map(k => `${k}:${headers[k]}`), '', signedHeaders, payloadHash].join('\n');
  const scope = `${jour}/auto/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kSign = hmac(hmac(hmac(hmac('AWS4' + env.R2_SECRET_ACCESS_KEY, jour), 'auto'), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSign).update(toSign).digest('hex');
  const auth = `AWS4-HMAC-SHA256 Credential=${env.R2_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const h = { ...headers, Authorization: auth }; delete h.host;
  const r = await fetch(`https://${host}${chemin}`, { method: methode, headers: h, body: corps || undefined });
  if (!r.ok) throw new Error(`R2 ${methode} ${cle} : ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r;
}

// Dépose un fichier et renvoie son adresse publique
async function deposer(fichier, cle){
  cle = cle || path.basename(fichier);
  const corps = fs.readFileSync(fichier);
  await requete('PUT', cle, corps, cle.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream');
  return `${config().R2_PUBLIC_URL.replace(/\/$/, '')}/${cle.split('/').map(enc).join('/')}`;
}
async function retirer(cle){ await requete('DELETE', cle); }
async function lister(){
  const r = await requete('GET', '', null);   // GET sur le bucket : liste XML
  const xml = await r.text();
  return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
}
module.exports = { deposer, retirer, lister, pret };

if (require.main === module) (async () => {
  const argv = process.argv.slice(2), opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  try {
    if (argv.includes('--deposer')) console.log(await deposer(opt('--deposer'), opt('--cle')));
    else if (argv.includes('--retirer')) { await retirer(opt('--retirer')); console.log('retiré'); }
    else if (argv.includes('--lister')) console.log((await lister()).join('\n') || '(vide)');
    else console.log('node r2.js --deposer fichier [--cle nom] | --retirer nom | --lister');
  } catch (e) { console.log('✗', e.message); process.exit(1); }
})();
