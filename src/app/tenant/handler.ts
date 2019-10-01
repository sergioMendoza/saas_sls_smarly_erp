import { Handler } from 'aws-lambda';
import * as configModule from '../common/config-manager/config';
import * as tokenManager from '../common/token-manager/token';
import DynamoDBManager from '../common/dynamodb-manager/dynamodb';
import * as uuidV4 from 'uuid/v4';

import { TenantAdminManager, Tenant } from './manager';

import * as winston from 'winston';

const configuration: configModule.SaasConfig = configModule.configure(process.env.ENV);
winston.configure({
    level: configuration.loglevel,
    transports: [
        new winston.transports.Console({
            level: configuration.loglevel,
            format: winston.format.combine(
                winston.format.colorize({ all: true }),
                winston.format.simple()
            )
        })
    ]
});

// Create a schema
let tenantSchema = {
    TableName: configuration.table.tenant,
    KeySchema: [
        { AttributeName: "id", KeyType: "HASH" }  //Partition key
    ],
    AttributeDefinitions: [
        { AttributeName: "id", AttributeType: "S" }
    ],
    ProvisionedThroughput: {
        ReadCapacityUnits: 10,
        WriteCapacityUnits: 10
    }
};

export const createTenant: Handler = (event, _context, callback) => {
    let credentials: any = {};

    tokenManager.getSystemCredentials((systemCredentials) => {
        credentials = systemCredentials;
        let tenant = JSON.parse(event.body);
        winston.debug('Creating Tenant: ' + tenant.id);
        // construct the helper object
        let dynamoManager = new DynamoDBManager(tenantSchema, credentials, configuration);

        dynamoManager.putItem(tenant, credentials, (err, tenant) => {
            if (err) {
                winston.error('Error creating new tenant: ' + err.message);
                callback(new Error('Error creating tenant'));
            } else {
                winston.debug('Tenant ' + tenant.id + ' created');
                callback(null, {
                    statusCode: 200,
                    body: JSON.stringify({
                        message: 'success'
                    })
                });
            }
        });
    })
};


export const ListTenantSystem: Handler = (_event, _context, callback) => {
    //context.callbackWaitsForEmptyEventLoop = false
    winston.debug('Fetching all tenants required to clean up infrastructure');
    //Note: Reference Architecture not leveraging Client Certificate to secure system only endpoints. Please integrate
    // the following endpoint with a Client Certificate.
    let credentials = {};
    tokenManager.getSystemCredentials((systemCredentials) => {
        credentials = systemCredentials;
        let scanParams = {
            TableName: tenantSchema.TableName,
        };

        // construct the helper object
        let dynamoManager = new DynamoDBManager(tenantSchema, credentials, configuration);

        dynamoManager.scan(scanParams, credentials, (error, tenants) => {

            if (error) {
                winston.error('Error retrieving tenants: ' + error.message);
                callback("Error retrieving tenants");

            } else {
                winston.debug('Tenants successfully retrieved');
                winston.debug('tenants: ' + JSON.stringify(tenants));
                callback(null, { statusCode: 200, body: JSON.stringify(tenants) });
            }
        });
    });
};


export const regTenant: Handler = (event, _context, callback) => {
    let tenant: Tenant = JSON.parse(event.body);
    // Generate the tenant id
    tenant.id = 'TENANT' + uuidV4();
    winston.debug('Creating Tenant ID: ' + tenant.id);
    tenant.id = tenant.id.split('-').join('');

    // if the tenant doesn't exist, create one
    TenantAdminManager.exists(tenant, configuration, function (tenantExists) {
        if (tenantExists) {
            winston.error('tenant exists?');
            winston.error("Error registering new tenant");
            callback(new Error("[400] Error registering new tenant"))
        }
        else {
            TenantAdminManager.reg(tenant, configuration).then( (tenData) => {
                    //Adding Data to the Tenant Object that will be required to cleaning up all created resources for all tenants.
                    tenant.UserPoolId = tenData.pool.UserPool.Id;
                    tenant.IdentityPoolId = tenData.identityPool.IdentityPoolId;

                    tenant.systemAdminRole = tenData.role.systemAdminRole;
                    tenant.systemSupportRole = tenData.role.systemSupportRole;
                    tenant.trustRole = tenData.role.trustRole;

                    tenant.systemAdminPolicy = tenData.policy.systemAdminPolicy;
                    tenant.systemSupportPolicy = tenData.policy.systemSupportPolicy;

                    TenantAdminManager.saveTenantData(tenant, configuration).then(() => {

                        winston.debug("Tenant registered: " + tenant.id);
                        callback(null, {
                            statusCode: 200,
                            body: JSON.stringify({
                                message: "Tenant " + tenant.id + " registered"
                            })
                        });
                    }).catch((error) => {
                        winston.error("Error registering new tenant: " + error.message);
                        callback(new Error("[400] Error saving tenant data: " + error.message))

                    });
                })
                .catch( (error) => {
                    winston.error("Error registering new tenant: " + error.message);
                    callback(new Error("[400] Error registering tenant: " + error.message));
                });
        }
    });
}