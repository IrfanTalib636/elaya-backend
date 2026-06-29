require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/userModel');
const Studio = require('../models/studioModel');
const { USER_ROLES, USER_STATUS, STUDIO_STATUS } = require('../config/constants');
const { ensurePlatformConfig } = require('../utils/configService');

if (process.env.NODE_ENV === 'production') {
    console.error('seed:dev must not run in production. Use: npm run bootstrap:admin');
    process.exit(1);
}

const seedDev = async () => {
    await connectDB();

    const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@elaya.ch';
    const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin1234!';

    let admin = await User.findOne({ email: adminEmail });

    if (!admin) {
        admin = await User.create({
            email: adminEmail,
            password: adminPassword,
            role: USER_ROLES.SUPER_ADMIN,
            status: USER_STATUS.AKTIV,
        });
        console.log(`Super admin created: ${adminEmail}`);
    } else {
        console.log(`Super admin already exists: ${adminEmail}`);
    }

    let studio = await Studio.findOne({ studio_code: 'INKFREE' });

    if (!studio) {
        studio = await Studio.create({
            firma: 'inkFree',
            studio_code: 'INKFREE',
            email: 'studio@inkfree.ch',
            telefon: '',
            strasse: '',
            plz: '4147',
            ort: 'Aesch BL',
            land: 'Schweiz',
            status: STUDIO_STATUS.AKTIV,
            standorte: [
                { name: 'Aesch BL', plz: '4147', ort: 'Aesch BL', land: 'Schweiz' },
                { name: 'Schaffhausen', plz: '8200', ort: 'Schaffhausen', land: 'Schweiz' },
            ],
            owner: admin._id,
            notizen: 'Pilot studio seed',
        });
        console.log('Pilot studio inkFree created with studio_code: INKFREE');
    } else {
        console.log('Pilot studio inkFree already exists');
    }

    const studioAdminEmail = process.env.SEED_STUDIO_EMAIL || 'studio@inkfree.ch';
    const studioAdminPassword = process.env.SEED_STUDIO_PASSWORD || 'Studio1234!';

    let studioAdmin = await User.findOne({ email: studioAdminEmail });

    if (!studioAdmin) {
        studioAdmin = await User.create({
            email: studioAdminEmail,
            password: studioAdminPassword,
            role: USER_ROLES.STUDIO_ADMIN,
            status: USER_STATUS.AKTIV,
            studio_id: studio._id,
        });
        console.log(`Studio admin created: ${studioAdminEmail} (studio_code INKFREE)`);
    } else {
        studioAdmin.role = USER_ROLES.STUDIO_ADMIN;
        studioAdmin.status = USER_STATUS.AKTIV;
        studioAdmin.studio_id = studio._id;
        await studioAdmin.save();
        console.log(`Studio admin updated: ${studioAdminEmail} (studio_code INKFREE)`);
    }

    await ensurePlatformConfig();
    console.log('Platform config ensured (defaults from client handoff)');
    console.log(`INKFREE studio id: ${studio._id}`);

    console.log('Seed complete');
    process.exit(0);
};

seedDev().catch((err) => {
    console.error(err);
    process.exit(1);
});
