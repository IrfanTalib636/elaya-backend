const express = require('express');
const healthRoutes = require('./healthRoute');
const authRoute = require('./authRoute');
const customerRoute = require('./customerRoute');
const caseRoute = require('./caseRoute');
const appointmentRoute = require('./appointmentRoute');
const sessionRoute = require('./sessionRoute');
const elaycoinRoute = require('./elaycoinRoute');
const configRoute = require('./configRoute');
const studioRoute = require('./studioRoute');

const router = express.Router();

router.use(healthRoutes);
router.use('/auth', authRoute);
router.use('/customers', customerRoute);
router.use('/cases', caseRoute);
router.use('/appointments', appointmentRoute);
router.use('/sessions', sessionRoute);
router.use('/elaycoins', elaycoinRoute);
router.use('/config', configRoute);
router.use('/studio', studioRoute);

module.exports = router;
