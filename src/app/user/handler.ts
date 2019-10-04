import {Handler, APIGatewayEvent} from 'aws-lambda';
import * as configModule from '../common/config-manager/config';
import * as tokenManager from '../common/token-manager/token';
import * as cognitoUsers from './cognito-user';
import DynamoDBManager from '../common/dynamodb-manager/dynamodb';
import {createCallbackResponse} from '../common/utils/response';
import * as Async from 'async';

import * as winston from 'winston';

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

export const getUserPool: Handler = (event: APIGatewayEvent, _context, callback) => {

    winston.debug('Looking up user pool data for: ' + event.pathParameters.id);
    tokenManager.getSystemCredentials(
        (credentials) => {
            lookupUserPoolData(credentials, event.pathParameters.id, null, true, (err, user) => {
                if (err) {
                    createCallbackResponse(400, "Error registering new system admin user", callback);
                } else {
                    if (user.length == 0) createCallbackResponse(400, "User not found", callback);

                    else createCallbackResponse(200, user, callback);
                }
            })
        }
    )

};

/**
 * Provision a new system admin user
 */
export const createUserSystem: Handler = (event, _context, callback) => {

    let user = JSON.parse(event.body);
    user.tier = configuration.tier.system;
    user.role = configuration.userRole.systemAdmin;
    let credentials = {};

    tokenManager.getSystemCredentials((systemCredentials) => {
        if (systemCredentials) {
            credentials = systemCredentials;
            // provision the tenant admin and roles
            provisionAdminUserWithRoles(user, credentials, configuration.userRole.systemAdmin,
                configuration.userRole.systemUser,
                (err, result) => {
                    if (err) {
                      
                        createCallbackResponse(400, "Error provisioning system admin user", callback);

                    } else {
                        createCallbackResponse(200, result, callback);
                    }
                });
        } else {
            winston.debug("Error Obtaining System Credentials");
            createCallbackResponse(400, "Error Obtaining System Credentials", callback);
        }
    });
};

/**
 * Provision a new tenant admin user
 */
