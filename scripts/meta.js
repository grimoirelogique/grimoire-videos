// ============================================================
//  GRIMOIRE LOGIQUE — publication sur Facebook (page) et Instagram (Reels) par l'API Graph de Meta
//  Gratuit : une application Meta personnelle en mode développement suffit pour ses propres comptes.
//
//  node meta.js --autoriser                       une fois : échange le jeton court contre un jeton de page durable, trouve la page et le compte Instagram
//  node meta.js --envoyer [--jours 7] [--id 3,4] [--essai] [--sans-facebook] [--sans-instagram]
//       Facebook : envoie le Reel à la page avec sa date de publication (programmé par Facebook lui-même).
//       Instagram : l'API ne programme pas → dépose la vidéo sur l'hébergement public (GitHub Pages ou R2) et l'inscrit dans publication/file-attente.json ;
//                   le réveil (GitHub Actions ou --publier-attente) publie à l'heure.
//  node meta.js --publier-attente [--essai]       publie sur Instagram ce qui est dû (lancé toutes les heures par GitHub Actions)
//  node meta.js --conteneur-essai --id 3          test complet sans publier : hébergement → conteneur Instagram accepté
//  node meta.js --instagram-maintenant --id 3     publie tout de suite sur Instagram (test)
//  node meta.js --etat                            registre des envois
//
//  scripts/.env (voir docs/meta.md) :
//    META_APP_ID=…  META_APP_SECRET=…  META_JETON_COURT=…  (collé depuis l'explorateur Graph, sert une fois)
//    META_PAGE_ID=…  META_PAGE_TOKEN=…  META_IG_ID=…      (écrits par --autoriser)
// ============================================================
const fs = require('fs'), path = require('path');
const { lire, ecrire } = require('./env');
const { unixParis, maintenantParis } = require('./heure');
const heb = require('./hebergement');   // GitHub Pages (par défaut) ou Cloudflare R2
const ROOT = path.resolve(__dirname, '..'), EXPORTS = path.join(ROOT, 'exports');
const ATTENTE = heb.fichierAttente();   // dans le dépôt public grimoire-videos (clone local exports/hebergement/, ou le dépôt lui-même dans le réveil)
const REGISTRE = path.join(EXPORTS, 'meta-journal.json');                // local : ce qui a été envoyé à Facebook
const G = 'https://graph.facebook.com/v21.0';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const ESSAI = argv.includes('--essai'), JOURS = +opt('--jours', 7), IDS = opt('--id', null);
const env = lire();

const lireJson = (p, def) => fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : def;
const ecrireJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 1) + '\n'); };
const nom = e => `${e.date}-${e.niveau}-${String(e.archive).padStart(3, '0')}`;
const dodo = ms => new Promise(r => setTimeout(r, ms));

async function graph(methode, chemin, params = {}, jeton = env.META_PAGE_TOKEN){
  const url = new URL(`${G}/${chemin}`);
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) (methode === 'GET' ? url.searchParams : body).set(k, String(v));
  if (jeton) (methode === 'GET' ? url.searchParams : body).set('access_token', jeton);
  const r = await fetch(url, methode === 'GET' ? {} : { method: methode, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`${chemin} : ${j.error ? `${j.error.message} (code ${j.error.code})` : r.status}`);
  return j;
}

