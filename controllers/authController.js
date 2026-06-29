const User = require('../models/userModel');
const Customer = require('../models/customerModel');
const Studio = require('../models/studioModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const {
    issueAuthTokens,
    clearRefreshTokenCookie,
    revokeRefreshToken,
    findValidRefreshToken,
} = require('../utils/generateTokenAndSetCookies');
const {
    USER_ROLES,
    USER_STATUS,
    STUDIO_STATUS,
    AKQUISE_QUELLE,
    PIPELINE_STUFE,
} = require('../config/constants');

const registerCustomer = asyncHandler(async (req, res) => {
    const {
        vorname,
        nachname,
        email,
        telefon,
        password,
        studio_code,
        geburtsdatum,
        strasse,
        plz,
        ort,
        land,
        akquise_quelle,
    } = req.body;

    const studio = await Studio.findOne({
        studio_code: studio_code.toUpperCase(),
        status: STUDIO_STATUS.AKTIV,
    });

    if (!studio) {
        throw new ApiError(404, 'Studio not found or not active for this studio_code');
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
        throw new ApiError(409, 'email already registered');
    }

    let user = null;
    let customer = null;

    try {
        user = await User.create({
            email,
            password,
            role: USER_ROLES.CUSTOMER,
            status: USER_STATUS.AKTIV,
        });

        customer = await Customer.create({
            user: user._id,
            vorname,
            nachname,
            email,
            telefon,
            geburtsdatum: geburtsdatum ?? null,
            strasse,
            plz,
            ort,
            land,
            akquise_quelle: akquise_quelle ?? AKQUISE_QUELLE.STUDIO_EIGEN,
            elaycoins: { balance: 0, transactions: [] },
            aktuelle_firma_id: studio._id,
            firma_history: [
                {
                    firma_id: studio._id,
                    von: new Date(),
                    bis: null,
                    grund: 'registrierung',
                },
            ],
            registriert_am: new Date(),
            pipeline_stufe: PIPELINE_STUFE.NEU,
            stufe_seit: new Date(),
            notizen: '',
        });

        user.customer_id = customer._id;
        await user.save();
    } catch (error) {
        if (customer?._id) {
            await Customer.deleteOne({ _id: customer._id });
        }
        if (user?._id) {
            await User.deleteOne({ _id: user._id });
        }
        throw error;
    }

    const tokens = await issueAuthTokens({ user, res, req });

    res.status(201).json({
        success: true,
        message: 'Customer registered successfully',
        data: {
            accessToken: tokens.accessToken,
            expiresIn: tokens.expiresIn,
            user: {
                id: user._id,
                email: user.email,
                role: user.role,
                status: user.status,
            },
            customer: {
                id: customer._id,
                vorname: customer.vorname,
                nachname: customer.nachname,
                email: customer.email,
                telefon: customer.telefon,
                akquise_quelle: customer.akquise_quelle,
                aktuelle_firma_id: customer.aktuelle_firma_id,
                pipeline_stufe: customer.pipeline_stufe,
                registriert_am: customer.registriert_am,
            },
        },
    });
});

const registerStudio = asyncHandler(async (req, res) => {
    const { firma, studio_code, email, telefon, password, strasse, plz, ort, land, standorte } =
        req.body;

    const normalizedCode = studio_code.toUpperCase();

    const [existingUser, existingStudio] = await Promise.all([
        User.findOne({ email }),
        Studio.findOne({ studio_code: normalizedCode }),
    ]);

    if (existingUser) {
        throw new ApiError(409, 'email already registered');
    }

    if (existingStudio) {
        throw new ApiError(409, 'studio_code already exists');
    }

    let user = null;
    let studio = null;

    try {
        user = await User.create({
            email,
            password,
            role: USER_ROLES.STUDIO_ADMIN,
            status: USER_STATUS.AUSSTEHEND,
        });

        studio = await Studio.create({
            firma,
            studio_code: normalizedCode,
            email,
            telefon,
            strasse,
            plz,
            ort,
            land,
            status: STUDIO_STATUS.AUSSTEHEND,
            standorte,
            owner: user._id,
            notizen: '',
        });

        user.studio_id = studio._id;
        await user.save();
    } catch (error) {
        if (studio?._id) {
            await Studio.deleteOne({ _id: studio._id });
        }
        if (user?._id) {
            await User.deleteOne({ _id: user._id });
        }
        throw error;
    }

    res.status(201).json({
        success: true,
        message: 'Studio registration submitted — awaiting admin approval',
        data: {
            user: {
                id: user._id,
                email: user.email,
                role: user.role,
                status: user.status,
            },
            studio: {
                id: studio._id,
                firma: studio.firma,
                studio_code: studio.studio_code,
                status: studio.status,
            },
        },
    });
});

