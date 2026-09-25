// ============================================================
//  GRIMOIRE LOGIQUE — dépôt public « grimoire-videos » : hébergement des vidéos, file d'attente Instagram et réveil
//  Instagram exige une adresse publique, pas un fichier. Le dépôt public, servi par GitHub Pages, héberge la vidéo de
//  chaque énigme le temps de sa publication. Il porte aussi publication/file-attente.json, une copie des scripts et
//  le réveil GitHub Actions (.github/workflows/instagram.yml) qui publie à l'heure. Un seul dépôt, aucun jeton à créer :
//  sur le Mac, git utilise la connexion « gh auth login » ; dans le réveil, le jeton automatique du dépôt suffit.
//  Chaque envoi remplace l'historique (commit orphelin + push forcé) : le dépôt ne grossit pas avec les vidéos passées.
//
//  scripts/.env :  HEBERGEMENT=github   GH_VIDEOS_REPO=compte/grimoire-videos   GH_VIDEOS_URL=https://compte.github.io/grimoire-videos
//  (HEBERGEMENT=r2 bascule sur Cloudflare R2, scripts/r2.js, qui demande une carte bancaire — écarté.)
//
//  node hebergement.js --deposer chemin.mp4 [--cle nom] [--attendre] | --retirer nom | --lister | --synchroniser | --attendre nom
// ============================================================
const fs = require('fs'), path = require('path');
const { spawnSync } = require('child_process');
const { lire } = require('./env');
const ROOT = path.resolve(__dirname, '..');
const env = lire();
const MODE = (env.HEBERGEMENT || 'github').toLowerCase();
const ACTION = !!process.env.GITHUB_ACTIONS;   // dans le réveil, le dépôt est déjà extrait : ROOT est le dépôt lui-même
const CLONE = ACTION ? ROOT : path.join(ROOT, 'exports', 'hebergement');
const REPO = env.GH_VIDEOS_REPO || process.env.GITHUB_REPOSITORY || '';
const URL_BASE = (env.GH_VIDEOS_URL || (REPO ? `https://${REPO.split('/')[0]}.github.io/${REPO.split('/')[1]}` : '')).replace(/\/$/, '');
// ce que le Mac copie dans le dépôt à chaque synchronisation (le réveil en a besoin pour tourner)
const A_COPIER = ['scripts/meta.js', 'scripts/env.js', 'scripts/heure.js', 'scripts/hebergement.js', 'scripts/r2.js', '.github/workflows/instagram.yml'];

function git(args, cwd = CLONE){
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (r.status !== 0) throw new Error(`git ${args[0]} : ${(r.stderr || r.stdout).trim().split('\n').pop()}`);
  return r.stdout.trim();
}
const depotUrl = () => process.env.GH_TOKEN_ACTION ? `https://x-access-token:${process.env.GH_TOKEN_ACTION}@github.com/${REPO}.git` : `https://github.com/${REPO}.git`;

function preparerClone(){
  if (!REPO || !URL_BASE) throw new Error('GH_VIDEOS_REPO et GH_VIDEOS_URL manquent dans scripts/.env (voir docs/meta.md, étape 4)');
  if (ACTION) { git(['remote', 'set-url', 'origin', depotUrl()]); }
  else if (!fs.existsSync(path.join(CLONE, '.git'))) { fs.mkdirSync(path.dirname(CLONE), { recursive: true }); git(['clone', '--quiet', '--depth', '1', depotUrl(), CLONE], ROOT); }
  else { git(['fetch', '--quiet', '--depth', '1', 'origin', 'main']); git(['reset', '--quiet', '--hard', 'origin/main']); }
  git(['config', 'user.name', 'Grimoire Logique']); git(['config', 'user.email', 'grimoire@users.noreply.github.com']);
  // sur le Mac : n'utiliser que la connexion « gh » (le trousseau macOS peut contenir un autre compte GitHub et provoquer un 403)
  if (!ACTION) { git(['config', '--replace-all', 'credential.helper', '']); git(['config', '--add', 'credential.helper', '!gh auth git-credential']); }
  for (const [f, c] of [['.nojekyll', ''], ['index.html', '<!doctype html><title>Grimoire Logique</title>'], ['README.md', '# Grimoire Logique — vidéos en attente de publication\n\nDépôt technique : les vidéos y séjournent le temps de leur publication sur Instagram, puis sont retirées.\n']]) if (!fs.existsSync(path.join(CLONE, f))) fs.writeFileSync(path.join(CLONE, f), c);
  fs.mkdirSync(path.join(CLONE, 'publication'), { recursive: true });
  if (!fs.existsSync(path.join(CLONE, 'publication', 'file-attente.json'))) fs.writeFileSync(path.join(CLONE, 'publication', 'file-attente.json'), '[]\n');
}
// depuis le Mac : recopie les scripts et le réveil dans le dépôt (le réveil tourne avec cette copie)
function synchroniser(){
  if (ACTION) return;
  for (const f of A_COPIER) { const src = path.join(ROOT, f), dst = path.join(CLONE, f); if (fs.existsSync(src)) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); } }
}
// envoie l'état courant du dossier comme unique commit (l'historique des vidéos passées ne s'accumule pas)
function pousser(message){
  git(['add', '-A']);
  const st = git(['status', '--porcelain']);
  const branche = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!st && branche === 'main' && git(['rev-list', '--count', 'HEAD']) === '1') return;   // rien de neuf et déjà compact
  git(['checkout', '--quiet', '--orphan', 'neuf']);
  git(['add', '-A']);
  git(['commit', '--quiet', '--allow-empty', '-m', message]);
  git(['branch', '-M', 'main']);
  git(['push', '--quiet', '--force', 'origin', 'main']);
}
const url = cle => `${URL_BASE}/${cle.split('/').map(encodeURIComponent).join('/')}`;
const fichierAttente = () => path.join(CLONE, 'publication', 'file-attente.json');

