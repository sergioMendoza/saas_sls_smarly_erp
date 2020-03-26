// Declare dependencies
import * as AWS from 'aws-sdk';
import * as winston from 'winston';
// Configure Environment
import * as configModule from '../common/config-manager/config';

const configuration: configModule.SaasConfig = configModule.configure(process.env.NODE_ENVI);

// Init the winston


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
 * Create a Cognito user with custom attributes
 * @param credentials
 * @param user User with attribute values
 * @param callback Callback with created user
 */
export const createUser = (credentials, user, callback) => {
    // init service provider
    let cognitoIdentityServiceProvider = initCognitoServiceProvider(credentials);

    // create params for user creation
    let params = {
        UserPoolId: user.userPoolId, /* required */
        Username: user.userName, /* required */
        DesiredDeliveryMediums: [
            'EMAIL'
            /* more items */
        ],
        ForceAliasCreation: true,
        // ,
        // MessageAction: 'SUPPRESS',
        // TemporaryPassword: tempPassword,
        UserAttributes: [{
            Name: 'email',
            Value: user.email
        },
            {
                Name: 'custom:tenant_id',
                Value: user.tenant_id
            },
            {
                Name: 'given_name',
                Value: user.firstName
            },
            {
                Name: 'family_name',
                Value: user.lastName
            },
            {
                Name: 'custom:role',
                Value: user.role
            },
            {
                Name: 'custom:tier',
                Value: user.tier
            }
        ]
    };

    // create the user
    cognitoIdentityServiceProvider.adminCreateUser(params, (err, cognitoUser) => {
        if (err) {
            callback(err);
        } else {
            winston.debug('cognito user', cognitoUser);
            callback(null, cognitoUser);
        }
    });
};

/**
 * Get user attributes from Cognito
 * @param credentials The credentials
 * @param user The user being looked up
 * @param callback Callback with user attributes populated
 */

export const getCognitoUser = (credentials, user, callback) => {
    // init service provider
    let cognitoIdentityServiceProvider = initCognitoServiceProvider(credentials);

    // configure params
    let params = {
        UserPoolId: user.userPoolId, /* required */
        Username: user.userName /* required */
    };

    // get user data from Cognito
    cognitoIdentityServiceProvider.adminGetUser(params, (err, cognitoUser) => {
        if (err) {
            winston.debug("Error getting user from Cognito: ", err);
            callback(err);
        } else {
            let user = getUserFromCognitoUser(cognitoUser, cognitoUser.UserAttributes);
            callback(null, user);
        }
    });
};

/**
 * Convert Cognito user to generic user
 * @param cognitoUser The user to convert
 * @param attributeList
 * @return Populate User object
 */
export const getUserFromCognitoUser = (cognitoUser, attributeList) => {

    let user: any = {};
    try {
        user.userName = cognitoUser.Username;
        user.enabled = cognitoUser.Enabled;
        user.confirmedStatus = cognitoUser.UserStatus;
        user.dateCreated = cognitoUser.UserCreateDate;
        attributeList.forEach(attribute => {
            if (attribute.Name === "given_name")
                user.firstName = attribute.Value;
            else if (attribute.Name == "family_name")
                user.lastName = attribute.Value;
            else if (attribute.Name == "custom:role")
                user.role = attribute.Value;
            else if (attribute.Name == "custom:tier")
                user.tier = attribute.Value;
            else if (attribute.Name == "custom:email")
                user.email = attribute.Value;
        });
    } catch (error) {
        winston.error('Error populating user from Cognito user: ', error);
        throw error;
    }
    return user;
};

/**
 * Get a CognitoCredentialsProvider populated with supplied credentials
 * @param credentials Credentials for hydrate the provider
 */
