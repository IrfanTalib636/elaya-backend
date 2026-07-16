const express = require('express');
const {
    getAppLinksConfig,
    buildAppleAppSiteAssociation,
    buildAssetLinks,
} = require('../config/appLinks');

const router = express.Router();

const sendJson = (res, payload) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).send(JSON.stringify(payload));
};

const sendAppleAppSiteAssociation = (req, res) => {
    const { isConfigured } = getAppLinksConfig();

    if (!isConfigured) {
        return res.status(503).json({
            success: false,
            message:
                'App Links not configured. Set IOS_TEAM_ID and ANDROID_SHA256_CERT_FINGERPRINTS on the server.',
        });
    }

    return sendJson(res, buildAppleAppSiteAssociation());
};

const sendAssetLinks = (req, res) => {
    const { isConfigured } = getAppLinksConfig();

    if (!isConfigured) {
        return res.status(503).json({
            success: false,
            message:
                'App Links not configured. Set IOS_TEAM_ID and ANDROID_SHA256_CERT_FINGERPRINTS on the server.',
        });
    }

    return sendJson(res, buildAssetLinks());
};

/**
 * iOS Universal Links verification file.
 * https://{APP_LINKS_DOMAIN}/.well-known/apple-app-site-association
 */
router.get('/apple-app-site-association', sendAppleAppSiteAssociation);

/**
 * Android App Links verification file.
 * https://{APP_LINKS_DOMAIN}/.well-known/assetlinks.json
 */
router.get('/assetlinks.json', sendAssetLinks);

module.exports = router;
module.exports.sendAppleAppSiteAssociation = sendAppleAppSiteAssociation;
module.exports.sendAssetLinks = sendAssetLinks;
