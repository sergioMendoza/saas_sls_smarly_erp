import {APIGatewayProxyHandler, Handler} from 'aws-lambda';
// import * as uuidV4 from 'uuid/v4';
import * as configModule from '../common/config-manager/config';
import * as tokenManager from '../common/token-manager/token';
import * as cognitoUsers from './cognito-user';
import DynamoDBManager from '../common/dynamodb-manager/dynamodb';
import * as Async from 'async';
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
// const tenantUrl: string = configuration.url.tenant;

// const userUrl: string = configuration.url.user;


let userSchema = {
    TableName: configuration.table.user,
    KeySchema: [
        {AttributeName: "tenant_id", KeyType: "HASH"},  //Partition key
        {AttributeName: "id", KeyType: "RANGE"}  //Sort key
    ],
    AttributeDefinitions: [
        {AttributeName: "tenant_id", AttributeType: "S"},
        {AttributeName: "id", AttributeType: "S"}
    ],
    ProvisionedThroughput: {
        ReadCapacityUnits: 10,
        WriteCapacityUnits: 10
    },
    GlobalSecondaryIndexes: [
        {
            IndexName: 'UserNameIndex',
            KeySchema: [
                {AttributeName: "id", KeyType: "HASH"}
            ],
            Projection: {
                ProjectionType: 'ALL'
            },
            ProvisionedThroughput: {
                ReadCapacityUnits: 10,
                WriteCapacityUnits: 10
            }
        }
    ]
};


export const getUserPool: Handler = async (event, _context) => {

    winston.debug('Looking up user pool data for: ' + event.queryStringParameters.id);
    const headers = {"Access-Control-Allow-Origin": "*"};

    tokenManager.getSystemCredentials(
        (credentials) => {
            lookupUserPoolData(credentials, event.queryStringParameters.id, null, true, (err, user) => {
                if (err) {
                    return {
                        statusCode: 400,
                        headers: headers,
                        body: JSON.stringify({
                            message: {error: "Error registering new system admin user"}
                        })
                    };
                } else {
                    if (user.length == 0) return {
                        statusCode: 400,
                        headers: headers,
                        body: JSON.stringify({
                            message: {error: "User not found"}
                        })
                    };
                    else return {
                        statusCode: 200,
                        body: JSON.stringify(user)
                    };
                }
            })
        }
    )

};

export const createUserSystem: Handler = async (event, _context) => {
    let user = event.body;
    user.tier = configuration.tier.system;
    user.role = configuration.userRole.systemAdmin;
    const headers = {"Access-Control-Allow-Origin": "*"};
    // get the credentials for the system user
    let credentials = {};
    tokenManager.getSystemCredentials((systemCredentials) => {
        if (systemCredentials) {
            credentials = systemCredentials;
            // provision the tenant admin and roles
            provisionAdminUserWithRoles(user, credentials, configuration.userRole.systemAdmin, configuration.userRole.systemUser,
                (err, result) => {
                    if (err) {
                        return {
                            statusCode: 400,
                            headers: headers,
                            body: JSON.stringify({
                                message: {error: "Error provisioning system admin user"}
                            })
                        };

                    } else {
                        return {
                            statusCode: 200,
                            body: JSON.stringify(result)
                        };
                    }
                });
        } else {
            winston.debug("Error Obtaining System Credentials");
        }
    });
};

/**
 * Create a new user using the supplied credentials/user
 * @param credentials used for the user creation
 * @param userPoolId The user pool where the user will be added
 * @param identityPoolId the identityPoolId
 * @param clientId The client identifier
 * @param tenantId The tenant identifier
 * @param newUser The data fro the user being created
 */
