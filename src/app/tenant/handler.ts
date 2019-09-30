import {APIGatewayProxyHandler, Handler} from 'aws-lambda';
// import * as uuidV4 from 'uuid/v4';
import * as configModule from '../common/config-manager/config';
import * as tokenManager from '../common/token-manager/token';
import DynamoDBManager from '../common/dynamodb-manager/dynamodb';

import * as winston from 'winston';
// import * as request from 'request';

const configuration: configModule.SaasConfig = configModule.configure(process.env.ENV);
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

export const hello: APIGatewayProxyHandler = async (event, _context) => {
    return {
        statusCode: 200,
        body: JSON.stringify({
            message: 'Go Serverless Webpack (Typescript) v1.0! Your function executed successfully!',
            input: event,
        }),
    };
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


export const ListTenantSystem: Handler =  (_event, _context, callback) => {
    //context.callbackWaitsForEmptyEventLoop = false
    winston.debug('Fetching all tenants required to clean up infrastructure');
//Note: Reference Architecture not leveraging Client Certificate to secure system only endpoints. Please integrate the following endpoint with a Client Certificate.
    let credentials = {};
    tokenManager.getSystemCredentials( (systemCredentials) => {
        credentials = systemCredentials;
        let scanParams = {
            TableName: tenantSchema.TableName,
        };
        //const headers = {"Access-Control-Allow-Origin": "*"};


        // construct the helper object
        let dynamoManager = new DynamoDBManager(tenantSchema, credentials, configuration);

        dynamoManager.scan(scanParams, credentials,  (error, tenants) => {
           
            if (error) {
                winston.error('Error retrieving tenants: ' + error.message);
                callback("Error retrieving tenants");
                
            } else {
                winston.debug('Tenants successfully retrieved');
                winston.debug( 'tenants: '+JSON.stringify(tenants)); 
                callback(null, {statusCode:200,body: JSON.stringify(tenants) });
            }
        });
    });
};