// ─── autorisation ───
async function autoriser(){
  for (const k of ['META_APP_ID', 'META_APP_SECRET', 'META_JETON_COURT']) if (!env[k]) { console.log(`${k} manque dans scripts/.env — voir docs/meta.md (étape 2 pour META_APP_ID et META_APP_SECRET, étape 3 pour META_JETON_COURT)`); process.exit(1); }
  // 1. jeton utilisateur longue durée (60 jours)
  const lon = await graph('GET', 'oauth/access_token', { grant_type: 'fb_exchange_token', client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, fb_exchange_token: env.META_JETON_COURT }, null);
  // 2. pages administrées → jeton de page (n'expire pas tant que le jeton utilisateur d'origine était longue durée)
  const pages = (await graph('GET', 'me/accounts', { fields: 'id,name,access_token,instagram_business_account' }, lon.access_token)).data || [];
  if (!pages.length) { console.log('Aucune page Facebook trouvée pour ce compte : crée une page et lie-lui le compte Instagram (docs/meta.md, étape 1).'); process.exit(1); }
  let page = env.META_PAGE_ID ? pages.find(p => p.id === env.META_PAGE_ID) : (pages.length === 1 ? pages[0] : null);
  if (!page) { console.log('Plusieurs pages ; mets META_PAGE_ID=… dans scripts/.env avec l\'une de celles-ci :'); pages.forEach(p => console.log(`  ${p.id}  ${p.name}`)); process.exit(1); }
  if (!page.instagram_business_account) { console.log(`La page « ${page.name} » n'a pas de compte Instagram professionnel lié (docs/meta.md, étape 1).`); process.exit(1); }
  ecrire({ META_PAGE_ID: page.id, META_PAGE_TOKEN: page.access_token, META_IG_ID: page.instagram_business_account.id, META_JETON_COURT: '' });
  const ig = await graph('GET', page.instagram_business_account.id, { fields: 'username' }, page.access_token);
  console.log(`Page « ${page.name} » (${page.id}) et Instagram @${ig.username} (${ig.id}) enregistrés dans scripts/.env. Le jeton de page est durable.`);
}

// ─── diagnostic des permissions ───
// « J'ai pourtant coché la permission » : ce contrôle dit ce que le jeton porte réellement.
// À lancer juste après avoir collé META_JETON_COURT, AVANT --autoriser.
async function permissions(){
  const NECESSAIRES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts',
                       'instagram_basic', 'instagram_content_publish', 'business_management'];
  // 1. l'application elle-même répond-elle ?
  if (env.META_APP_ID && env.META_APP_SECRET) {
    try {
      const r = await fetch(`https://graph.facebook.com/v21.0/${env.META_APP_ID}?fields=name,link&access_token=${encodeURIComponent(env.META_APP_ID + '|' + env.META_APP_SECRET)}`);
      const j = await r.json();
      console.log(j.error ? `application  : ✗ ${j.error.message} (code ${j.error.code})` : `application  : ✓ « ${j.name} »`);
    } catch (e) { console.log('application  : ✗', e.message); }
  }
  // 2. permissions réellement accordées au jeton utilisateur
  const t = env.META_JETON_COURT || env.META_PAGE_TOKEN;
  if (!t) { console.log('Aucun jeton dans scripts/.env : colle META_JETON_COURT (docs/meta.md, étape 3).'); return; }
  console.log(env.META_JETON_COURT ? 'jeton testé  : META_JETON_COURT (jeton utilisateur)' : 'jeton testé  : META_PAGE_TOKEN (jeton de page)');
  const r = await fetch(`https://graph.facebook.com/v21.0/me/permissions?access_token=${encodeURIComponent(t)}`);
  const j = await r.json();
  if (j.error) {
    console.log(`\n✗ ${j.error.message} (code ${j.error.code})`);
    console.log('\nUn jeton de page ne sait pas lister ses permissions. Colle un jeton UTILISATEUR frais');
    console.log('dans META_JETON_COURT et relance ce diagnostic : c\'est lui qui porte les permissions.');
    return;
  }
  const par = {}; for (const p of j.data || []) par[p.permission] = p.status;
  console.log('\nPermissions nécessaires :');
  let manque = 0;
  for (const p of NECESSAIRES) {
    const st = par[p] || 'absente';
    if (st !== 'granted') manque++;
    console.log(`  ${st === 'granted' ? '✓' : '✗'} ${p.padEnd(26)} ${st}`);
  }
  const autres = Object.keys(par).filter(p => !NECESSAIRES.includes(p));
  if (autres.length) console.log('\nAutres accordées : ' + autres.filter(p => par[p] === 'granted').join(', '));
  console.log(manque ? `\n${manque} permission(s) manquante(s). Regénère le jeton en les cochant AVANT de cliquer sur « Générer ».`
                     : '\nToutes les permissions sont là : lance « node scripts/meta.js --autoriser ».');
}