const createNewUser = (credentials, userPoolId, identityPoolId, clientId, tenantId, newUser): Promise<any> => {
    return new Promise((resolve, reject) => {
        // fill in system attributes for user (not passed in POST)
        newUser.userPoolId = userPoolId;
        newUser.tenant_id = tenantId;
        newUser.email = newUser.userName;
        // create the user in Cognito
        cognitoUsers.createUser(credentials, newUser, (err, cognitoUser) => {
            if (err)
                reject(err);
            else {
                // populate the user to store in DynamoDB
                newUser.id = newUser.userName;
                newUser.UserPoolId = userPoolId;
                newUser.IdentityPoolId = identityPoolId;
                newUser.client_id = clientId;
                newUser.tenant_id = tenantId;
                newUser.sub = cognitoUser.User.Attributes[0].Value;

                // construct the Manager object
                let dynamoManager = new DynamoDBManager(userSchema, credentials, configuration);

                dynamoManager.putItem(newUser, credentials, (err, createdUser) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(createdUser) // null, createdUser
                    }
                });
            }
        });
    });
};

/**
 * Provision an admin user and the associated policies/roles
 * @param user The user being created
 * @param credentials Credentials to use for provisioning
 * @param adminPolicyName The name of of the admin policy to provisioned
 * @param userPolicyName The name of the user policy to be provisioned
 * @param callback Returns an object with the results of the provisioned items
 */
