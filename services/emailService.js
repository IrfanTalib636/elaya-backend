const nodemailer = require('nodemailer');

const getEmailConfig = () => ({
    provider: (process.env.EMAIL_PROVIDER || 'console').toLowerCase(),
    from: process.env.EMAIL_FROM || 'noreply@elaya.ch',
    frontendUrl: (process.env.APP_FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, ''),
    smtp: {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 465),
        secure: process.env.SMTP_SECURE !== 'false',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    },
});

const buildPasswordResetEmail = ({ resetUrl }) => {
    const subject = 'Elaya – Passwort zurücksetzen';
    const text = [
        'Sie haben eine Anfrage zum Zurücksetzen Ihres Elaya-Passworts gestellt.',
        '',
        `Link (1 Stunde gültig): ${resetUrl}`,
        '',
        'Falls Sie diese Anfrage nicht gestellt haben, ignorieren Sie diese E-Mail.',
    ].join('\n');

    const html = `
        <p>Sie haben eine Anfrage zum Zurücksetzen Ihres Elaya-Passworts gestellt.</p>
        <p><a href="${resetUrl}">Passwort zurücksetzen</a></p>
        <p>Der Link ist 1 Stunde gültig.</p>
        <p>Falls Sie diese Anfrage nicht gestellt haben, ignorieren Sie diese E-Mail.</p>
    `.trim();

    return { subject, text, html };
};

let smtpTransporter = null;

const getSmtpTransporter = (config) => {
    if (!smtpTransporter) {
        smtpTransporter = nodemailer.createTransport({
            host: config.smtp.host,
            port: config.smtp.port,
            secure: config.smtp.secure,
            auth: config.smtp.auth,
        });
    }

    return smtpTransporter;
};

const sendPasswordResetEmail = async ({ to, resetUrl }) => {
    const config = getEmailConfig();
    const { subject, text, html } = buildPasswordResetEmail({ resetUrl });

    if (config.provider === 'console') {
        console.log('[emailService] Password reset email (console provider)');
        console.log(`  To: ${to}`);
        console.log(`  Subject: ${subject}`);
        console.log(`  Reset URL: ${resetUrl}`);
        return;
    }

    if (config.provider === 'smtp') {
        if (!config.smtp.host || !config.smtp.auth.user || !config.smtp.auth.pass) {
            throw new Error('SMTP is not configured (SMTP_HOST, SMTP_USER, SMTP_PASS required)');
        }

        const transporter = getSmtpTransporter(config);
        await transporter.sendMail({
            from: config.from,
            to,
            subject,
            text,
            html,
        });
        return;
    }

    throw new Error(`Unknown EMAIL_PROVIDER: ${config.provider}`);
};

const buildResetPasswordUrl = (portal, rawToken) => {
    const config = getEmailConfig();
    const token = encodeURIComponent(rawToken);

    if (portal === 'admin') {
        return `${config.frontendUrl}/admin/reset-password?token=${token}`;
    }

    if (portal === 'customer') {
        const { getCustomerResetUrlBase } = require('../config/appLinks');
        const base = getCustomerResetUrlBase();
        const sep = base.includes('?') ? '&' : '?';
        return `${base}${sep}token=${token}`;
    }

    return `${config.frontendUrl}/studio/reset-password?token=${token}`;
};

module.exports = {
    sendPasswordResetEmail,
    buildResetPasswordUrl,
};
