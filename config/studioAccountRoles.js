/**
 * Studio login account roles (separate from Staff Profile labels).
 * Auth still uses USER_ROLES.studio_admin | studio_staff;
 * granular rights live on user.studio_account_role.
 */
const STUDIO_ACCOUNT_ROLES = {
    OWNER: 'owner',
    MANAGER: 'manager',
    TREATMENT: 'treatment',
    RECEPTION: 'reception',
    READONLY: 'readonly',
};

const STUDIO_ACCOUNT_ROLE_LIST = Object.values(STUDIO_ACCOUNT_ROLES);

const STUDIO_ACCOUNT_ROLE_META = [
    {
        key: STUDIO_ACCOUNT_ROLES.OWNER,
        label: 'Studio Owner',
        description: 'Full studio control including team invites and billing',
    },
    {
        key: STUDIO_ACCOUNT_ROLES.MANAGER,
        label: 'Manager',
        description: 'Manage customers, sessions, appointments, and staff profiles',
    },
    {
        key: STUDIO_ACCOUNT_ROLES.TREATMENT,
        label: 'Treatment Staff',
        description: 'Document sessions and view assigned customers',
    },
    {
        key: STUDIO_ACCOUNT_ROLES.RECEPTION,
        label: 'Reception',
        description: 'Book appointments and manage front-desk workflows',
    },
    {
        key: STUDIO_ACCOUNT_ROLES.READONLY,
        label: 'Read Only',
        description: 'View studio data without write access',
    },
];

/** Permission keys checked by requireStudioPermission. */
const STUDIO_PERMISSIONS = {
    MANAGE_SETTINGS: 'manage_settings',
    MANAGE_TEAM_LOGINS: 'manage_team_logins',
    MANAGE_STAFF_PROFILES: 'manage_staff_profiles',
    MANAGE_SESSIONS: 'manage_sessions',
    MANAGE_APPOINTMENTS: 'manage_appointments',
    MANAGE_CUSTOMERS: 'manage_customers',
    VIEW_ONLY: 'view_only',
};

const ROLE_PERMISSIONS = {
    [STUDIO_ACCOUNT_ROLES.OWNER]: [
        STUDIO_PERMISSIONS.MANAGE_SETTINGS,
        STUDIO_PERMISSIONS.MANAGE_TEAM_LOGINS,
        STUDIO_PERMISSIONS.MANAGE_STAFF_PROFILES,
        STUDIO_PERMISSIONS.MANAGE_SESSIONS,
        STUDIO_PERMISSIONS.MANAGE_APPOINTMENTS,
        STUDIO_PERMISSIONS.MANAGE_CUSTOMERS,
    ],
    [STUDIO_ACCOUNT_ROLES.MANAGER]: [
        STUDIO_PERMISSIONS.MANAGE_SETTINGS,
        STUDIO_PERMISSIONS.MANAGE_STAFF_PROFILES,
        STUDIO_PERMISSIONS.MANAGE_SESSIONS,
        STUDIO_PERMISSIONS.MANAGE_APPOINTMENTS,
        STUDIO_PERMISSIONS.MANAGE_CUSTOMERS,
    ],
    [STUDIO_ACCOUNT_ROLES.TREATMENT]: [
        STUDIO_PERMISSIONS.MANAGE_SESSIONS,
        STUDIO_PERMISSIONS.MANAGE_APPOINTMENTS,
        STUDIO_PERMISSIONS.MANAGE_CUSTOMERS,
    ],
    [STUDIO_ACCOUNT_ROLES.RECEPTION]: [
        STUDIO_PERMISSIONS.MANAGE_APPOINTMENTS,
        STUDIO_PERMISSIONS.MANAGE_CUSTOMERS,
    ],
    [STUDIO_ACCOUNT_ROLES.READONLY]: [STUDIO_PERMISSIONS.VIEW_ONLY],
};

const resolveStudioAccountRole = (user) => {
    if (!user) return null;
    if (user.role === 'studio_admin') {
        return user.studio_account_role || STUDIO_ACCOUNT_ROLES.OWNER;
    }
    if (user.role === 'studio_staff') {
        return user.studio_account_role || STUDIO_ACCOUNT_ROLES.TREATMENT;
    }
    return user.studio_account_role || null;
};

const studioUserHasPermission = (user, permissionKey) => {
    const role = resolveStudioAccountRole(user);
    if (!role) return false;
    const list = ROLE_PERMISSIONS[role] || [];
    return list.includes(permissionKey);
};

module.exports = {
    STUDIO_ACCOUNT_ROLES,
    STUDIO_ACCOUNT_ROLE_LIST,
    STUDIO_ACCOUNT_ROLE_META,
    STUDIO_PERMISSIONS,
    ROLE_PERMISSIONS,
    resolveStudioAccountRole,
    studioUserHasPermission,
};
