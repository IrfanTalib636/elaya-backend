const mongoose = require('mongoose');

/**
 * Studio partner lead statuses — prototype parity (inkderm CRM).
 * Flow: lead → contract_sent → contract_signed → onboarding → active
 * Also: deactivated | rejected
 * Legacy `contract` is accepted and treated as contract_sent.
 */
const STUDIO_LEAD_STATUS = {
    LEAD: 'lead',
    CONTRACT: 'contract', // legacy
    CONTRACT_SENT: 'contract_sent',
    CONTRACT_SIGNED: 'contract_signed',
    ONBOARDING: 'onboarding',
    ACTIVE: 'active',
    DEACTIVATED: 'deactivated',
    REJECTED: 'rejected',
};

const LEAD_AKQUISE = ['website_demo', 'website_direkt', 'aussendienst', 'other'];
const LEAD_PAKETE = ['STARTER', 'PRO', 'NETWORK', 'basic', 'professional', 'enterprise'];
const LEAD_PAYMENT = ['STRIPE_KARTE', 'RECHNUNG', 'none'];

const normalizeLeadStatus = (status) => {
    if (status === STUDIO_LEAD_STATUS.CONTRACT) return STUDIO_LEAD_STATUS.CONTRACT_SENT;
    return status || STUDIO_LEAD_STATUS.LEAD;
};

const vertragSchema = new mongoose.Schema(
    {
        status: {
            type: String,
            enum: ['ENTWURF', 'VERSENDET', 'UNTERSCHRIEBEN'],
            default: 'ENTWURF',
        },
        versendet_am: { type: Date, default: null },
        unterschrieben_am: { type: Date, default: null },
        dokument_referenz: { type: String, default: '', trim: true, maxlength: 300 },
        signatur_methode: { type: String, default: '', trim: true, maxlength: 80 },
    },
    { _id: false }
);

const aboSchema = new mongoose.Schema(
    {
        intervall: { type: String, default: 'monatlich', trim: true, maxlength: 40 },
        laufzeit_ende: { type: Date, default: null },
        kuendbar: { type: Boolean, default: true },
        auto_verlaengerung: { type: Boolean, default: true },
        zahlungsweg: {
            type: String,
            enum: LEAD_PAYMENT,
            default: 'none',
        },
        gratismonat_aktiv: { type: Boolean, default: false },
        testphase_ende: { type: Date, default: null },
    },
    { _id: false }
);

/**
 * Platform CRM — studio partner leads before they become bookable studios.
 */
const studioLeadSchema = new mongoose.Schema(
    {
        firma: { type: String, required: true, trim: true, maxlength: 200 },
        kontakt_name: { type: String, default: '', trim: true, maxlength: 120 },
        email: { type: String, default: '', trim: true, lowercase: true, maxlength: 200 },
        telefon: { type: String, default: '', trim: true, maxlength: 60 },
        ort: { type: String, default: '', trim: true, maxlength: 120 },
        adresse: { type: String, default: '', trim: true, maxlength: 300 },
        status: {
            type: String,
            enum: Object.values(STUDIO_LEAD_STATUS),
            default: STUDIO_LEAD_STATUS.LEAD,
            index: true,
        },
        akquise_weg: {
            type: String,
            enum: LEAD_AKQUISE,
            default: 'other',
        },
        gewuenschtes_paket: {
            type: String,
            enum: LEAD_PAKETE,
            default: 'STARTER',
        },
        demo_termin_gebucht: { type: Boolean, default: false },
        demo_termin_datum: { type: Date, default: null },
        vertrag: {
            type: vertragSchema,
            default: () => ({}),
        },
        abo: {
            type: aboSchema,
            default: () => ({}),
        },
        notiz: { type: String, default: '', trim: true, maxlength: 2000 },
        created_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    { timestamps: true }
);

studioLeadSchema.index({ createdAt: -1 });
studioLeadSchema.index({ firma: 1 });

module.exports = {
    StudioLead: mongoose.model('StudioLead', studioLeadSchema),
    STUDIO_LEAD_STATUS,
    LEAD_AKQUISE,
    LEAD_PAKETE,
    LEAD_PAYMENT,
    normalizeLeadStatus,
};
