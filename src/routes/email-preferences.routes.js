const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');
const { getEmailPreferences, updateEmailPreferences } = require('../services/email-preferences.service');
const router = express.Router();

for (const method of ['get', 'patch']) {
  router[method]('/', auth, async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try {
      const preferences = method === 'get' ? await getEmailPreferences(db, req.userId)
        : await updateEmailPreferences(db, req.userId, req.body);
      return res.json(preferences);
    } catch (error) {
      if (error instanceof ApiError) return next(error);
      console.error('[budget-email] PREFERENCES_DATABASE_FAILED');
      return next(new ApiError(503, 'Nao foi possivel acessar suas preferencias. Tente novamente.', 'EMAIL_PREFERENCES_UNAVAILABLE'));
    }
  });
}
module.exports = router;
