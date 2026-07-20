const Customer = require('../models/customerModel');
const { USER_ROLES, AKQUISE_QUELLE } = require('../config/constants');
const ApiError = require('./ApiError');

const STUDIO_ROLES = [USER_ROLES.STUDIO_ADMIN, USER_ROLES.STUDIO_STAFF];
const ADMIN_ROLES = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.DEVELOPER];

/** ObjectId or populated doc → hex string */
const refId = (ref) => {
    if (!ref) return null;
    if (typeof ref === 'string') return ref;
    if (ref._id) return ref._id.toString();
    return ref.toString();
};

const isCustomer = (role) => role === USER_ROLES.CUSTOMER;
const isStudio = (role) => STUDIO_ROLES.includes(role);
const isAdmin = (role) => ADMIN_ROLES.includes(role);
const canManageSessions = (role) => isStudio(role) || isAdmin(role);

/**
 * Shared Case Layer — studio relation to a customer.
 * - aktuell: assigned here, never transferred in
 * - transferiert_ein: assigned here via Firmenwechsel (full Akte + coins)
 * - transferiert_aus: was here, now at another studio (own cases read-only)
 * - none: no relation
 */
const resolveStudioCustomerRelation = (studioId, customer) => {
    const sid = refId(studioId);
    const aktuelle = refId(customer.aktuelle_firma_id);
    const history = customer.firma_history || [];

    if (aktuelle === sid) {
        const prior = history.filter((h) => refId(h.firma_id) && refId(h.firma_id) !== sid);
        const transferredIn =
            customer.akquise_quelle === AKQUISE_QUELLE.STUDIO_WECHSEL || prior.length > 0;
        if (transferredIn) {
            const lastPrior = [...prior].sort((a, b) => {
                const ta = a.bis ? new Date(a.bis).getTime() : 0;
                const tb = b.bis ? new Date(b.bis).getTime() : 0;
                return tb - ta;
            })[0];
            return {
                wechsel_status: 'transferiert_ein',
                is_current: true,
                read_only: false,
                vorheriges_studio_id: lastPrior ? refId(lastPrior.firma_id) : null,
                transferiert_am: lastPrior?.bis ?? null,
            };
        }
        return {
            wechsel_status: 'aktuell',
            is_current: true,
            read_only: false,
            vorheriges_studio_id: null,
            transferiert_am: null,
        };
    }

    const wasHere = history.some((h) => refId(h.firma_id) === sid);
    if (wasHere) {
        const own = history.find((h) => refId(h.firma_id) === sid);
        return {
            wechsel_status: 'transferiert_aus',
            is_current: false,
            read_only: true,
            vorheriges_studio_id: null,
            transferiert_am: own?.bis ?? null,
            aktuelle_firma_id: aktuelle,
        };
    }

    return {
        wechsel_status: 'none',
        is_current: false,
        read_only: true,
        vorheriges_studio_id: null,
        transferiert_am: null,
    };
};

/** Customer IDs currently assigned to this studio (for Shared Case Layer queries). */
const customerIdsAtStudio = async (studioId) => {
    const ids = await Customer.find({ aktuelle_firma_id: studioId }).distinct('_id');
    return ids;
};

/**
 * Studio may access a case if:
 * - case.studio === their studio (originating), OR
 * - customer.aktuelle_firma_id === their studio (transferred in — full medical history)
 */
const assertCaseAccess = async (user, caseDoc) => {
    if (isAdmin(user.role)) {
        return { transferiert: false, read_only: false };
    }

    if (isCustomer(user.role)) {
        if (refId(caseDoc.customer) !== refId(user.customer_id)) {
            throw new ApiError(403, 'You do not have access to this case');
        }
        return { transferiert: false, read_only: false };
    }

    if (isStudio(user.role)) {
        const studioId = refId(user.studio_id);
        if (refId(caseDoc.studio) === studioId) {
            const customer = await Customer.findById(caseDoc.customer)
                .select('aktuelle_firma_id firma_history akquise_quelle')
                .lean();
            const relation = customer
                ? resolveStudioCustomerRelation(studioId, customer)
                : { read_only: false, is_current: true };
            return {
                transferiert: false,
                read_only: !!relation.read_only,
            };
        }

        const customer = await Customer.findById(caseDoc.customer)
            .select('aktuelle_firma_id firma_history akquise_quelle')
            .lean();
        if (customer && refId(customer.aktuelle_firma_id) === studioId) {
            return { transferiert: true, read_only: false };
        }

        throw new ApiError(403, 'You do not have access to this case');
    }

    throw new ApiError(403, 'You do not have permission for this action');
};

const assertCaseWriteAccess = async (user, caseDoc) => {
    const access = await assertCaseAccess(user, caseDoc);
    if (access.read_only) {
        throw new ApiError(
            403,
            'Customer transferred to another studio — this case is read-only'
        );
    }
    return access;
};

const assertSessionAccess = async (user, session) => {
    if (isAdmin(user.role)) {
        return { transferiert: false, read_only: false };
    }

    if (isCustomer(user.role)) {
        if (refId(session.customer) !== refId(user.customer_id)) {
            throw new ApiError(403, 'You do not have access to this session');
        }
        return { transferiert: false, read_only: false };
    }

    if (isStudio(user.role)) {
        const studioId = refId(user.studio_id);
        if (refId(session.studio) === studioId) {
            const customer = await Customer.findById(session.customer)
                .select('aktuelle_firma_id firma_history akquise_quelle')
                .lean();
            const relation = customer
                ? resolveStudioCustomerRelation(studioId, customer)
                : { read_only: false };
            return { transferiert: false, read_only: !!relation.read_only };
        }

        const customer = await Customer.findById(session.customer)
            .select('aktuelle_firma_id')
            .lean();
        if (customer && refId(customer.aktuelle_firma_id) === studioId) {
            return { transferiert: true, read_only: false };
        }

        throw new ApiError(403, 'You do not have access to this session');
    }

    throw new ApiError(403, 'You do not have permission for this action');
};

const buildScopedFilter = (user, baseFilter = {}) => {
    const filter = { ...baseFilter };

    if (isCustomer(user.role)) {
        filter.customer = user.customer_id;
    } else if (isStudio(user.role)) {
        filter.studio = user.studio_id;
    } else if (!isAdmin(user.role)) {
        throw new ApiError(403, 'You do not have permission for this action');
    }

    return filter;
};

/**
 * Studio list filter: own studio records OR records for customers currently assigned here.
 */
const buildStudioSharedFilter = async (studioId, baseFilter = {}) => {
    const assignedCustomerIds = await customerIdsAtStudio(studioId);
    return {
        ...baseFilter,
        $or: [{ studio: studioId }, { customer: { $in: assignedCustomerIds } }],
    };
};

module.exports = {
    refId,
    isCustomer,
    isStudio,
    isAdmin,
    canManageSessions,
    resolveStudioCustomerRelation,
    customerIdsAtStudio,
    assertCaseAccess,
    assertCaseWriteAccess,
    assertSessionAccess,
    buildScopedFilter,
    buildStudioSharedFilter,
};
