/**
 * App Links / Universal Links configuration for the customer mobile app.
 *
 * Required for:
 *   GET /.well-known/apple-app-site-association  (iOS)
 *   GET /.well-known/assetlinks.json             (Android)
 *
 * Env (see .env.example):
 *   APP_LINKS_DOMAIN                 e.g. app.elaya.ch
 *   IOS_TEAM_ID                      Apple Developer Team ID
 *   IOS_BUNDLE_ID                    default com.elayaMobile.app
 *   ANDROID_PACKAGE_NAME             default com.elayaMobile.app
 *   ANDROID_SHA256_CERT_FINGERPRINTS comma-separated SHA-256 cert fingerprints
 */

const DEFAULT_IOS_BUNDLE = 'com.elayaMobile.app';
const DEFAULT_ANDROID_PACKAGE = 'com.elayaMobile.app';

const getAppLinksConfig = () => {
    const domain = (process.env.APP_LINKS_DOMAIN || 'app.elaya.ch').trim().toLowerCase();
    const iosTeamId = (process.env.IOS_TEAM_ID || '').trim();
    const iosBundleId = (process.env.IOS_BUNDLE_ID || DEFAULT_IOS_BUNDLE).trim();
    const androidPackage = (process.env.ANDROID_PACKAGE_NAME || DEFAULT_ANDROID_PACKAGE).trim();
    const androidFingerprints = (process.env.ANDROID_SHA256_CERT_FINGERPRINTS || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

    return {
        domain,
        iosTeamId,
        iosBundleId,
        androidPackage,
        androidFingerprints,
        isConfigured: Boolean(iosTeamId && androidFingerprints.length > 0),
        // Prefer Railway / env domain; never invent a private domain silently in prod.
        resetBase: process.env.APP_CUSTOMER_RESET_URL || `https://${domain}/reset-password`,
    };
};

const buildAppleAppSiteAssociation = () => {
    const { iosTeamId, iosBundleId } = getAppLinksConfig();

    return {
        applinks: {
            apps: [],
            details: [
                {
                    appID: `${iosTeamId}.${iosBundleId}`,
                    paths: ['/reset-password', '/reset-password/*'],
                },
            ],
        },
    };
};

const buildAssetLinks = () => {
    const { androidPackage, androidFingerprints } = getAppLinksConfig();

    return [
        {
            relation: ['delegate_permission/common.handle_all_urls'],
            target: {
                namespace: 'android_app',
                package_name: androidPackage,
                sha256_cert_fingerprints: androidFingerprints,
            },
        },
    ];
};

const getCustomerResetUrlBase = () => {
    const { resetBase, domain } = getAppLinksConfig();
    return resetBase || `https://${domain}/reset-password`;
};

module.exports = {
    getAppLinksConfig,
    buildAppleAppSiteAssociation,
    buildAssetLinks,
    getCustomerResetUrlBase,
};
