const path = require('path');
const child_process = require('child_process');
const Promise = require('bluebird');
const Umzug = require('umzug');
const models = require('./models');

console.log(models.sequelize);

const umzug = new Umzug({
    storage: 'sequelize',
    storageOptions: {
        sequelize: models.sequelize,
    },

    // see: https://github.com/sequelize/umzug/issues/17
    migrations: {
        params: [
            models.sequelize, //sequelize
            models.sequelize.getQueryInterface(), // queryInterface
            models.sequelize.constructor, // DataTypes
            function () {
                throw new Error('Migration tried to use old style "done" callback.');
            }
        ],
        path: './migrations',
        pattern: /\.js$/
    },

    logging: function () {
        console.log.apply(null, arguments);
    },
});

const logUmzugEvent = (eventName) => {
    return function (name, migration) {
        console.log(`${name} ${eventName}`);
    }
};

umzug.on('migrating', logUmzugEvent('migrating'));
umzug.on('migrated', logUmzugEvent('migrated'));
umzug.on('reverting', logUmzugEvent('reverting'));
umzug.on('reverted', logUmzugEvent('reverted'));

const cmdStatus = () => {
    let result = {};

    return umzug.executed()
        .then(executed => {
            result.executed = executed;
            return umzug.pending();
        }).then(pending => {
            result.pending = pending;
            return result;
        }).then(({executed, pending}) => {

            executed = executed.map(m => {
                m.name = path.basename(m.file, '.js');
                return m;
            });
            pending = pending.map(m => {
                m.name = path.basename(m.file, '.js');
                return m;
            });

            const current = executed.length > 0 ? executed[0].file : '<NO_MIGRATIONS>';
            const status = {
                current: current,
                executed: executed.map(m => m.file),
                pending: pending.map(m => m.file),
            };

            console.log(JSON.stringify(status, null, 2));

            return {executed, pending};
        })
};

const cmdMigrate = () => {
    return umzug.up();
};

const cmdMigrateNext = () => {
    return cmdStatus()
        .then(({executed, pending}) => {
            if (pending.length === 0) {
                return Promise.reject(new Error('No pending migrations'));
            }
            const next = pending[0].name;
            return umzug.up({to: next});
        })
};

const cmdReset = () => {
    return umzug.down({to: 0});
};

const cmdResetPrev = () => {
    return cmdStatus()
        .then(({executed, pending}) => {
            if (executed.length === 0) {
                return Promise.reject(new Error('Already at initial state'));
            }
            const prev = executed[executed.length - 1].name;
            return umzug.down({to: prev});
        })
};

const cmdHardReset = () => {
    return new Promise((resolve, reject) => {
        setImmediate(() => {
            try {
                console.log(`dropmodel ${DB_NAME}`);
                child_process.spawnSync(`dropmodel ${DB_NAME}`);
                console.log(`createmodel ${DB_NAME} --username ${DB_USER}`);
                child_process.spawnSync(`createmodel ${DB_NAME} --username ${DB_USER}`);
                resolve();
            } catch (e) {
                console.log(e);
                reject(e);
            }
        });
    });
};

module.exports = {
    cmdStatus,
    cmdMigrate,
    cmdMigrateNext,
    cmdReset,
    cmdResetPrev,
    cmdHardReset
};