// ─── sélection dans le journal ───
function selection(){
  const w = {}; global.window = w; require(path.join(ROOT, 'journal.js'));
  const today = new Date(); today.setHours(0, 0, 0, 0); const limit = new Date(today); limit.setDate(limit.getDate() + JOURS);
  return w.JOURNAL.filter(e => IDS ? String(IDS).split(',').map(Number).includes(e.id) : (e.statut === 'produite' && new Date(e.date) >= today && new Date(e.date) <= limit))
    .sort((a, b) => (a.date + a.heure).localeCompare(b.date + b.heure));
}
function kit(e){ const p = path.join(EXPORTS, nom(e) + '-publication.json'); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; }

// ─── Facebook : Reel programmé ───
async function envoyerFacebook(e, mp4, k){
  const quand = unixParis(e.date, e.heure);
  if (quand < Date.now() / 1000 + 600) throw new Error('date passée ou à moins de 10 minutes');
  const start = await graph('POST', `${env.META_PAGE_ID}/video_reels`, { upload_phase: 'start' });
  // téléversement direct du fichier ; si Meta le refuse, on lui donne l'adresse R2 de la vidéo (file_url), qu'il va chercher lui-même
  const corps = fs.readFileSync(mp4);
  let up = await fetch(`https://rupload.facebook.com/video-upload/v21.0/${start.video_id}`, { method: 'POST', headers: { Authorization: `OAuth ${env.META_PAGE_TOKEN}`, offset: '0', file_size: String(corps.length), 'Content-Type': 'application/octet-stream' }, body: corps });
  let upj = await up.json().catch(() => ({}));
  if ((!up.ok || !upj.success) && heb.pret()) {
    const url = await heb.deposer(mp4, 'facebook/' + path.basename(mp4));
    up = await fetch(`https://rupload.facebook.com/video-upload/v21.0/${start.video_id}`, { method: 'POST', headers: { Authorization: `OAuth ${env.META_PAGE_TOKEN}`, file_url: url } });
    upj = await up.json().catch(() => ({}));
  }
  if (!up.ok || !upj.success) throw new Error(`téléversement : ${JSON.stringify(upj).slice(0, 200)}`);
  await graph('POST', `${env.META_PAGE_ID}/video_reels`, { upload_phase: 'finish', video_id: start.video_id, video_state: 'SCHEDULED', scheduled_publish_time: quand, description: k.instagram });
  return start.video_id;
}

// ─── Instagram : vidéo + file d'attente dans le dépôt public, poussés ensemble ───
async function inscrireInstagram(e, mp4, k){
  heb.preparerClone();
  const cle = nom(e) + '.mp4';
  const url = await heb.deposer(mp4, cle, { dejaPrepare: true, sansPousser: true });
  const file = lireJson(ATTENTE, []);
  const deja = file.find(x => x.id === e.id);
  const item = { id: e.id, nom: nom(e), date: e.date, heure: e.heure, quand: unixParis(e.date, e.heure), url, cle, legende: k.instagram, statut: 'en attente', ajoute: maintenantParis() };
  if (deja) Object.assign(deja, item); else file.push(item);
  ecrireJson(ATTENTE, file);
  heb.synchroniser(); heb.pousser(`File d'attente : ${nom(e)}`);
  return url;
}
async function publierInstagram(item){
  if (!(await heb.attendre(item.url, 120000))) throw new Error('adresse de la vidéo injoignable : ' + item.url);
  const c = await graph('POST', `${env.META_IG_ID}/media`, { media_type: 'REELS', video_url: item.url, caption: item.legende, share_to_feed: 'true' });
  for (let i = 0; i < 40; i++) {   // Meta transcode : en général 30 s à 2 min
    await dodo(10000);
    const s = await graph('GET', c.id, { fields: 'status_code,status' });
    if (s.status_code === 'FINISHED') break;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`conteneur ${s.status_code} : ${s.status || ''}`);
  }
  const p = await graph('POST', `${env.META_IG_ID}/media_publish`, { creation_id: c.id });
  return p.id;
}

