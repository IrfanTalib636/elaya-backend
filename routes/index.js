const express = require('express');
const healthRoutes = require('./healthRoute');
const authRoute = require('./authRoute');
const caseRoute = require('./caseRoute');
const appointmentRoute = require('./appointmentRoute');
const sessionRoute = require('./sessionRoute');
const elaycoinRoute = require('./elaycoinRoute');
const configRoute = require('./configRoute');

const router = express.Router();

router.use(healthRoutes);
router.use('/auth', authRoute);
router.use('/cases', caseRoute);
router.use('/appointments', appointmentRoute);
router.use('/sessions', sessionRoute);
router.use('/elaycoins', elaycoinRoute);
router.use('/config', configRoute);

module.exports = router;
