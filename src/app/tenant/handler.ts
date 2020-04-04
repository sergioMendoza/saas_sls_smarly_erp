import {Handler, APIGatewayEvent} from 'aws-lambda';
import * as configModule from '../common/config-manager/config';
import * as tokenManager from '../common/token-manager/token';
import DynamoDBManager from '../common/dynamodb-manager/dynamodb';
import {createCallbackResponse} from '../common/utils/response';
import * as uuidV4 from 'uuid/v4';

import {TenantAdminManager, Tenant} from './manager';

import * as winston from 'winston';

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

// Create a schema
let tenantSchema = {
    TableName: configuration.table.tenant,
    KeySchema: [
        {AttributeName: "id", KeyType: "HASH"}  //Partition key
    ],
    AttributeDefinitions: [
        {AttributeName: "id", AttributeType: "S"}
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
                callback(null, {statusCode: 200, body: JSON.stringify(tenants)});
            }
        });
    });
};

export const regTenant: Handler = (event, context, callback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    winston.info(event);
    let tenant: Tenant = JSON.parse(event.body);
    // Generate the tenant id
    tenant.id = 'TENANT' + uuidV4();
    winston.debug('Creating Tenant ID: ' + tenant.id);
    tenant.id = tenant.id.split('-').join('');

    // if the tenant doesn't exist, create one
    TenantAdminManager.exists(tenant, configuration, (tenantExists) => {
        if (tenantExists) {
            winston.error('tenant exists?');
            winston.error("Error registering new tenant");
            createCallbackResponse(400, "Error registering new tenant", callback);
        } else {
            TenantAdminManager.reg(tenant, configuration).then((tenData) => {
                //Adding Data to the Tenant Object that will be required to cleaning up all created resources for all tenants.
                tenant.UserPoolId = tenData.pool.UserPool.Id;
                tenant.IdentityPoolId = tenData.identityPool.IdentityPoolId;

                tenant.systemAdminRole = tenData.role.systemAdminRole;
                tenant.systemSupportRole = tenData.role.systemSupportRole;
                tenant.trustRole = tenData.role.trustRole;

                tenant.systemAdminPolicy = tenData.policy.systemAdminPolicy;
                tenant.systemSupportPolicy = tenData.policy.systemSupportPolicy;

                winston.debug("saving tenant [REG]: " + tenant);

                TenantAdminManager.saveTenantData(tenant, configuration).then(() => {

                    winston.debug("Tenant registered: " + tenant.id);
                    createCallbackResponse(200, {
                        message: "Tenant " + tenant.id + " registered",
                        tenant_id: tenant.id
                    }, callback);
                }).catch((error) => {
                    winston.error("Error registering new tenant: " + JSON.stringify(error));
                    createCallbackResponse(400, "Error saving tenant data: " + JSON.stringify(error), callback);

                });
            }).catch((error) => {
                winston.error("Error registering new tenant: " + JSON.stringify(error));

                createCallbackResponse(400, " Error registering tenant: " + JSON.stringify(error), callback);
            });
        }
    });
};

export const listTenant: Handler = (event, _context, callback) => {
    winston.debug('Fetching all tenants');

    tokenManager.getCredentialsFromToken(event, (credentials) => {
        let scanParams = {
            TableName: tenantSchema.TableName,
        };

        // construct the helper object
        let dynamoManager = new DynamoDBManager(tenantSchema, credentials, configuration);

        dynamoManager.scan(scanParams, credentials, (error, tenants) => {
            if (error) {
                winston.error('Error retrieving tenants: ' + error.message);
                createCallbackResponse(400, {"Error": "Error retrieving tenants"}, callback);
            } else {
                winston.debug('Tenants successfully retrieved');
                createCallbackResponse(200, tenants, callback);
            }

        });
    });
};

export const getTenant: Handler = (event: APIGatewayEvent, _context, callback) => {
    winston.debug('Fetching tenant: ' + event.pathParameters.id);

    // init params structure with request params
    let tenantIdParam = {
        id: event.pathParameters.id
    };

    tokenManager.getCredentialsFromToken(event, (credentials) => {
        // construct the helper object
        let dynamoManager = new DynamoDBManager(tenantSchema, credentials, configuration);

        dynamoManager.getItem(tenantIdParam, credentials, (err, tenant) => {
            if (err) {
                winston.error('Error getting tenant: ' + err.message);
                createCallbackResponse(400, {"Error": "Error getting tenant"}, callback)
            } else {
                winston.debug('Tenant ' + event.pathParameters.id + ' retrieved');
                createCallbackResponse(200, tenant, callback)
            }
        });
    });
};

export const updateTenant: Handler = (event, _context, callback) => {
    let tenant = JSON.parse(event.body);
    winston.debug('Updating tenant: ' + tenant.id);
    tokenManager.getCredentialsFromToken(event, (credentials) => {
        // init the params from the request data
        let keyParams = {
            id: tenant.id
        };

        let tenantUpdateParams = {
            TableName: tenantSchema.TableName,
            Key: keyParams,
            UpdateExpression: "set " +
                "companyName=:companyName, " +
                "accountName=:accountName, " +
                "ownerName=:ownerName, " +
                "tier=:tier, " +
                "#status=:status",
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ":companyName": tenant.companyName,
                ":accountName": tenant.accountName,
                ":ownerName": tenant.ownerName,
                ":tier": tenant.tier,
                ":status": tenant.status
            },
            ReturnValues: "UPDATED_NEW"
        };

        // construct the helper object
        let dynamoManager = new DynamoDBManager(tenantSchema, credentials, configuration);

        dynamoManager.updateItem(tenantUpdateParams, credentials, (err, updatedTenant) => {
            if (err) {
                winston.error('Error updating tenant: ' + err.message);
                createCallbackResponse(400, {"Error": "Error updating tenant"}, callback);
            } else {
                winston.debug('Tenant ' + tenant.title + ' updated');
                createCallbackResponse(200, updatedTenant, callback);
            }
        });
    });
};

export const delTenant: Handler = (event: APIGatewayEvent, _context, callback) => {
    winston.debug('Deleting Tenant: ' + event.pathParameters.id);

    tokenManager.getCredentialsFromToken(event, (credentials) => {
        // init parameter structure
        let deleteTenantParams = {
            TableName: tenantSchema.TableName,
            Key: {
                id: event.pathParameters.id
            }
        };

        // construct the helper object
        let dynamoManager = new DynamoDBManager(tenantSchema, credentials, configuration);

        dynamoManager.deleteItem(deleteTenantParams, credentials, function (err, _result) {
            if (err) {
                winston.error('Error deleting tenant: ' + err.message);
                createCallbackResponse(400, {"Error": "Error deleting tenant"}, callback);
            } else {
                winston.debug('Tenant ' + event.pathParameters.id + ' deleted');
                createCallbackResponse(200, {message: 'success'}, callback);
            }
        });
    });
};