export const initCognitoServiceProvider = (credentials) => {
    return new AWS.CognitoIdentityServiceProvider({
        apiVersion: '2016-04-18',
        sessionToken: credentials.claim.SessionToken,
        accessKeyId: credentials.claim.AccessKeyId,
        secretAccessKey: credentials.claim.SecretKey,
        region: configuration.aws_region
    });
};

/**
 * Create a new User Pool for a new tenant
 * @param tenantId The ID of the new tenant
 */
export const createUserPool = (tenantId): Promise<any> => {
    return new Promise((resolve, reject) => {
        // init the service provider and email message content
        let cognitoIdentityServiceProvider = new AWS.CognitoIdentityServiceProvider({
            apiVersion: '2016-04-18',
            region: configuration.aws_region
        });

        let SnsArn = configuration.role.sns;
        //Invite Message:
        let inviteMessage = '<img src="https://vonallem.la/assets/images/logo.svg" alt="Von Allem" /> <br><br>Welcome to Future!. <br><br>Login to Smartly ERP System Administration. <br><br>Username: {username} <br><br>Password: {####}';
        let emailSubject = 'Smartly SAAS ERP';
        // init JSON structure with pool settings
        let params = {
            PoolName: tenantId, /* required */
            AdminCreateUserConfig: {
                AllowAdminCreateUserOnly: true,
                InviteMessageTemplate: {
                    EmailMessage: inviteMessage,
                    EmailSubject: emailSubject
                    // SMSMessage: 'STRING_VALUE'
                },
                UnusedAccountValidityDays: 90
            },
            AliasAttributes: [
                'phone_number'
            ],
            AutoVerifiedAttributes: [
                'email',
                'phone_number'
                /* more items */
            ],
            MfaConfiguration: 'OFF',
            Policies: {
                PasswordPolicy: {
                    MinimumLength: 8,
                    RequireLowercase: true,
                    RequireNumbers: true,
                    RequireSymbols: false,
                    RequireUppercase: true
                }
            },
            Schema: [
                {
                    AttributeDataType: 'String',
                    DeveloperOnlyAttribute: false,
                    Mutable: false,
                    Name: 'tenant_id',
                    NumberAttributeConstraints: {
                        MaxValue: '256',
                        MinValue: '1'
                    },
                    Required: false,
                    StringAttributeConstraints: {
                        MaxLength: '256',
                        MinLength: '1'
                    }
                },
                /* more items */
                {
                    AttributeDataType: 'String',
                    DeveloperOnlyAttribute: false,
                    Mutable: true,
                    Name: 'tier',
                    NumberAttributeConstraints: {
                        MaxValue: '256',
                        MinValue: '1'
                    },
                    Required: false,
                    StringAttributeConstraints: {
                        MaxLength: '256',
                        MinLength: '1'
                    }
                },
                {
                    Name: "email",
                    Required: true
                },
                {
                    AttributeDataType: 'String',
                    DeveloperOnlyAttribute: false,
                    Mutable: true,
                    Name: 'company_name',
                    NumberAttributeConstraints: {
                        MaxValue: '256',
                        MinValue: '1'
                    },
                    Required: false,
                    StringAttributeConstraints: {
                        MaxLength: '256',
                        MinLength: '1'
                    }
                },
                {
                    AttributeDataType: 'String',
                    DeveloperOnlyAttribute: false,
                    Mutable: true,
                    Name: 'role',
                    NumberAttributeConstraints: {
                        MaxValue: '256',
                        MinValue: '1'
                    },
                    Required: false,
                    StringAttributeConstraints: {
                        MaxLength: '256',
                        MinLength: '1'
                    }
                },
                {
                    AttributeDataType: 'String',
                    DeveloperOnlyAttribute: false,
                    Mutable: true,
                    Name: 'account_name',
                    NumberAttributeConstraints: {
                        MaxValue: '256',
                        MinValue: '1'
                    },
                    Required: false,
                    StringAttributeConstraints: {
                        MaxLength: '256',
                        MinLength: '1'
                    }
                }
            ],
            SmsConfiguration: {
                SnsCallerArn: SnsArn, /* required */
                ExternalId: 'SmartlyERP'
            },
            UserPoolTags: {
                someKey: tenantId
                /* anotherKey: ... */
            }
        };

        // create the pool
        cognitoIdentityServiceProvider.createUserPool(params, (err, data) => {
            if (err) {
                winston.error('error create userpool:' + err);
                reject(err);
            } else {
                winston.debug('create pool data: ', JSON.stringify(data))
                resolve(data);
            }
        });
    });
};

