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
        label_de: 'Laser-Katalog',
        description: 'Create and edit approved laser devices',
        description_de: 'Freigegebene Laser-Geräte anlegen und bearbeiten',
    },
    {
        key: ADMIN_PERMISSIONS.MANAGE_AI_CONFIG,
        label: 'AI config',
        label_de: 'KI-Konfiguration',
        description: 'Edit AI system prompts and training settings',
        description_de: 'KI-System-Prompts und Trainingseinstellungen bearbeiten',
    },
    {
        key: ADMIN_PERMISSIONS.MANAGE_PLATFORM_CONFIG,
        label: 'Platform config',
        label_de: 'Plattform-Konfiguration',
        description: 'Medical, pricing, and prediction rules',
        description_de: 'Medizin-, Preis- und Prognoseregeln',
    },
    {
        key: ADMIN_PERMISSIONS.MANAGE_FEATURES,
        label: 'Feature flags',
        label_de: 'Feature-Flags',
        description: 'Global and studio feature overrides',
        description_de: 'Globale und Studio-Feature-Overrides',
    },
    {
        key: ADMIN_PERMISSIONS.MANAGE_ADMINS,
        label: 'Admin users',
        label_de: 'Admin-Benutzer',
        description: 'Invite, activate, and assign admin permissions',
        description_de: 'Admins einladen, aktivieren und Berechtigungen zuweisen',
    },
    {
        key: ADMIN_PERMISSIONS.VIEW_MEDICAL_DATA,
        label: 'Medical data',
        label_de: 'Medizinische Daten',
        description: 'View cross-studio medical / case support data',
        description_de: 'Studioübergreifende medizinische / Case-Supportdaten einsehen',
    },
];

module.exports = {
    ADMIN_PERMISSIONS,
    ADMIN_PERMISSION_LIST,
    ADMIN_PERMISSION_META,
};