export const createUserTenant: Handler = (event, _context, callback) => {
    let user = JSON.parse(event.body);
    tokenManager.getSystemCredentials((systemCredentials) => {
        if (systemCredentials) {
            // provision the tenant admin and roles
            provisionAdminUserWithRoles(user, systemCredentials, configuration.userRole.tenantAdmin,
                configuration.userRole.tenantUser,
                (err, result) => {
                    if (err) {
                        winston.debug('Error provisioning tenant admin user: '+JSON.stringify(err));
                        createCallbackResponse(400, "Error provisioning tenant admin user", callback);
                    } else {
                        createCallbackResponse(200, result, callback);
                    }
                });
        } else {
            winston.debug("Error Obtaining System Credentials");
            createCallbackResponse(400, "Error Obtaining System Credentials", callback);

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
        //newUser.email = newUser.userName;
        // create the user in Cognito

        winston.debug('create new user', newUser);

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

                winston.debug('new user created', newUser);

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
    // lets that are used across multiple calls
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
            winston.debug('tenant_id: ' + user.tenant_id);
            cognitoUsers.createUserPool(user.tenant_id)
                .then((poolData) => {
                    winston.debug('poolData: ', poolData);
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
                    winston.debug('identityPoolConfigParams', identityPoolConfigParams);
                    return cognitoUsers.createIdentityPool(identityPoolConfigParams);
                })
                .then((identityPoolData: any) => {
                    createdIdentityPool = identityPoolData;

                    // create and populate policy templates
                    trustPolicyTemplate = cognitoUsers.getTrustPolicy(identityPoolData.IdentityPoolId);
                    winston.debug('trustPolicyTemplate', trustPolicyTemplate);

                    // get the admin policy template
                    let adminPolicyTemplate = cognitoUsers.getPolicyTemplate(adminPolicyName, policyCreationParams);
                    winston.debug('adminPolicyTemplate', adminPolicyTemplate);
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
                    return createNewUser(credentials,
                        createdUserPoolData.UserPool.Id,
                        createdIdentityPool.IdentityPoolId,
                        createdUserPoolClient.UserPoolClient.ClientId,
                        user.tenant_id, user);
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

                    winston.debug('userPolicyTemplate', userPolicyParams);

                    return cognitoUsers.createPolicy(userPolicyParams)
                })
                .then((userPolicy) => {
                    createdUserPolicy = userPolicy;

                    let adminRoleName = user.tenant_id + '-' + adminPolicyName;
                    let adminRoleParams = {
                        "policyDocument": trustPolicyTemplate,
                        "roleName": adminRoleName
                    };

                    winston.debug('adminRoleParams', adminRoleParams);

                    return cognitoUsers.createRole(adminRoleParams);
                })
                .then((adminRole) => {
                    createdAdminRole = adminRole;

                    let userRoleName = user.tenant_id + '-' + userPolicyName;
                    let userRoleParams = {
                        "policyDocument": trustPolicyTemplate,
                        "roleName": userRoleName
                    };

                    winston.debug('userRoleParams', userRoleParams);
                    return cognitoUsers.createRole(userRoleParams)
                })
                .then((userRole) => {
                    createdUserRole = userRole;
                    let trustPolicyRoleName = user.tenant_id + '-Trust';
                    let trustPolicyRoleParams = {
                        "policyDocument": trustPolicyTemplate,
                        "roleName": trustPolicyRoleName
                    };
                    winston.debug('trustPolicyRoleParams', trustPolicyRoleParams);
                    return cognitoUsers.createRole(trustPolicyRoleParams)
                })
                .then((trustPolicyRole) => {
                    createdTrustPolicyRole = trustPolicyRole;
                    let adminPolicyRoleParams = {
                        PolicyArn: createdAdminPolicy.Policy.Arn,
                        RoleName: createdAdminRole.Role.RoleName
                    };
                    winston.debug('adminPolicyRoleParams', adminPolicyRoleParams);
                    return cognitoUsers.addPolicyToRole(adminPolicyRoleParams);
                })
                .then(() => {
                    let userPolicyRoleParams = {
                        PolicyArn: createdUserPolicy.Policy.Arn,
                        RoleName: createdUserRole.Role.RoleName
                    };
                    winston.debug('userPolicyRoleParams', userPolicyRoleParams);
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
                    winston.debug('addRoleToIdentityParams', addRoleToIdentityParams);
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
                    winston.debug('returnObject ', returnObject);
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
        let searchParam = {
            TableName: userSchema.TableName,
            IndexName: userSchema.GlobalSecondaryIndexes[0].IndexName,
            KeyConditionExpression: "id = :id",
            ExpressionAttributeValues: {
                ":id": userId
            }
        };

        winston.debug('search paramether one', searchParam);

        // get the item from the database

        dynamoManager.query(searchParam, credentials, (err, users) => {
            if (err) {
                winston.error('Error getting user: ' + err);
                callback(err);
            } else {
                winston.debug('user data: ' + JSON.stringify(users));
                if (users.length == 0) {
                    let err = new Error('No user found: ' + userId);
                    callback(err);
                    //callback(null, []);
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


export const delUserTenants: Handler = (_event, _context, callback) => {
    winston.debug('Cleaning up Identity Reference Architecture: ');
    let input = {};
    tokenManager.getInfra(input, (error, response) => {
        // handle error first, so one less indentation later
        if (error) {
            createCallbackResponse(400, error, callback);
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
                    createCallbackResponse(400, err, callback);
                }

                createCallbackResponse(200, {message: 'Success'}, callback);
            });
        }
    });
};


export const createUser: Handler = (event, _context, callback) => {
    tokenManager.getCredentialsFromToken(event, function (credentials) {
        let user = JSON.parse(event.body);
        winston.debug('Creating user: ' + user.userName);

        // extract requesting user and role from the token
        let authToken = tokenManager.getRequestAuthToken(event);
        let decodedToken: any = tokenManager.decodeToken(authToken);
        let requestingUser = decodedToken.email;
        user.tier = decodedToken['custom:tier'];
        user.tenant_id = decodedToken['custom:tenant_id'];

        // get the user pool data using the requesting user
        // all users added in the context of this user
        lookupUserPoolData(credentials, requestingUser, user.tenant_id, false, function (err, userPoolData) {
            // if the user pool found, proceed
            if (!err) {
                createNewUser(credentials, userPoolData.UserPoolId, userPoolData.IdentityPoolId, userPoolData.client_id,
                    user.tenant_id, user)
                    .then((_createdUser) => {
                        winston.debug('User ' + user.userName + ' created');
                        createCallbackResponse(200, {status: 'success'}, callback);
                    })
                    .catch((err) => {
                        winston.error('Error creating new user in DynamoDB: ' + err.message);
                        createCallbackResponse(400, "Error creating user in DynamoDB", callback);
                    });
            } else {
                createCallbackResponse(400, "User pool not found", callback);
            }
        });
    });
};

const getUserPoolIdFromRequest = (event) => {
    let token = event.headers['Authorization'];
    let userPoolId;
    let decodedToken: any = tokenManager.decodeToken(token);
    if (decodedToken) {
        let pool = decodedToken.iss;
        userPoolId = pool.substring(pool.lastIndexOf("/") + 1);
    }
    return userPoolId;
};
export const listUser: Handler = (event, _context, callback) => {
    tokenManager.getCredentialsFromToken(event, (credentials) => {
        winston.debug('credentials: ' + JSON.stringify(credentials));
        let userPoolId = getUserPoolIdFromRequest(event);
        cognitoUsers.getUsersFromPool(credentials, userPoolId, configuration.aws_region)
            .then((userList) => {
                createCallbackResponse(200, userList, callback);
            })
            .catch((error) => {
                createCallbackResponse(400, "Error retrieving user list: " + error.message, callback);
            });
    })
};

export const getUser: Handler = (event: APIGatewayEvent, _context, callback) => {
    winston.debug('Getting user id: ' + event.pathParameters.id);
    tokenManager.getCredentialsFromToken(event, (credentials) => {
        // get the tenant id from the request
        let tenantId = tokenManager.getTenantId(event);

        lookupUserPoolData(credentials, event.pathParameters.id, tenantId, false, (err, user) => {
            if (err) createCallbackResponse(400, "Error getting user", callback);
            else {
                cognitoUsers.getCognitoUser(credentials, user, (err, user) => {
                    if (err) {
                        createCallbackResponse(400, "Error lookup user id: " + event.pathParameters.id, callback);
                    } else {
                        createCallbackResponse(200, user, callback);
                    }
                })
            }
        });
    });
};

const updateUserEnabledStatus = (event, enable, callback) => {
    let user = JSON.parse(event.body);

    tokenManager.getCredentialsFromToken(event, (credentials) => {
        // get the tenant id from the request
        let tenantId = tokenManager.getTenantId(event);

        // Get additional user data required for enabled/disable
        lookupUserPoolData(credentials, user.userName, tenantId, false, (err, userPoolData) => {

            // if the user pool found, proceed
            if (err) {
                callback(err);
            } else {
                // update the user enabled status
                cognitoUsers.updateUserEnabledStatus(credentials, userPoolData.UserPoolId, user.userName, enable)
                    .then(() => {
                        callback(null, {status: 'success'});
                    })
                    .catch((err) => {
                        callback(err);
                    });
            }
        });
    });
};


export const enableUser: Handler = (event, _context, callback) => {
    updateUserEnabledStatus(event, true, (err, result) => {
        if (err) createCallbackResponse(400, 'Error enabling user', callback);
        else createCallbackResponse(200, result, callback);
    });
};


export const disableUser: Handler = (event, _context, callback) => {
    updateUserEnabledStatus(event, false, (err, result) => {
        if (err) createCallbackResponse(400, 'Error disabling user', callback);
        else createCallbackResponse(200, result, callback);
    });
};

export const updateUser: Handler = (event, _context, callback) => {
    let user = JSON.parse(event.body);
    tokenManager.getCredentialsFromToken(event, (credentials) => {
        // get the user pool id from the request
        let userPoolId = getUserPoolIdFromRequest(event);

        // update user data
        cognitoUsers.updateUser(credentials, user, userPoolId, configuration.aws_region)
            .then((updatedUser) => {
                createCallbackResponse(200, updatedUser, callback);
            })
            .catch((err) => {
                createCallbackResponse(400, "Error updating user: " + err.message, callback);
            });
    });
};

export const delUser: Handler = (event: APIGatewayEvent, _context, callback) => {
    let userName = event.headers.id;
    tokenManager.getCredentialsFromToken(event, function (credentials) {
        winston.debug('Deleting user: ' + userName);

        // get the tenant id from the request
        let tenantId = tokenManager.getTenantId(event);

        // see if the user exists in the system
        lookupUserPoolData(credentials, userName, tenantId, false, function (err, userPoolData) {
            // if the user pool found, proceed
            if (err) {
                createCallbackResponse(400, "User does not exist", callback);
            } else {
                // first delete the user from Cognito
                cognitoUsers.deleteUser(credentials, userName, userPoolData.UserPoolId, configuration.aws_region)
                    .then((_result) => {
                        winston.debug('User ' + userName + ' deleted from Cognito');

                        // now delete the user from the user data base
                        let deleteUserParams = {
                            TableName: userSchema.TableName,
                            Key: {
                                id: userName,
                                tenant_id: tenantId
                            }
                        };

                        // construct the helper object
                        let dynamoManager = new DynamoDBManager(userSchema, credentials, configuration);

                        // delete the user from DynamoDB
                        dynamoManager.deleteItem(deleteUserParams, credentials, function (err, _user) {
                            if (err) {
                                winston.error('Error deleting DynamoDB user: ' + err.message);
                                createCallbackResponse(400, "Error deleting DynamoDB user", callback);
                            } else {
                                winston.debug('User ' + userName + ' deleted from DynamoDB');
                                createCallbackResponse(200, {
                                    status: 'success'
                                }, callback);
                            }
                        })
                    })
                    .catch((_error) => {
                        winston.error('Error deleting Cognito user: ' + err.message);
                        createCallbackResponse(400, "Error deleting user", callback);
                    });
            }
        });
    });
};

export const delUserTables: Handler = (_event, _context, callback) => {

    // Delete User Table
    cognitoUsers.deleteTable(configuration.table.user)
        .then((_response) => {
        })
        .catch((err) => {
            createCallbackResponse(400, "Error deleting " + configuration.table.user + err.message, callback);
        });
    // Delete Tenant Table
    cognitoUsers.deleteTable(configuration.table.tenant)
        .then((_response) => {
        })
        .catch((err) => {
            createCallbackResponse(400, "Error deleting " + configuration.table.tenant + err.message, callback);
        });

    createCallbackResponse(200, {
        message: 'Initiated removal of DynamoDB Tables'
    }, callback);
};