/**
 * Create a user pool client for a new tenant
 * @param poolConfig The configuration parameters for a newly created pool
 */
export const createUserPoolClient = (poolConfig): Promise<any> => {
    return new Promise((resolve, reject) => {
        let cognitoIdentityServiceProvider = new AWS.CognitoIdentityServiceProvider({
            apiVersion: '2016-04-18',
            region: configuration.aws_region
        });

        // config the client parameters
        let params = {
            ClientName: poolConfig.ClientName, /* required */
            UserPoolId: poolConfig.UserPoolId, /* required */
            GenerateSecret: false,
            ReadAttributes: [
                'email',
                'family_name',
                'given_name',
                'phone_number',
                'preferred_username',
                'custom:tier',
                'custom:tenant_id',
                'custom:company_name',
                'custom:account_name',
                'custom:role'
                /* more items */
            ],
            RefreshTokenValidity: 0
            ,
            WriteAttributes: [
                'email',
                'family_name',
                'given_name',
                'phone_number',
                'preferred_username',
                'custom:tier',
                // 'custom:company_name',
                // 'custom:account_name',
                'custom:role'

                /* more items */
            ]
        };

        // create the Cognito client
        cognitoIdentityServiceProvider.createUserPoolClient(params, (err, data) => {
            if (err) {
                reject(err);
            } else {
                winston.debug('createUserPoolClient: ' + JSON.stringify(data));
                resolve(data);
            }
        });
    });
};

/**
 * Create a Cognito Identity Pool with the supplied params
 * @param clientConfigParams The client config params
 * @returns {Promise} A promise with the identity pools results
 */
