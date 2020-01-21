const Sequelize = require('sequelize');

const DB_TYPE = 'postgres';
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || 5432;

const DB_NAME = process.env.DB_NAME;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD || '';

const _config = {
    dialect: DB_TYPE,
    username: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    host: DB_HOST
};

let models = {};

(function (config) {
    if (Object.keys(models).length) {
        return models
    }

    const sequelize = new Sequelize(config.database, config.username, config.password, config);

    let modules = [
        require('./user.js')
    ];

    modules.forEach((module) => {
        const model = module(sequelize, Sequelize, config);
        models[model.name] = model;
    });

    Object.keys(models).forEach((key) => {
        if ('associate' in models[key]) {
            models[key].associate(models);
        }
    });

    models.sequelize = sequelize;
    models.Sequelize = Sequelize;
    return models;

})(_config);

module.exports = models;