// ─── réveil : publie ce qui est dû ───
async function publierAttente(){
  heb.preparerClone();
  const file = lireJson(ATTENTE, []);
  const now = Date.now() / 1000;
  let n = 0;
  for (const item of file) {
    if (item.statut !== 'en attente') continue;
    if (item.quand > now) continue;                                  // pas encore l'heure
    if (now - item.quand > 12 * 3600) { item.statut = 'manquée'; item.note = 'réveil arrivé plus de 12 h après l\'heure'; console.log(`✗ ${item.nom} manquée (${item.date} ${item.heure})`); continue; }
    if (ESSAI) { console.log(`▶ ${item.nom} serait publiée maintenant (prévue ${item.date} ${item.heure})`); continue; }
    try {
      item.media = await publierInstagram(item); item.statut = 'publiée'; item.publie = maintenantParis(); n++;
      delete item.note; delete item.essais;   // une réussite efface l'erreur des tentatives précédentes, sinon la file affiche « publiée (erreur…) »
      console.log(`✓ ${item.nom} publiée sur Instagram (${item.media})`);
      try { await heb.retirer(item.cle, { dejaPrepare: true, sansPousser: true }); } catch (err) { item.note = 'vidéo non retirée de l\'hébergement : ' + err.message; }
    } catch (err) { item.essais = (item.essais || 0) + 1; item.note = err.message; console.log(`✗ ${item.nom} : ${err.message}`); if (item.essais >= 3) item.statut = 'échec'; }
  }
  if (!ESSAI) { ecrireJson(ATTENTE, file); heb.pousser(n ? `Instagram : ${n} publication(s)` : 'File d\'attente mise à jour'); }
  console.log(`${n} publication(s) Instagram. ${file.filter(x => x.statut === 'en attente').length} en attente.`);
}

async function envoyer(){
  const sel = selection();
  if (!sel.length) { console.log('Rien à envoyer.'); return; }
  const fb = !argv.includes('--sans-facebook'), ig = !argv.includes('--sans-instagram');
  if (!ESSAI) { for (const k of ['META_PAGE_ID', 'META_PAGE_TOKEN', 'META_IG_ID']) if (!env[k]) { console.log(`${k} manque : lance d'abord node scripts/meta.js --autoriser`); process.exit(1); } if (ig && !heb.pret()) { console.log('R2 non configuré (docs/meta.md, étape 4) : Instagram impossible, Facebook seulement avec --sans-instagram'); process.exit(1); } }
  const registre = lireJson(REGISTRE, {});
  let ok = 0;
  for (const e of sel) {
    const n = nom(e), mp4 = path.join(EXPORTS, n + '.mp4'), k = kit(e);
    if (!fs.existsSync(mp4) || !k) { console.log(`✗ ${n} : vidéo ou kit JSON absent`); continue; }
    const r = registre[n] = registre[n] || {};
    if (ESSAI) { console.log(`▶ ${n} · ${e.date} ${e.heure}${fb && !r.facebook ? ' · Facebook programmé' : ''}${ig && !r.instagram ? ' · Instagram en file d\'attente' : ''}`); continue; }
    try {
      if (fb && !r.facebook) { r.facebook = await envoyerFacebook(e, mp4, k); console.log(`✓ ${n} Facebook programmé (${e.date} ${e.heure})`); }
      if (ig && !r.instagram) { r.instagram = await inscrireInstagram(e, mp4, k); console.log(`✓ ${n} Instagram en file d'attente (${e.date} ${e.heure})`); }
      r.quand = maintenantParis(); ok++;
    } catch (err) { console.log(`✗ ${n} : ${err.message}`); }
    ecrireJson(REGISTRE, registre);
  }
  console.log(`\n${ok}/${sel.length} vidéo(s) traitée(s). Facebook publie seul ; Instagram sera publié à l'heure par le réveil du dépôt ${env.GH_VIDEOS_REPO || ''}.`);
}