export const createIdentityPool = (clientConfigParams): Promise<any> => {
    return new Promise((resolve, reject) => {

        // init identity params
        let cognitoIdentity = new AWS.CognitoIdentity({apiVersion: '2014-06-30', region: configuration.aws_region});
        let provider = 'cognito-idp.' + configuration.aws_region + '.amazonaws.com/' + clientConfigParams.UserPoolId;

        // config identity provider
        let params = {
            AllowUnauthenticatedIdentities: false, /* required */
            IdentityPoolName: clientConfigParams.Name, /* required */
            CognitoIdentityProviders: [
                {
                    ClientId: clientConfigParams.ClientId,
                    ProviderName: provider,
                    ServerSideTokenCheck: true
                },
                /* more items */
            ]
            ,
        };

        // create identity pool
        cognitoIdentity.createIdentityPool(params, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
};

/**
 * Generate a policy based on the specified type and configuration
 * @param policyType The type of policy to be created (system admin, system user, tenant admin, tenant user)
 * @param policyConfig The parameters used to populate the template
 * @returns The populated template
 */
export const getPolicyTemplate = (policyType, policyConfig) => {
    let policyTemplate = {};

    // create the ARN prefixes for policies
    let arnPrefix = 'arn:aws:dynamodb:' + policyConfig.region + ':' + policyConfig.accountId + ':table/';
    let databaseArnPrefix = 'arn:aws:dynamodb:' + policyConfig.region + ':' + policyConfig.accountId + ':table/';
    let cognitoArn = 'arn:aws:cognito-idp' + ':' + policyConfig.region + ':' + policyConfig.accountId + ':userpool/' + policyConfig.userPoolId;

    // populate database params
    // setup params for templates
    let policyParams = {
        tenantId: policyConfig.tenantId,
        arnPrefix: arnPrefix,
        cognitoArn: cognitoArn,
        tenantTableArn: databaseArnPrefix + policyConfig.tenantTableName,
        userTableArn: databaseArnPrefix + policyConfig.userTableName
    };

    if (policyType === configuration.userRole.systemAdmin)
        policyTemplate = getSystemAdminPolicy(policyParams);
    else if (policyType === configuration.userRole.systemUser)
        policyTemplate = getSystemUserPolicy(policyParams);
    else if (policyType === configuration.userRole.tenantAdmin)
        policyTemplate = getTenantAdminPolicy(policyParams);
    else if (policyType === configuration.userRole.tenantUser)
        policyTemplate = getTenantUserPolicy(policyParams);

    return policyTemplate;
};

/**
 * Get the trust policy template populated with the supplied trust policy
 * @param trustPolicy The policy to use for this template
 * @returns The populated template
 */
export const getTrustPolicy = (trustPolicy) => {
    return {
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {
                "Federated": "cognito-identity.amazonaws.com"
            },
            "Action": "sts:AssumeRoleWithWebIdentity",
            "Condition": {
                "StringEquals": {
                    "cognito-identity.amazonaws.com:aud": trustPolicy
                },
                "ForAnyValue:StringLike": {
                    "cognito-identity.amazonaws.com:amr": "authenticated"
                }
            }
        }]
    };
};

/**
 * Get the IAM policies for a Tenant Admin user
 * @param policyParams Dictionary with configuration parameters
 * @returns The populated system admin policy template
 */
export const getTenantAdminPolicy = (policyParams) => {
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "TenantAdminUserTable",
                "Effect": "Allow",
                "Action": [
                    "dynamodb:GetItem",
                    "dynamodb:BatchGetItem",
                    "dynamodb:Query",
                    "dynamodb:PutItem",
                    "dynamodb:UpdateItem",
                    "dynamodb:DeleteItem",
                    "dynamodb:BatchWriteItem",
                    "dynamodb:DescribeTable",
                    "dynamodb:CreateTable"

                ],
                "Resource": [policyParams.userTableArn, policyParams.userTableArn + '/*'],
                "Condition": {
                    "ForAllValues:StringEquals": {
                        "dynamodb:LeadingKeys": [policyParams.tenantId]
                    }
                }
            },
            {
                "Sid": "TenantCognitoAccess",
                "Effect": "Allow",
                "Action": [
                    "cognito-idp:AdminCreateUser",
                    "cognito-idp:AdminDeleteUser",
                    "cognito-idp:AdminDisableUser",
                    "cognito-idp:AdminEnableUser",
                    "cognito-idp:AdminGetUser",
                    "cognito-idp:ListUsers",
                    "cognito-idp:AdminUpdateUserAttributes"
                ],
                "Resource": [policyParams.cognitoArn]
            },
        ]
    };
};

/**
 * Get the IAM policies for a Tenant Admin user
 * @param policyParams Dictionary with configuration parameters
 * @returns The populated tenant user policy template
 */
export const getTenantUserPolicy = (policyParams) => {
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "TenantReadOnlyUserTable",
                "Effect": "Allow",
                "Action": [
                    "dynamodb:GetItem",
                    "dynamodb:BatchGetItem",
                    "dynamodb:Query",
                    "dynamodb:DescribeTable",
                    "dynamodb:CreateTable"

                ],
                "Resource": [policyParams.userTableArn, policyParams.userTableArn + '/*'],
                "Condition": {
                    "ForAllValues:StringEquals": {
                        "dynamodb:LeadingKeys": [policyParams.tenantId]
                    }
                }

            },
            {
                "Sid": "TenantCognitoAccess",
                "Effect": "Allow",
                "Action": [
                    "cognito-idp:AdminGetUser",
                    "cognito-idp:ListUsers"
                ],
                "Resource": [policyParams.cognitoArn]
            },
        ]
    };
};

