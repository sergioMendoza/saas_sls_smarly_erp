import {Handler} from 'aws-lambda';
import * as uuidV4 from 'uuid/v4';
import * as configModule from '../common/config-manager/config';
import * as winston from 'winston';
import {TenantAdminManager, Tenant} from './manager';
import {createCallbackResponse} from '../common/utils/response';


const configuration: configModule.SaasConfig = configModule.configure(process.env.NODE_ENVI);
winston.configure({
    level: configuration.loglevel,
    transports: [
        new winston.transports.Console({
            level: configuration.loglevel,
            format: winston.format.combine(
                winston.format.colorize({all: true}),
                winston.format.simple()
            )
        })
    ]
});


/**
 * Register a new system admin user
 */
export const regSystemAdmin: Handler = (event, context, callback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    let tenant: Tenant = JSON.parse(event.body);
    // Generate the tenant id for the system user
    tenant.id = 'SYSADMIN' + uuidV4();
    winston.debug('Creating system admin user, tenant id: ' + tenant.id);
    tenant.id = tenant.id.split('-').join('');
    TenantAdminManager.exists(tenant, configuration, (tenantExists) => {
        if (tenantExists) {
            winston.error('tenant exists?');
            winston.error("Error registering new system admin user");
            callback(new Error("[400] Error registering new system admin user"))
        } else {
            // winston.info('registering tenant...');
            TenantAdminManager.reg(tenant, configuration)
                .then((tenData) => {
                    // winston.info('saving tenant data...');
                    // winston.debug('tenant data: ' + JSON.stringify(tenData));
                    tenant.UserPoolId = tenData.pool.UserPool.Id;
                    tenant.IdentityPoolId = tenData.identityPool.IdentityPoolId;

                    tenant.systemAdminRole = tenData.role.systemAdminRole;
                    tenant.systemSupportRole = tenData.role.systemSupportRole;
                    tenant.trustRole = tenData.role.trustRole;

                    tenant.systemAdminPolicy = tenData.policy.systemAdminPolicy;
                    tenant.systemSupportPolicy = tenData.policy.systemSupportPolicy;

                    TenantAdminManager.saveTenantData(tenant, configuration).then(() => {

                        winston.debug("System admin user registered: " + tenant.id);
                        createCallbackResponse(201,{
                            message: "System admin user " + tenant.id + " registered"
                        }, callback);
                    }).catch((error) => {
                        winston.error("Error saving tenant system data: " + error.message);
                        createCallbackResponse(400, {error: "Error saving tenant system data: " + error.message}, callback);

                    })
                }).catch((error) => {
                winston.error("Error registering new system admin user: " + error.message);
                createCallbackResponse(400, {error: "Error registering system admin user: " + error.message}, callback);

            })
        }
    });
};

/**
 * Delete all system infrastructure and tables.
 */
export const delSystemAdmin: Handler = (_event, context, callback) => {
    context.callbackWaitsForEmptyEventLoop = false;

    TenantAdminManager.deleteInfra(configuration, winston)
        .then(() => {
            winston.debug("Delete Infra");
            //CloudFormation will remove the tables. This can be uncommented if required.
            //deleteTables()
        })
        .then(() => {
            winston.debug("System Infrastructure & Tables removed");
            createCallbackResponse(200, {
                message: "System Infrastructure & Tables removed"
            }, callback);
        })
        .catch((error) => {
            winston.error("Error removing system");
            winston.debug("Error: "+JSON.stringify(error));
            createCallbackResponse(400, {eeror: "Error removing system"}, callback);
        });
};