export const provisionAdminUserWithRoles = (user, credentials, adminPolicyName, userPolicyName, callback) => {
    // vars that are used across multiple calls
    let createdUserPoolData: any = {};
    let trustPolicyTemplate: any = {};
    let createdTrustPolicyRole: any = {};
    let createdUserPoolClient: any = {};
    let createdIdentityPool: any = {};
    let createdAdminPolicy: any = {};
    let createdAdminRole: any = {};
    let createdUserPolicy: any = {};
    let createdUserRole: any = {};

    // setup params for template generation
    let policyCreationParams: any = {
        tenantId: user.tenant_id,
        accountId: configuration.aws_account,
        region: configuration.aws_region,
        tenantTableName: configuration.table.tenant,
        userTableName: configuration.table.user
    };

    // init role based on admin policy name
    user.role = adminPolicyName;

    // see if this user is already in the system
    lookupUserPoolData(credentials, user.userName, user.tenant_id, true, (err, _userPoolData) => {
        if (!err) {
            callback(new Error('{"Error" : "User already exists"}'));
            winston.debug('{"Error" : "User already exists"}');
        } else {
            // create the new user
            cognitoUsers.createUserPool(user.tenant_id)
                .then((poolData) => {
                    createdUserPoolData = poolData;

                    let clientConfigParams = {
                        "ClientName": createdUserPoolData.UserPool.Name,
                        "UserPoolId": createdUserPoolData.UserPool.Id
                    };

                    // add the user pool to the policy template configuration (couldn't add until here)
                    policyCreationParams.userPoolId = createdUserPoolData.UserPool.Id;

                    // crete the user pool for the new tenant
                    return cognitoUsers.createUserPoolClient(clientConfigParams);
                })
                .then((userPoolClientData: any) => {
                    createdUserPoolClient = userPoolClientData;
                    let identityPoolConfigParams: any = {
                        "ClientId": userPoolClientData.UserPoolClient.ClientId,
                        "UserPoolId": userPoolClientData.UserPoolClient.UserPoolId,
                        "Name": userPoolClientData.UserPoolClient.ClientName
                    };
                    return cognitoUsers.createIdentityPool(identityPoolConfigParams);
                })
                .then((identityPoolData: any) => {
                    createdIdentityPool = identityPoolData;

                    // create and populate policy templates
                    trustPolicyTemplate = cognitoUsers.getTrustPolicy(identityPoolData.IdentityPoolId);

                    // get the admin policy template
                    let adminPolicyTemplate = cognitoUsers.getPolicyTemplate(adminPolicyName, policyCreationParams);

                    // setup policy name
                    let policyName = user.tenant_id + '-' + adminPolicyName + 'Policy';

                    // configure params for policy provisioning calls
                    let adminPolicyParams = {
                        "policyName": policyName,
                        "policyDocument": adminPolicyTemplate
                    };

                    return cognitoUsers.createPolicy(adminPolicyParams)
                })
                .then((adminPolicy) => {
                    createdAdminPolicy = adminPolicy;
                    return createNewUser(credentials, createdUserPoolData.UserPool.Id, createdIdentityPool.IdentityPoolId, createdUserPoolClient.UserPoolClient.ClientId, user.tenant_id, user);
                })
                .then(() => {
                    // get the admin policy template
                    let userPolicyTemplate = cognitoUsers.getPolicyTemplate(userPolicyName, policyCreationParams);

                    // setup policy name
                    let policyName = user.tenant_id + '-' + userPolicyName + 'Policy';

                    // configure params for policy provisioning calls
                    let userPolicyParams = {
                        "policyName": policyName,
                        "policyDocument": userPolicyTemplate
                    };

                    return cognitoUsers.createPolicy(userPolicyParams)
                })
                .then((userPolicy) => {
                    createdUserPolicy = userPolicy;

                    let adminRoleName = user.tenant_id + '-' + adminPolicyName;
                    let adminRoleParams = {
                        "policyDocument": trustPolicyTemplate,
                        "roleName": adminRoleName
                    };

                    return cognitoUsers.createRole(adminRoleParams);
                })
                .then((adminRole) => {
                    createdAdminRole = adminRole;

                    let userRoleName = user.tenant_id + '-' + userPolicyName;
                    let userRoleParams = {
                        "policyDocument": trustPolicyTemplate,
                        "roleName": userRoleName
                    };

                    return cognitoUsers.createRole(userRoleParams)
                })
                .then((userRole) => {
                    createdUserRole = userRole;
                    let trustPolicyRoleName = user.tenant_id + '-Trust';
                    let trustPolicyRoleParams = {
                        "policyDocument": trustPolicyTemplate,
                        "roleName": trustPolicyRoleName
                    };

                    return cognitoUsers.createRole(trustPolicyRoleParams)
                })
                .then((trustPolicyRole) => {
                    createdTrustPolicyRole = trustPolicyRole;
                    let adminPolicyRoleParams = {
                        PolicyArn: createdAdminPolicy.Policy.Arn,
                        RoleName: createdAdminRole.Role.RoleName
                    };

                    return cognitoUsers.addPolicyToRole(adminPolicyRoleParams);
                })
                .then(() => {
                    let userPolicyRoleParams = {
                        PolicyArn: createdUserPolicy.Policy.Arn,
                        RoleName: createdUserRole.Role.RoleName
                    };

                    return cognitoUsers.addPolicyToRole(userPolicyRoleParams);
                })
                .then(() => {
                    let addRoleToIdentityParams = {
                        "IdentityPoolId": createdIdentityPool.IdentityPoolId,
                        "trustAuthRole": createdTrustPolicyRole.Role.Arn,
                        "roleSystem": createdAdminRole.Role.Arn,
                        "roleSupportOnly": createdUserRole.Role.Arn,
                        "ClientId": createdUserPoolClient.UserPoolClient.ClientId,
                        "provider": createdUserPoolClient.UserPoolClient.UserPoolId,
                        "adminRoleName": adminPolicyName,
                        "userRoleName": userPolicyName
                    };

                    return cognitoUsers.addRoleToIdentity(addRoleToIdentityParams);
                })
                .then((identityRole) => {
                    let returnObject = {
                        "pool": createdUserPoolData,
                        "userPoolClient": createdUserPoolClient,
                        "identityPool": createdIdentityPool,
                        "role": {
                            "systemAdminRole": createdAdminRole.Role.RoleName,
                            "systemSupportRole": createdUserRole.Role.RoleName,
                            "trustRole": createdTrustPolicyRole.Role.RoleName
                        },
                        "policy": {
                            "systemAdminPolicy": createdAdminPolicy.Policy.Arn,
                            "systemSupportPolicy": createdUserPolicy.Policy.Arn,
                        },
                        "addRoleToIdentity": identityRole
                    };
                    callback(null, returnObject)
                })
                .catch((err) => {
                    winston.debug(err);
                    callback(err);
                });
        }
    });
};


/**
 * Lookup a user's pool data in the user table
 * @param credentials The credentials used ben looking up the user
 * @param userId The id of the user being looked up
 * @param tenantId The id of the tenant (if this is not system context)
 * @param isSystemContext Is this being called in the context of a system user (registration, system user provisioning)
 * @param callback The results of the lookup
 */