/**
 * Get the IAM policies for a System Admin user
 * @param policyParams Dictionary with configuration parameters
 * @returns The populated tenant user policy template
 */
export const getSystemAdminPolicy = (policyParams) => {
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "TenantSystemAdminTenantTable",
                "Effect": "Allow",
                "Action": ["dynamodb:*"],
                "Resource": [policyParams.tenantTableArn]
            },
            {
                "Sid": "TenantSystemAdminUserTable",
                "Effect": "Allow",
                "Action": ["dynamodb:*"],
                "Resource": [policyParams.userTableArn, policyParams.userTableArn + '/*']
            },
            {
                "Sid": "FullCognitoFederatedIdentityAccess",
                "Effect": "Allow",
                "Action": ["cognito-identity:*"],
                "Resource": ["*"]
            },
            {
                "Sid": "FullCognitoUserPoolAccess",
                "Effect": "Allow",
                "Action": ["cognito-idp:*"],
                "Resource": ["*"]
            }
        ]
    };
};

/**
 /**
 * Get the IAM policies for a System Admin user
 * @param policyParams Dictionary with configuration parameters
 * @returns The populated tenant user policy template
 */
export const getSystemUserPolicy = (policyParams) => {
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "TenantSystemUserTenantTable",
                "Effect": "Allow",
                "Action": [
                    "dynamodb:GetItem",
                    "dynamodb:BatchGetItem",
                    "dynamodb:Scan",
                    "dynamodb:Query",
                    "dynamodb:DescribeTable",
                    "dynamodb:CreateTable"
                ],
                "Resource": [policyParams.tenantTableArn]
            },
            {
                "Sid": "TenantSystemUserUserTable",
                "Effect": "Allow",
                "Action": [
                    "dynamodb:GetItem",
                    "dynamodb:BatchGetItem",
                    "dynamodb:Scan",
                    "dynamodb:Query",
                    "dynamodb:DescribeTable",
                    "dynamodb:CreateTable"

                ],
                "Resource": [policyParams.userTableArn]
            },
            {
                "Sid": "FullReadCognitoIdentityAccess",
                "Effect": "Allow",
                "Action": [
                    "cognito-identity:DescribeIdentity",
                    "cognito-identity:DescribeIdentityPool",
                    "cognito-identity:GetIdentityPoolRoles",
                    "cognito-identity:ListIdentities",
                    "cognito-identity:ListIdentityPools",
                    "cognito-identity:LookupDeveloperIdentity"
                ],
                "Resource": ["*"]
            },
            {
                "Sid": "FullReadCognitoUserPoolsAccess",
                "Effect": "Allow",
                "Action": [
                    "cognito-idp:AdminGetDevice",
                    "cognito-idp:AdminGetUser",
                    "cognito-idp:AdminListDevices",
                    "cognito-idp:AdminListGroupsForUser",
                    "cognito-idp:AdminResetUserPassword",
                    "cognito-idp:DescribeUserImportJob",
                    "cognito-idp:DescribeUserPool",
                    "cognito-idp:DescribeUserPoolClient",
                    "cognito-idp:GetCSVHeader",
                    "cognito-idp:GetGroup",
                    "cognito-idp:ListGroups",
                    "cognito-idp:ListUserImportJobs",
                    "cognito-idp:ListUserPoolClients",
                    "cognito-idp:ListUserPools",
                    "cognito-idp:ListUsers",
                    "cognito-idp:ListUsersInGroup"
                ],
                "Resource": ["*"]
            }
        ]
    };
};

/**
 * Create a policy using the provided configuration parameters
 * @param policyParams The policy configuration
 */
