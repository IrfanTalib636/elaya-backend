/**
 * One-time production bootstrap for the first super admin.
 *
 * Run manually after deploy — never on server startup.
 * Refuses to run if a super admin already exists.
 *
 * Required env:
 *   BOOTSTRAP_ADMIN_ENABLED=true
 *   BOOTSTRAP_ADMIN_EMAIL
 *   BOOTSTRAP_ADMIN_PASSWORD
 */
require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/userModel');
const { USER_ROLES, USER_STATUS } = require('../config/constants');

const MIN_PASSWORD_LENGTH = 12;

const fail = (message) => {
    console.error(`Bootstrap failed: ${message}`);
    process.exit(1);
};

const bootstrapAdmin = async () => {
    if (process.env.BOOTSTRAP_ADMIN_ENABLED !== 'true') {
        fail(
            'Set BOOTSTRAP_ADMIN_ENABLED=true to confirm this intentional one-time run.'
        );
    }

    const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        fail('BOOTSTRAP_ADMIN_EMAIL must be a valid email address.');
    }

    if (!password || password.length < MIN_PASSWORD_LENGTH) {
        fail(`BOOTSTRAP_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }

    await connectDB();

    const existingSuperAdminCount = await User.countDocuments({
        role: USER_ROLES.SUPER_ADMIN,
    });

    if (existingSuperAdminCount > 0) {
        fail(
            'A super admin already exists. Use the admin dashboard or a controlled DB procedure to manage admins — bootstrap is one-time only.'
        );
    }

    const existingEmail = await User.findOne({ email });

    if (existingEmail) {
        fail(
            `Email ${email} is already registered with role "${existingEmail.role}". Use a different BOOTSTRAP_ADMIN_EMAIL.`
        );
    }

    await User.create({
        email,
        password,
        role: USER_ROLES.SUPER_ADMIN,
        status: USER_STATUS.AKTIV,
    });

    console.log(`Super admin bootstrapped: ${email}`);
    console.log('Remove BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD, and BOOTSTRAP_ADMIN_ENABLED from production env vars.');
    process.exit(0);
};

bootstrapAdmin().catch((err) => {
    console.error('Bootstrap error:', err.message);
    process.exit(1);
});