const github = {
  pret: () => !!(REPO && URL_BASE),
  url, fichierAttente, preparerClone, synchroniser, pousser,
  // copie la vidéo dans le dépôt et pousse (sauf { sansPousser: true } : l'appelant poussera lui-même)
  async deposer(fichier, cle, opts = {}){
    cle = cle || path.basename(fichier);
    if (!opts.dejaPrepare) preparerClone();
    fs.mkdirSync(path.dirname(path.join(CLONE, cle)), { recursive: true });
    fs.copyFileSync(fichier, path.join(CLONE, cle));
    if (!opts.sansPousser) { synchroniser(); pousser(`Dépôt ${cle}`); }
    return url(cle);
  },
  async retirer(cle, opts = {}){
    if (!opts.dejaPrepare) preparerClone();
    const f = path.join(CLONE, cle);
    if (fs.existsSync(f)) fs.unlinkSync(f);
    if (!opts.sansPousser) pousser(`Retrait ${cle}`);
  },
  async lister(){ preparerClone(); return fs.readdirSync(CLONE).filter(f => /\.mp4$/i.test(f)); },
};

// GitHub Pages met une à deux minutes à servir un fichier poussé
async function attendre(u, maxMs = 300000){
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try { const r = await fetch(u, { method: 'HEAD', cache: 'no-store' }); if (r.ok && /video|octet/.test(r.headers.get('content-type') || '')) return true; } catch {}
    await new Promise(r => setTimeout(r, 15000));
  }
  return false;
}

const backend = MODE === 'r2' ? Object.assign({ url: () => null, fichierAttente: () => path.join(ROOT, 'publication', 'file-attente.json'), preparerClone(){}, synchroniser(){}, pousser(){} }, require('./r2')) : github;
module.exports = { MODE, ACTION, CLONE, ...backend, attendre };

if (require.main === module) (async () => {
  const argv = process.argv.slice(2), opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  try {
    console.log('hébergement :', MODE, REPO ? `(${REPO})` : '');
    if (argv.includes('--deposer')) { const u = await backend.deposer(opt('--deposer'), opt('--cle')); console.log(u); if (argv.includes('--attendre')) console.log(await attendre(u) ? 'servie' : 'toujours pas servie après 5 min'); }
    else if (argv.includes('--retirer')) { await backend.retirer(opt('--retirer')); console.log('retirée'); }
    else if (argv.includes('--lister')) console.log((await backend.lister()).join('\n') || '(vide)');
    else if (argv.includes('--synchroniser')) { preparerClone(); synchroniser(); pousser('Synchronisation des scripts et du réveil'); console.log('dépôt à jour'); }
    else if (argv.includes('--attendre')) console.log(await attendre(url(opt('--attendre'))) ? 'servie' : 'pas servie');
    else console.log('node hebergement.js --deposer fichier [--cle nom] [--attendre] | --retirer nom | --lister | --synchroniser');
  } catch (e) { console.log('✗', e.message); process.exit(1); }
})();