export const createPolicy = (policyParams): Promise<any> => {
    return new Promise((resolve, reject) => {
        let iam = new AWS.IAM({apiVersion: '2010-05-08'});

        let policyDoc = JSON.stringify(policyParams.policyDocument);
        let params = {
            PolicyDocument: policyDoc, /* required */
            PolicyName: policyParams.policyName, /* required */
            Description: policyParams.policyName
        };

        iam.createPolicy(params, (err, createdPolicy) => {
            if (err) {
                reject(err);
            } else {
                resolve(createdPolicy);
            }
        });
    });
};

/**
 * Create a role from the supplied params
 * @param roleParams The role configuration
 */
export const createRole = (roleParams): Promise<any> => {
    return new Promise((resolve, reject) => {
        let iam = new AWS.IAM({apiVersion: '2010-05-08'});

        let policyDoc = JSON.stringify(roleParams.policyDocument);
        let params = {
            AssumeRolePolicyDocument: policyDoc, /* required */
            RoleName: roleParams.roleName
        };

        iam.createRole(params, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
};

/**
 * Add a created policy to a role
 * @param policyRoleParams The policy and role to be configured
 */
export const addPolicyToRole = (policyRoleParams): Promise<any> => {
    return new Promise((resolve, reject) => {
        let iam = new AWS.IAM({apiVersion: '2010-05-08'});
        // let policyDoc = JSON.stringify(policyRoleParams.policyDocument);
        let params = {
            PolicyArn: policyRoleParams.PolicyArn, /* required */
            RoleName: policyRoleParams.RoleName /* required */
        };

        iam.attachRolePolicy(params, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
};

/**
 * Add system roles to an identity pool
 * @param identityPoolRoleParams The configuration of the pool and roles
 * @returns {Promise} Promise with status of assignment
 */
export const addRoleToIdentity = (identityPoolRoleParams): Promise<any> => {
    return new Promise((resolve, reject) => {
        let cognitoIdentity = new AWS.CognitoIdentity({apiVersion: '2014-06-30', region: configuration.aws_region});
        // let policyDoc = JSON.stringify(identityPoolRoleParams.policyDocument);
        let providerName = 'cognito-idp.' + configuration.cognito_region + '.amazonaws.com/' + identityPoolRoleParams.provider + ':' + identityPoolRoleParams.ClientId;

        let params = {
            IdentityPoolId: identityPoolRoleParams.IdentityPoolId, /* required */
            Roles: {
                /* required */
                authenticated: identityPoolRoleParams.trustAuthRole
            },
            RoleMappings: {
                Provider: {
                    Type: 'Rules', /* required */
                    AmbiguousRoleResolution: 'Deny',
                    RulesConfiguration: {
                        Rules: [/* required */
                            {
                                Claim: 'custom:role', /* required */
                                MatchType: 'Equals', /* required */
                                RoleARN: identityPoolRoleParams.roleSystem, /* required */
                                Value: identityPoolRoleParams.adminRoleName /* required */
                            },
                            {
                                Claim: 'custom:role', /* required */
                                MatchType: 'Equals', /* required */
                                RoleARN: identityPoolRoleParams.roleSupportOnly, /* required */
                                Value: identityPoolRoleParams.userRoleName /* required */
                            },
                        ]
                    }
                }
            }
        };

        params = JSON.parse(JSON.stringify(params).split('Provider').join(providerName));
        cognitoIdentity.setIdentityPoolRoles(params, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
};

/**
 * Changed the enabled status of a Cognito user
 * @param credentials Credentials to be used for the call
 * @param userPoolId The user pool Id for the user to be changed
 * @param userName The user name of the user to be changed
 * @param enable True if enabling, false for disabling
 * @returns {Promise} Status of the enable/disable call
 */
export const updateUserEnabledStatus = (credentials, userPoolId, userName, enable): Promise<any> => {
    return new Promise((resolve, reject) => {
        // configure the identity provider
        let cognitoIdentityServiceProvider = new AWS.CognitoIdentityServiceProvider({
            apiVersion: '2016-04-18',
            sessionToken: credentials.claim.SessionToken,
            accessKeyId: credentials.claim.AccessKeyId,
            secretAccessKey: credentials.claim.SecretKey,
            region: configuration.aws_region
        });

        // init the params
        let params = {
            UserPoolId: userPoolId, /* required */
            Username: userName /* required */
        };

        // enable/disable the Cognito user
        if (enable) {
            cognitoIdentityServiceProvider.adminEnableUser(params, (err, data) => {
                if (err)
                    reject(err);
                else
                    resolve(data);
            });
        } else {
            cognitoIdentityServiceProvider.adminDisableUser(params, (err, data) => {
                if (err)
                    reject(err);
                else
                    resolve(data);
            });

        }
    });
};

/**
 * Get a list of users from a user pool
 * @param credentials The credentials for the search
 * @param userPoolId The user pool id to scope the access
 * @param region The region for the search
 * @returns {Promise} A collection of found users
 */
export const getUsersFromPool = (credentials, userPoolId, region): Promise<any> => {
    return new Promise((resolve, reject) => {

        // init the Cognito service provider
        let cognitoIdentityServiceProvider = new AWS.CognitoIdentityServiceProvider({
            apiVersion: '2016-04-18',
            sessionToken: credentials.claim.SessionToken,
            accessKeyId: credentials.claim.AccessKeyId,
            secretAccessKey: credentials.claim.SecretKey,
            region: region
        });

        // search configuration
        let searchParams = {
            UserPoolId: userPoolId, /* required */
            AttributesToGet: [
                'email',
                'custom:tenant_id',
                'custom:role',
                'custom:tier',
                'given_name',
                'family_name',
                'sub'
                /* more items */
            ],
            Limit: 0
        };

        // request the list of users from Cognito
        cognitoIdentityServiceProvider.listUsers(searchParams, (err, data) => {
            if (err)
                reject(err);
            else {
                let userList = [];
                data.Users.forEach((cognitoUser) => {
                    let user = getUserFromCognitoUser(cognitoUser, cognitoUser.Attributes);
                    userList.push(user);
                });
                resolve(userList);
            }
        });
    });
};

/**
 * Update the attributes of a user
 * @param credentials The credentials for the update
 * @param user The information for the user being updated
 * @param userPoolId
 * @param region The region used for updating the user
 * @returns {Promise} The status of the user update
 */
export const updateUser = (credentials, user, userPoolId, region): Promise<any> => {
    return new Promise((resolve, reject) => {
        let cognitoIdentityServiceProvider = new AWS.CognitoIdentityServiceProvider({
            apiVersion: '2016-04-18',
            sessionToken: credentials.claim.SessionToken,
            accessKeyId: credentials.claim.AccessKeyId,
            secretAccessKey: credentials.claim.SecretKey,
            region: region
        });

        // init the update parameters
        let params = {
            UserAttributes: [/* required */
                {
                    Name: 'custom:role', /* required */
                    Value: user.role
                },
                {
                    Name: 'given_name', /* required */
                    Value: user.firstName
                },
                {
                    Name: 'family_name', /* required */
                    Value: user.lastName
                }
            ],
            UserPoolId: userPoolId, /* required */
            Username: user.userName /* required */
        };

        // send the update to Cognito
        cognitoIdentityServiceProvider.adminUpdateUserAttributes(params, (err, data) => {
            if (err)
                reject(err);
            else
                resolve(data);
        });
    });
};

/**
 * Delete a user from Cognito
 * @param credentials The credentials used for the delete
 * @param userId The id of the user being deleted
 * @param userPoolId The user pool where the user resides
 * @param region The region for the credentials
 * @returns {Promise} Results of the deletion
 */
export const deleteUser = (credentials, userId, userPoolId, region): Promise<any> => {
    return new Promise((resolve, reject) => {
        // init the identity provider
        let cognitoIdentityServiceProvider = new AWS.CognitoIdentityServiceProvider({
            apiVersion: '2016-04-18',
            sessionToken: credentials.claim.SessionToken,
            accessKeyId: credentials.claim.AccessKeyId,
            secretAccessKey: credentials.claim.SecretKey,
            region: region
        });

        // init deletion parameters
        let params = {
            UserPoolId: userPoolId, /* required */
            Username: userId /* required */
        };

        // call Cognito to delete the user
        cognitoIdentityServiceProvider.adminDeleteUser(params, (err, data) => {
            if (err)
                reject(err);
            else
                resolve(data);
        });
    });
};

/**
 * Delete a userPool from Cognito
 * @param userPoolId The user pool where the user resides
 * @param _region
 * @returns {Promise} Results of the deletion
 */
export const deleteUserPool = (userPoolId, _region?): Promise<any> => {
    return new Promise((resolve, reject) => {
        // init the identity provider
        let cognitoIdentityServiceProvider = new AWS.CognitoIdentityServiceProvider({
            apiVersion: '2016-04-18',
            region: configuration.aws_region
        });

        let params = {
            UserPoolId: userPoolId /* required */
        };

        // call Cognito to delete the user
        cognitoIdentityServiceProvider.deleteUserPool(params, (err, data) => {
            if (err)
                reject(err);
            else
                resolve(data);
        });
    });
};

/**
 * Delete a Cognito Identity Pool with the supplied params
 * @param IdentityPoolId The client config params
 * @returns {Promise} A promise with the identity pools results
 */
export const deleteIdentityPool = (IdentityPoolId): Promise<any> => {
    return new Promise((resolve, reject) => {

        // init identity params
        let cognitoIdentity = new AWS.CognitoIdentity({apiVersion: '2014-06-30', region: configuration.aws_region});

        let params = {
            IdentityPoolId: IdentityPoolId /* required */
        };

        // delete identity pool
        cognitoIdentity.deleteIdentityPool(params, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
};

/**
 * Delete a role from the supplied params
 * @param role The role name
 */
export const deleteRole = (role): Promise<any> => {
    return new Promise((resolve, reject) => {
        let iam = new AWS.IAM({apiVersion: '2010-05-08'});


        let params = {
            RoleName: role /* required */
        };

        iam.deleteRole(params, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
};

/**
 * Delete a policy using the provided configuration parameters
 * @param policy The policy arn
 */
export const deletePolicy = (policy): Promise<any> => {
    return new Promise((resolve, reject) => {
        let iam = new AWS.IAM({apiVersion: '2010-05-08'});

        let params = {
            PolicyArn: policy /* required */
        };
        iam.deletePolicy(params, (err, deletedPolicy) => {
            if (err) {
                reject(err);
            } else {
                resolve(deletedPolicy);
            }
        });
    });
};

/**
 * Detach a role policy using the provided configuration parameters
 * @param policy The policy arn
 * @param role The role name
 */
export const detachRolePolicy = (policy, role): Promise<any> => {
    return new Promise((resolve, reject) => {
        let iam = new AWS.IAM({apiVersion: '2010-05-08'});
        let params = {
            PolicyArn: policy, /* required */
            RoleName: role /* required */
        };
        iam.detachRolePolicy(params, (err, detachedPolicy) => {
            if (err) {
                reject(err);
            } else {
                resolve(detachedPolicy);
            }
        });
    });
};

/**
 * Delete a DynamoDB Table using the provided configuration parameters
 * @param table The DynamoDB Table Name
 */
export const deleteTable = (table): Promise<any> => {
    return new Promise((resolve, reject) => {
        let dynamoDB = new AWS.DynamoDB({apiVersion: '2012-08-10', region: configuration.aws_region});
        let params = {
            TableName: table /* required */
        };
        dynamoDB.deleteTable(params, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
};