const lookupUserPoolData = (credentials, userId, tenantId, isSystemContext, callback) => {

    // construct the Manager object
    let dynamoManager = new DynamoDBManager(userSchema, credentials, configuration);

    // if we're looking this up in a system context, query the GSI with user name only
    if (isSystemContext) {

        // init params structure with request params
        let searchParams = {
            TableName: userSchema.TableName,
            IndexName: userSchema.GlobalSecondaryIndexes[0].IndexName,
            KeyConditionExpression: "id = :id",
            ExpressionAttributeValues: {
                ":id": userId
            }
        };

        // get the item from the database

        dynamoManager.query(searchParams, credentials, (err, users) => {
            if (err) {
                winston.error('Error getting user: ' + err.message);
                callback(err);
            } else {
                if (users.length == 0) {
                    let err = new Error('No user found: ' + userId);
                    callback(err);
                } else
                    callback(null, users[0]);
            }
        });
    } else {
        // if this is a tenant context, then we must get with tenant id scope
        let searchParams = {
            id: userId,
            tenant_id: tenantId
        };

        // get the item from the database
        dynamoManager.getItem(searchParams, credentials, (err, user) => {
            if (err) {
                winston.error('Error getting user: ' + err.message);
                callback(err);
            } else {
                callback(null, user);
            }
        });
    }
};


export const delUserTenants: Handler = (_event, _context,) => {
    winston.debug('Cleaning up Identity Reference Architecture: ');
    const headers = {"Access-Control-Allow-Origin": "*"};

    let input = {};
    tokenManager.getInfra(input, (error, response) => {
        // handle error first, so one less indentation later
        if (error) {
            return {
                statusCode: 400,
                headers: headers,
                body: JSON.stringify(error)
            };
        } else {
            let infra = response;
            let items = Object.keys(infra).length;
            winston.debug(items + ' Tenants with Infrastructure');
            winston.debug('-------------------------------------');
            //let pool = "";
            //let i;
            // process each item in series
            Async.eachSeries(infra, (item, callback) => {
                // execute your logic
                //pool += item;

                // in this case item is infra[i] in the original code
                let UserPoolId = item.UserPoolId;
                let IdentityPoolId = item.IdentityPoolId;
                let systemAdminRole = item.systemAdminRole;
                let systemSupportRole = item.systemSupportRole;
                let trustRole = item.trustRole;
                let systemAdminPolicy = item.systemAdminPolicy;
                let systemSupportPolicy = item.systemSupportPolicy;

                // delete user pool
                cognitoUsers.deleteUserPool(UserPoolId)
                    .then((_userPoolData) => {
                        //delete identity pool
                        return cognitoUsers.deleteIdentityPool(IdentityPoolId);
                    })
                    .then((_identityPoolData) => {
                        //delete role
                        return cognitoUsers.detachRolePolicy(systemAdminPolicy, systemAdminRole);
                    })
                    .then((_detachSystemRolePolicyData) => {
                        //delete role
                        return cognitoUsers.detachRolePolicy(systemSupportPolicy, systemSupportRole);
                    })
                    .then((_detachSupportRolePolicyData) => {
                        //delete role
                        return cognitoUsers.deletePolicy(systemAdminPolicy);
                    })
                    .then((_systemAdminPolicyData) => {
                        //delete role
                        return cognitoUsers.deletePolicy(systemSupportPolicy);
                    })
                    .then((_systemSupportPolicyData) => {
                        //delete role
                        return cognitoUsers.deleteRole(systemAdminRole);
                    })
                    .then((_systemAdminRoleData) => {
                        //delete role
                        return cognitoUsers.deleteRole(systemSupportRole);
                    })
                    .then((_systemSupportRoleData) => {
                        //delete role
                        return cognitoUsers.deleteRole(trustRole);
                    })
                    .then(() => {
                        // promises over, return callback without errors
                        callback();
                        return;
                    })
                    .catch((err) => {
                        // we caught an error, return it back to async.
                        callback(err);
                        return;
                    });
            }, (err) => {
                // if err is not nil, return 400
                if (err) {
                    winston.debug(err);
                    return {
                        statusCode: 400,
                        headers: headers,
                        body: JSON.stringify(err)
                    };
                }

                return {
                    statusCode: 200,
                    headers: headers,
                    body: JSON.stringify({message: 'Success'})
                };
            });
        }
    });
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
