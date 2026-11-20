const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const LOCAL_EMAIL_DIR = path.join(__dirname, '..', '.local-emails');

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

const buildPasswordResetEmail = ({ resetUrl, kind = 'reset' }) => {
    const isInvite = kind === 'invite';
    const subject = isInvite
        ? 'Elaya – Admin-Einladung'
        : 'Elaya – Passwort zurücksetzen';
    const text = isInvite
        ? [
              'Sie wurden als Elaya Admin eingeladen.',
              '',
              `Passwort festlegen (1 Stunde gültig): ${resetUrl}`,
              '',
              'Falls Sie diese Einladung nicht erwartet haben, ignorieren Sie diese E-Mail.',
          ].join('\n')
        : [
              'Sie haben eine Anfrage zum Zurücksetzen Ihres Elaya-Passworts gestellt.',
              '',
              `Link (1 Stunde gültig): ${resetUrl}`,
              '',
              'Falls Sie diese Anfrage nicht gestellt haben, ignorieren Sie diese E-Mail.',
          ].join('\n');

    const html = isInvite
        ? `
        <p>Sie wurden als Elaya Admin eingeladen.</p>
        <p><a href="${resetUrl}">Passwort festlegen</a></p>
        <p>Der Link ist 1 Stunde gültig.</p>
        <p>Falls Sie diese Einladung nicht erwartet haben, ignorieren Sie diese E-Mail.</p>
    `.trim()
        : `
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
            connectionTimeout: 12_000,
            greetingTimeout: 12_000,
            socketTimeout: 20_000,
        });
    }

    return smtpTransporter;
};

const safeFilePart = (value) =>
    String(value || 'mail')
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'mail';

/** Console provider: log + write HTML preview under .local-emails/ for local inspection. */
const writeConsoleEmailPreview = ({ to, subject, text, html, consoleLabel }) => {
    console.log(`[emailService] ${consoleLabel} (console provider — not sent to inbox)`);
    console.log(`  To: ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Text:\n${text}`);

    try {
        fs.mkdirSync(LOCAL_EMAIL_DIR, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filePath = path.join(
            LOCAL_EMAIL_DIR,
            `${stamp}_${safeFilePart(consoleLabel)}_${safeFilePart(to)}.html`,
        );
        const preview = `<!doctype html>
<html><head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:640px;margin:24px auto;padding:0 16px;">
  <p style="color:#666;font-size:13px;border-bottom:1px solid #ddd;padding-bottom:12px;">
    <strong>Dev preview</strong> (EMAIL_PROVIDER=console)<br/>
    To: ${to}<br/>
    Subject: ${subject}
  </p>
  ${html || `<pre>${text}</pre>`}
</body></html>`;
        fs.writeFileSync(filePath, preview, 'utf8');
        console.log(`  Preview: ${filePath}`);
        return filePath;
    } catch (err) {
        console.error('[emailService] could not write local email preview:', err.message);
        return null;
    }
};

const deliverEmail = async ({ to, subject, text, html, consoleLabel }) => {
    const config = getEmailConfig();

    if (config.provider === 'console') {
        writeConsoleEmailPreview({ to, subject, text, html, consoleLabel });
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

const sendPasswordResetEmail = async ({ to, resetUrl, kind = 'reset' }) => {
    const { subject, text, html } = buildPasswordResetEmail({ resetUrl, kind });
    await deliverEmail({
        to,
        subject,
        text,
        html,
        consoleLabel: 'Password reset email',
    });
};

const buildStudioRegistrationEmail = ({ firma, studioCode }) => {
    const subject = 'Willkommen bei ELAYA – dein Studio-Code';
    const text = [
        'Willkommen bei ELAYA',
        '',
        `Hallo${firma ? ` ${firma}` : ''},`,
        '',
        'Deine Studio-Registrierung ist erfolgreich eingegangen.',
        '',
        'Dein persönlicher ELAYA Studio-Code lautet:',
        studioCode,
        '',
        'Du kannst diesen Code mit deinen Kunden teilen. Wenn sie ELAYA herunterladen und diesen Code bei der Registrierung eingeben, werden sie automatisch deinem Studio zugeordnet.',
        '',
        'Hinweis: Der Code wird für Kunden erst nutzbar, sobald ELAYA / Super Admin dein Studio freigeschaltet hat.',
        '',
        '— ELAYA',
    ].join('\n');

    const html = `
        <h2 style="margin:0 0 12px;">Willkommen bei ELAYA</h2>
        <p>Hallo${firma ? ` <strong>${firma}</strong>` : ''},</p>
        <p>Deine Studio-Registrierung ist erfolgreich eingegangen.</p>
        <p>Dein persönlicher ELAYA Studio-Code lautet:</p>
        <p style="font-size:22px;font-weight:700;letter-spacing:0.04em;margin:12px 0;">${studioCode}</p>
        <p>Du kannst diesen Code mit deinen Kunden teilen. Wenn sie ELAYA herunterladen und diesen Code bei der Registrierung eingeben, werden sie automatisch deinem Studio zugeordnet.</p>
        <p><em>Hinweis: Der Code wird für Kunden erst nutzbar, sobald ELAYA / Super Admin dein Studio freigeschaltet hat.</em></p>
        <p>— ELAYA</p>
    `.trim();

    return { subject, text, html };
};

const sendStudioRegistrationEmail = async ({ to, firma, studioCode }) => {
    const { subject, text, html } = buildStudioRegistrationEmail({ firma, studioCode });
    await deliverEmail({
        to,
        subject,
        text,
        html,
        consoleLabel: 'Studio registration email',
    });
};

const buildStudioActivatedEmail = ({ firma, studioCode }) => {
    const subject = 'ELAYA – dein Studio ist freigeschaltet';
    const text = [
        'Dein Studio ist aktiv',
        '',
        `Hallo${firma ? ` ${firma}` : ''},`,
        '',
        'Gute Nachrichten: Dein Studio wurde von ELAYA freigeschaltet und ist jetzt aktiv.',
        '',
        'Dein persönlicher ELAYA Studio-Code lautet:',
        studioCode,
        '',
        'Kunden können diesen Code bei der Registrierung eingeben und werden automatisch deinem Studio zugeordnet.',
        '',
        '— ELAYA',
    ].join('\n');

    const html = `
        <h2 style="margin:0 0 12px;">Dein Studio ist aktiv</h2>
        <p>Hallo${firma ? ` <strong>${firma}</strong>` : ''},</p>
        <p>Gute Nachrichten: Dein Studio wurde von ELAYA freigeschaltet und ist jetzt aktiv.</p>
        <p>Dein persönlicher ELAYA Studio-Code lautet:</p>
        <p style="font-size:22px;font-weight:700;letter-spacing:0.04em;margin:12px 0;">${studioCode}</p>
        <p>Kunden können diesen Code bei der Registrierung eingeben und werden automatisch deinem Studio zugeordnet.</p>
        <p>— ELAYA</p>
    `.trim();

    return { subject, text, html };
};

const sendStudioActivatedEmail = async ({ to, firma, studioCode }) => {
    const { subject, text, html } = buildStudioActivatedEmail({ firma, studioCode });
    await deliverEmail({
        to,
        subject,
        text,
        html,
        consoleLabel: 'Studio activated email',
    });
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
    sendStudioRegistrationEmail,
    sendStudioActivatedEmail,
    buildResetPasswordUrl,
};
