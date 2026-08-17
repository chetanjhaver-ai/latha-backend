// ComplaintBook page serving — same gated pattern as GodownBook: '/crm' is
// the small public login shell; '/crm/app' hands over the full application
// only to a browser whose crmsession cookie maps to a valid session in the
// existing complaints sessions table. Reuses authService.requireSession, so
// the login/session machinery stays exactly the one complaints always had.
const path = require('path');
const { requireSession } = require('../services/authService');

const APP_DIR = path.join(__dirname, '..', 'app');

function cookieToken(req) {
  const m = String(req.headers.cookie || '').match(/(?:^|;\s*)crmsession=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function crmPages(db) {
  return {
    loginPage: async (req, res) => {
      try {
        const user = await requireSession(db, cookieToken(req));
        if (user) return res.redirect('/crm/app'); // already logged in
      } catch (e) {}
      res.sendFile(path.join(APP_DIR, 'crm-login.html'));
    },
    appPage: async (req, res) => {
      try {
        const user = await requireSession(db, cookieToken(req));
        if (!user) return res.redirect('/crm');
        return res.sendFile(path.join(APP_DIR, 'complaints.html'));
      } catch (e) {
        return res.redirect('/crm');
      }
    },
  };
}

module.exports = crmPages;
