const mongoose = require('mongoose');
const { AKQUISE_QUELLE, PIPELINE_STUFE } = require('../config/constants');
const {
    CUSTOMER_FUNNEL_STAGE,
    CUSTOMER_FUNNEL_STAGE_ORDER,
} = require('../config/platformCrmConfig');

const elaycoinTransactionSchema = new mongoose.Schema(
    {
        situationKey: { type: String, default: '' },
        label: { type: String, trim: true, default: '' },
        kat: { type: String, trim: true, default: '' },
        coins: { type: Number, required: true },
        typ: {
            type: String,
            enum: ['reward', 'malus', 'verfall'],
            default: 'reward',
        },
        datum: { type: Date, default: Date.now },
        case_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Case', default: null },
        session_id: { type: String, default: null },
        appointment_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
        kontext: { type: mongoose.Schema.Types.Mixed, default: null },
        herkunft_studio_id: { type: String, default: '' },
        herkunft_studio_name: { type: String, default: '' },
    },
    { _id: true }
);

const firmaHistorySchema = new mongoose.Schema(
    {
        firma_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Studio', required: true },
        von: { type: Date, required: true },
        bis: { type: Date, default: null },
        grund: { type: String, default: '' },
    },
    { _id: false }
);

const customerSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
            index: true,
        },
        vorname: {
            type: String,
            required: [true, 'vorname is required'],
            trim: true,
        },
        nachname: {
            type: String,
            required: [true, 'nachname is required'],
            trim: true,
        },
        email: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
            index: true,
        },
        telefon: {
            type: String,
            required: [true, 'telefon is required'],
            trim: true,
        },
        geburtsdatum: {
            type: Date,
            default: null,
        },
        strasse: {
            type: String,
            trim: true,
            default: '',
        },
        plz: {
            type: String,
            trim: true,
            default: '',
        },
        ort: {
            type: String,
            trim: true,
            default: '',
        },
        land: {
            type: String,
            trim: true,
            default: 'Schweiz',
        },
        akquise_quelle: {
            type: String,
            enum: Object.values(AKQUISE_QUELLE),
            required: true,
            index: true,
        },
        elaycoins: {
            balance: { type: Number, default: 0, min: 0 },
            transactions: { type: [elaycoinTransactionSchema], default: [] },
            gesendete_warnungen: { type: [String], default: [] },
        },
        aktuelle_firma_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Studio',
            required: true,
            index: true,
        },
        firma_history: {
            type: [firmaHistorySchema],
            default: [],
        },
        registriert_am: {
            type: Date,
            default: Date.now,
        },
        pipeline_stufe: {
            type: String,
            default: PIPELINE_STUFE.NEU,
            index: true,
        },
        stufe_seit: {
            type: Date,
            default: Date.now,
        },
        notizen: {
            type: String,
            default: '',
        },
        platform_crm: {
            funnel_stage: {
                type: String,
                enum: CUSTOMER_FUNNEL_STAGE_ORDER,
                default: CUSTOMER_FUNNEL_STAGE.REGISTERED,
                index: true,
            },
            stage_entered_at: {
                type: Date,
                default: Date.now,
            },
            last_activity_at: {
                type: Date,
                default: Date.now,
                index: true,
            },
            cases_count: {
                type: Number,
                default: 0,
                min: 0,
            },
            has_draft_case: {
                type: Boolean,
                default: false,
            },
            has_open_appointment: {
                type: Boolean,
                default: false,
            },
            first_session_at: {
                type: Date,
                default: null,
            },
            completed_at: {
                type: Date,
                default: null,
            },
        },
        automatisierungen_log: {
            type: [
                {
                    rule_id: { type: String, required: true },
                    kontext_id: { type: String, default: null },
                    sent_at: { type: Date, default: Date.now },
                    naechste_erlaubt_am: { type: Date, default: null },
                },
            ],
            default: [],
        },
        
        medical_clearance: {
            status: {
                type: String,
                enum: ['not_required', 'required', 'pending_review', 'verified', 'rejected'],
                default: 'not_required',
            },
            reasons: {
                type: [
                    {
                        condition_key: { type: String, default: '' },
                        med_key: { type: String, default: '' },
                        source: { type: String, default: 'pre_session' },
                        label: { type: String, default: '' },
                    },
                ],
                default: [],
            },
            documents: {
                type: [
                    {
                        file_id: {
                            type: mongoose.Schema.Types.ObjectId,
                            ref: 'FileAsset',
                        },
                        uploaded_at: { type: Date, default: Date.now },
                        uploaded_by: {
                            type: mongoose.Schema.Types.ObjectId,
                            ref: 'User',
                        },
                        original_name: { type: String, default: '' },
                        mime_type: { type: String, default: '' },
                        /** Central doc linked to customer + case (not stored twice). */
                        document_type: {
                            type: String,
                            default: 'medical_clearance',
                        },
                        case_id: {
                            type: mongoose.Schema.Types.ObjectId,
                            ref: 'Case',
                            default: null,
                        },
                        studio_id: {
                            type: mongoose.Schema.Types.ObjectId,
                            ref: 'Studio',
                            default: null,
                        },
                        medication_category: { type: String, default: '' },
                        review_status: {
                            type: String,
                            enum: ['pending', 'accepted', 'rejected'],
                            default: 'pending',
                        },
                        reviewed_by: {
                            type: mongoose.Schema.Types.ObjectId,
                            ref: 'User',
                            default: null,
                        },
                        reviewed_at: { type: Date, default: null },
                        review_comment: { type: String, default: '' },
                    },
                ],
                default: [],
            },
            overrides: {
                type: [
                    {
                        condition_key: { type: String, default: '' },
                        med_key: { type: String, default: '' },
                        accepted_at: { type: Date, default: null },
                        accepted_by: {
                            type: mongoose.Schema.Types.ObjectId,
                            ref: 'User',
                            default: null,
                        },
                        note: { type: String, default: '' },
                        revoked_at: { type: Date, default: null },
                        case_id: {
                            type: mongoose.Schema.Types.ObjectId,
                            ref: 'Case',
                            default: null,
                        },
                    },
                ],
                default: [],
            },
            required_since: { type: Date, default: null },
            verified_at: { type: Date, default: null },
            verified_by: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User',
                default: null,
            },
            verified_note: { type: String, default: '' },
            rejected_at: { type: Date, default: null },
            rejected_by: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User',
                default: null,
            },
            rejected_reason: { type: String, default: '' },
            antibiotic_checks: {
                type: [
                    {
                        appointment_id: {
                            type: mongoose.Schema.Types.ObjectId,
                            ref: 'Appointment',
                        },
                        asked_at: { type: Date, default: Date.now },
                        answered_at: { type: Date, default: null },
                        still_on_antibiotics: { type: Boolean, default: null },
                        not_fully_recovered: { type: Boolean, default: null },
                        studio_notified: { type: Boolean, default: false },
                    },
                ],
                default: [],
            },
        },
    },
    {
        timestamps: true,
    }
);

customerSchema.index({ nachname: 1, vorname: 1 });
customerSchema.index({ aktuelle_firma_id: 1, pipeline_stufe: 1 });
customerSchema.index({
    'platform_crm.funnel_stage': 1,
    'platform_crm.last_activity_at': -1,
});
customerSchema.index({ 'platform_crm.stage_entered_at': 1 });

const Customer = mongoose.model('Customer', customerSchema);

module.exports = Customer;