const login = asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password');

    if (!user || !(await user.comparePassword(password))) {
        throw new ApiError(401, 'Invalid email or password');
    }

    if (user.status === USER_STATUS.GESPERRT) {
        throw new ApiError(403, 'Account is locked');
    }

    if (user.status === USER_STATUS.AUSSTEHEND) {
        throw new ApiError(403, 'Account pending approval');
    }

    if (user.role === USER_ROLES.STUDIO_ADMIN || user.role === USER_ROLES.STUDIO_STAFF) {
        const studio = await Studio.findById(user.studio_id);
        if (!studio || studio.status !== STUDIO_STATUS.AKTIV) {
            throw new ApiError(403, 'Studio is not active');
        }
    }

    await User.updateOne({ _id: user._id }, { last_login: new Date() });

    const tokens = await issueAuthTokens({ user, res, req });

    res.status(200).json({
        success: true,
        message: 'Login successful',
        data: {
            accessToken: tokens.accessToken,
            expiresIn: tokens.expiresIn,
            user: {
                id: user._id,
                email: user.email,
                role: user.role,
                status: user.status,
                studio_id: user.studio_id,
                customer_id: user.customer_id,
            },
        },
    });
});

const refresh = asyncHandler(async (req, res) => {
    const token = req.cookies.refreshToken;

    if (!token) {
        throw new ApiError(401, 'Refresh token not found');
    }

    const valid = await findValidRefreshToken(token);

    if (!valid) {
        clearRefreshTokenCookie(res);
        throw new ApiError(401, 'Invalid or expired refresh token');
    }

    const user = await User.findById(valid.decoded.userId);

    if (!user || user.status !== USER_STATUS.AKTIV) {
        clearRefreshTokenCookie(res);
        throw new ApiError(401, 'User not authorized');
    }

    valid.record.revoked_at = new Date();
    await valid.record.save();

    const tokens = await issueAuthTokens({ user, res, req });

    res.status(200).json({
        success: true,
        message: 'Token refreshed',
        data: {
            accessToken: tokens.accessToken,
            expiresIn: tokens.expiresIn,
        },
    });
});

const logout = asyncHandler(async (req, res) => {
    const token = req.cookies.refreshToken;

    if (token) {
        await revokeRefreshToken(token);
    }

    clearRefreshTokenCookie(res);

    res.status(200).json({
        success: true,
        message: 'Logged out successfully',
    });
});

const getMe = asyncHandler(async (req, res) => {
    const user = req.user;

    let profile = null;

    if (user.role === USER_ROLES.CUSTOMER && user.customer_id) {
        profile = await Customer.findById(user.customer_id).select('-__v');
    }

    if (
        (user.role === USER_ROLES.STUDIO_ADMIN || user.role === USER_ROLES.STUDIO_STAFF) &&
        user.studio_id
    ) {
        profile = await Studio.findById(user.studio_id).select('-__v');
    }

    res.status(200).json({
        success: true,
        data: {
            user: {
                id: user._id,
                email: user.email,
                role: user.role,
                status: user.status,
                studio_id: user.studio_id,
                customer_id: user.customer_id,
                last_login: user.last_login,
            },
            profile,
        },
    });
});

module.exports = {
    registerCustomer,
    registerStudio,
    login,
    refresh,
    logout,
    getMe,
};