// test sans publier : dépose la vidéo, crée le conteneur Instagram, attend qu'il soit prêt, puis retire la vidéo (le conteneur expire seul)
async function conteneurEssai(){
  const sel = selection(); if (!sel.length) return console.log('Rien.');
  const e = sel[0], k = kit(e), mp4 = path.join(EXPORTS, nom(e) + '.mp4'); if (!k || !fs.existsSync(mp4)) return console.log('vidéo ou kit absent');
  const cle = 'essai-' + nom(e) + '.mp4';
  const url = await heb.deposer(mp4, cle); console.log('déposée :', url);
  if (!(await heb.attendre(url))) throw new Error('adresse toujours pas servie après 5 minutes');
  try {
    const c = await graph('POST', `${env.META_IG_ID}/media`, { media_type: 'REELS', video_url: url, caption: 'essai technique, non publié' });
    let s;
    for (let i = 0; i < 40; i++) { await dodo(10000); s = await graph('GET', c.id, { fields: 'status_code,status' }); process.stdout.write(s.status_code + ' '); if (s.status_code !== 'IN_PROGRESS') break; }
    console.log(s.status_code === 'FINISHED' ? '\n✓ Instagram a bien récupéré et accepté la vidéo (rien n\'est publié).' : `\n✗ conteneur ${s.status_code} : ${JSON.stringify(s.status || '')}`);
  } finally { await heb.retirer(cle); }
}
async function instagramMaintenant(){
  const sel = selection(); if (!sel.length) return console.log('Rien.');
  for (const e of sel) { const k = kit(e), mp4 = path.join(EXPORTS, nom(e) + '.mp4'); if (!k || !fs.existsSync(mp4)) continue;
    if (ESSAI) { console.log(`▶ ${nom(e)} serait publiée maintenant`); continue; }
    const url = await heb.deposer(mp4, nom(e) + '.mp4'); console.log('déposée :', url); if (!(await heb.attendre(url))) throw new Error('adresse toujours pas servie après 5 minutes');
    const id = await publierInstagram({ url, legende: k.instagram }); console.log(`✓ ${nom(e)} publiée sur Instagram (${id})`);
    await heb.retirer(nom(e) + '.mp4'); }
}

function etat(){
  const registre = lireJson(REGISTRE, {}), file = lireJson(ATTENTE, []);
  console.log('Facebook (programmé par la page) :'); for (const [n, r] of Object.entries(registre)) console.log(`  ${n}  fb:${r.facebook || '-'}  ig:${r.instagram ? 'en file' : '-'}  ${r.quand || ''}`);
  console.log('File d\'attente Instagram :'); for (const i of file) console.log(`  ${i.nom}  ${i.date} ${i.heure}  ${i.statut}${i.media ? ' ' + i.media : ''}${i.note ? '  (' + i.note + ')' : ''}`);
}

(async () => {
  try {
    if (argv.includes('--autoriser')) await autoriser();
    else if (argv.includes('--envoyer')) await envoyer();
    else if (argv.includes('--publier-attente')) await publierAttente();
    else if (argv.includes('--instagram-maintenant')) await instagramMaintenant();
    else if (argv.includes('--conteneur-essai')) await conteneurEssai();
    else if (argv.includes('--permissions')) await permissions();
    else if (argv.includes('--etat')) etat();
    else console.log('node meta.js --autoriser | --envoyer [--jours 7] [--id] [--essai] | --publier-attente | --instagram-maintenant --id N | --etat');
  } catch (e) { console.log('✗', e.message); process.exit(1); }
})();
