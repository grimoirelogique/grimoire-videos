// Heure de Paris → horodatage Unix (secondes) et chaîne ISO avec décalage, sans dépendance.
function decalageParis(d){
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', timeZoneName: 'longOffset' }).formatToParts(d).find(x => x.type === 'timeZoneName').value;
  const m = p.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +(m[3] || 0)) : 60;
}
// unixParis("2026-09-19", "12:00") → secondes Unix de ce moment à Paris
function unixParis(date, heure){
  const utc = Date.parse(`${date}T${heure}:00Z`);
  const off = decalageParis(new Date(utc));
  return Math.floor((utc - off * 60000) / 1000);
}
function isoParis(date, heure){
  const off = decalageParis(new Date(unixParis(date, heure) * 1000)), s = off < 0 ? '-' : '+', a = Math.abs(off);
  return `${date}T${heure}:00${s}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}
const maintenantParis = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }).format(new Date());   // "2026-09-19 12:03"
module.exports = { unixParis, isoParis, decalageParis, maintenantParis };
