const ADMIN_PERMISSIONS = {
    MANAGE_LASER_CATALOG: 'manage_laser_catalog',
    MANAGE_AI_CONFIG: 'manage_ai_config',
    MANAGE_PLATFORM_CONFIG: 'manage_platform_config',
    MANAGE_ADMINS: 'manage_admins',
    VIEW_MEDICAL_DATA: 'view_medical_data',
    MANAGE_FEATURES: 'manage_features',
};

const ADMIN_PERMISSION_LIST = Object.values(ADMIN_PERMISSIONS);

const ADMIN_PERMISSION_META = [
    {
        key: ADMIN_PERMISSIONS.MANAGE_LASER_CATALOG,
        label: 'Laser catalog',
        description: 'Create and edit approved laser devices',
    },
    {
        key: ADMIN_PERMISSIONS.MANAGE_AI_CONFIG,
        label: 'AI config',
        description: 'Edit AI system prompts and training settings',
    },
    {
        key: ADMIN_PERMISSIONS.MANAGE_PLATFORM_CONFIG,
        label: 'Platform config',
        description: 'Medical, pricing, and prediction rules',
    },
    {
        key: ADMIN_PERMISSIONS.MANAGE_FEATURES,
        label: 'Feature flags',
        description: 'Global and studio feature overrides',
    },
    {
        key: ADMIN_PERMISSIONS.MANAGE_ADMINS,
        label: 'Admin users',
        description: 'Invite, activate, and assign admin permissions',
    },
    {
        key: ADMIN_PERMISSIONS.VIEW_MEDICAL_DATA,
        label: 'Medical data',
        description: 'View cross-studio medical / case support data',
    },
];

module.exports = {
    ADMIN_PERMISSIONS,
    ADMIN_PERMISSION_LIST,
    ADMIN_PERMISSION_META,
};
