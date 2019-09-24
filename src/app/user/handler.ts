import { APIGatewayProxyHandler, Handler, APIGatewayProxyResult } from 'aws-lambda';
import * as bodyParser from 'body-parser';
import * as uuidV4 from 'uuid/v4';
import * as configModule from '../common/config-manager/config';
import * as tokenManager from '../common/token-manager/token';
import DynamoDBManager from '../common/dynamodb-manager/dynamodb';

import * as winston from 'winston';
import * as request from 'request';


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
const tenantUrl: string = configuration.url.tenant;

const userUrl: string = configuration.url.user;


var userSchema = {
  TableName : configuration.table.user,
  KeySchema: [
      { AttributeName: "tenant_id", KeyType: "HASH"},  //Partition key
      { AttributeName: "id", KeyType: "RANGE" }  //Sort key
  ],
  AttributeDefinitions: [
      { AttributeName: "tenant_id", AttributeType: "S" },
      { AttributeName: "id", AttributeType: "S" }
  ],
  ProvisionedThroughput: {
      ReadCapacityUnits: 10,
      WriteCapacityUnits: 10
  },
  GlobalSecondaryIndexes: [
      {
          IndexName: 'UserNameIndex',
          KeySchema: [
              { AttributeName: "id", KeyType: "HASH"}
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
  const headers = { "Access-Control-Allow-Origin": "*" };

  tokenManager.getSystemCredentials(
    (credentials) => {
      lookupUserPoolData(credentials, event.queryStringParameters.id, null, true, (err, user) => {
        if (err) {
          return {
            statusCode: 400,
            headers: headers,
            body: JSON.stringify({
              message: { error: "Error registering new system admin user" }
            })
          };
        } else {
          if (user.length == 0) return {
            statusCode: 400,
            headers: headers,
            body: JSON.stringify({
              message: { error: "User not found" }
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

}

export const userSystem: Handler = async (event, _context) => {
  let user =  event.body;
  user.tier = configuration.tier.system;
  user.role = configuration.userRole.systemAdmin;
  // get the credentials for the system user
  var credentials = {};
  tokenManager.getSystemCredentials(function (systemCredentials) {
      if(systemCredentials) {
          credentials = systemCredentials;
          // provision the tenant admin and roles
          provisionAdminUserWithRoles(user, credentials, configuration.userRole.systemAdmin, configuration.userRole.systemUser,
              function (err, result) {
                  if (err) {
                      res.status(400).send("Error provisioning system admin user");
                  }
                  else {
                      res.status(200).send(result);
                  }
              });
      }
      else{
          winston.debug("Error Obtaining System Credentials");
      }
  });
}

/**
 * Provision an admin user and the associated policies/roles
 * @param user The user being created
 * @param credentials Credentials to use for provisioning
 * @param adminPolicyName The name of of the admin policy to provisioned
 * @param userPolicyName The name of the user policy to be provisioned
 * @param callback Returns an object with the results of the provisioned items
 */
function provisionAdminUserWithRoles(user, credentials, adminPolicyName, userPolicyName, callback) {
  // vars that are used across multiple calls
  var createdUserPoolData = {};
  var trustPolicyTemplate = {};
  var createdTrustPolicyRole = {};
  var createdUserPoolClient = {};
  var createdIdentityPool = {};
  var createdAdminPolicy = {};
  var createdAdminRole = {};
  var createdUserPolicy = {};
  var createdUserRole = {};

  // setup params for template generation
  var policyCreationParams = {
      tenantId: user.tenant_id,
      accountId: configuration.aws_account,
      region: configuration.aws_region,
      tenantTableName: configuration.table.tenant,
      userTableName: configuration.table.user,
      productTableName: configuration.table.product,
      orderTableName: configuration.table.order
  };

  // init role based on admin policy name
  user.role = adminPolicyName;

  // see if this user is already in the system
  lookupUserPoolData(credentials, user.userName, user.tenant_id, true, function(err, userPoolData) {
      if (!err){
          callback( new Error ('{"Error" : "User already exists"}'));
          winston.debug('{"Error" : "User already exists"}');
      }
      else {
          // create the new user
          cognitoUsers.createUserPool(user.tenant_id)
              .then(function (poolData) {
                  createdUserPoolData = poolData;

                  var clientConfigParams = {
                      "ClientName": createdUserPoolData.UserPool.Name,
                      "UserPoolId": createdUserPoolData.UserPool.Id
                  };

                  // add the user pool to the policy template configuration (couldn't add until here)
                  policyCreationParams.userPoolId = createdUserPoolData.UserPool.Id;

                  // crete the user pool for the new tenant
                  return cognitoUsers.createUserPoolClient(clientConfigParams);
              })
              .then(function(userPoolClientData) {
                  createdUserPoolClient = userPoolClientData;
                  var identityPoolConfigParams = {
                      "ClientId": userPoolClientData.UserPoolClient.ClientId,
                      "UserPoolId": userPoolClientData.UserPoolClient.UserPoolId,
                      "Name": userPoolClientData.UserPoolClient.ClientName
                  };
                  return cognitoUsers.createIdentityPool(identityPoolConfigParams);
              })
              .then(function(identityPoolData) {
                  createdIdentityPool = identityPoolData;

                  // create and populate policy templates
                  trustPolicyTemplate = cognitoUsers.getTrustPolicy(identityPoolData.IdentityPoolId);

                  // get the admin policy template
                  var adminPolicyTemplate = cognitoUsers.getPolicyTemplate(adminPolicyName, policyCreationParams);

                  // setup policy name
                  var policyName = user.tenant_id + '-' + adminPolicyName + 'Policy';

                  // configure params for policy provisioning calls
                  var adminPolicyParams = {
                      "policyName": policyName,
                      "policyDocument": adminPolicyTemplate
                  };

                  return cognitoUsers.createPolicy(adminPolicyParams)
              })
              .then(function (adminPolicy) {
                  createdAdminPolicy = adminPolicy;
                  return createNewUser(credentials, createdUserPoolData.UserPool.Id, createdIdentityPool.IdentityPoolId, createdUserPoolClient.UserPoolClient.ClientId, user.tenant_id, user);
              })
              .then(function() {
                  // get the admin policy template
                  var userPolicyTemplate = cognitoUsers.getPolicyTemplate(userPolicyName, policyCreationParams);

                  // setup policy name
                  var policyName = user.tenant_id + '-' + userPolicyName + 'Policy';

                  // configure params for policy provisioning calls
                  var userPolicyParams = {
                      "policyName": policyName,
                      "policyDocument": userPolicyTemplate
                  };

                  return cognitoUsers.createPolicy(userPolicyParams)
              })
              .then(function(userPolicy) {
                  createdUserPolicy = userPolicy;

                  var adminRoleName = user.tenant_id + '-' + adminPolicyName;
                  var adminRoleParams = {
                      "policyDocument": trustPolicyTemplate,
                      "roleName": adminRoleName
                  };

                  return cognitoUsers.createRole(adminRoleParams);
              })
              .then(function(adminRole) {
                  createdAdminRole = adminRole;

                  var userRoleName = user.tenant_id + '-' + userPolicyName;
                  var userRoleParams = {
                      "policyDocument": trustPolicyTemplate,
                      "roleName": userRoleName
                  };

                  return cognitoUsers.createRole(userRoleParams)
              })
              .then(function(userRole) {
                  createdUserRole = userRole;
                  var trustPolicyRoleName = user.tenant_id + '-Trust';
                  var trustPolicyRoleParams = {
                      "policyDocument": trustPolicyTemplate,
                      "roleName": trustPolicyRoleName
                  };

                  return cognitoUsers.createRole(trustPolicyRoleParams)
              })
              .then(function(trustPolicyRole) {
                  createdTrustPolicyRole = trustPolicyRole;
                  var adminPolicyRoleParams = {
                      PolicyArn: createdAdminPolicy.Policy.Arn,
                      RoleName: createdAdminRole.Role.RoleName
                  };

                  return cognitoUsers.addPolicyToRole(adminPolicyRoleParams);
              })
              .then(function() {
                  var userPolicyRoleParams = {
                      PolicyArn: createdUserPolicy.Policy.Arn,
                      RoleName: createdUserRole.Role.RoleName
                  };

                  return cognitoUsers.addPolicyToRole(userPolicyRoleParams);
              })
              .then(function() {
                  var addRoleToIdentityParams = {
                      "IdentityPoolId": createdIdentityPool.IdentityPoolId,
                      "trustAuthRole": createdTrustPolicyRole.Role.Arn,
                      "rolesystem": createdAdminRole.Role.Arn,
                      "rolesupportOnly": createdUserRole.Role.Arn,
                      "ClientId": createdUserPoolClient.UserPoolClient.ClientId,
                      "provider": createdUserPoolClient.UserPoolClient.UserPoolId,
                      "adminRoleName": adminPolicyName,
                      "userRoleName": userPolicyName
                  };

                  return cognitoUsers.addRoleToIdentity(addRoleToIdentityParams);
              })
              .then(function(identityRole) {
                  var returnObject = {
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
              .catch (function(err) {
                  winston.debug(err)
                  callback(err);
              });
      }
  });
}


/**
 * Lookup a user's pool data in the user table
 * @param credentials The credentials used ben looking up the user
 * @param userId The id of the user being looked up
 * @param tenantId The id of the tenant (if this is not system context)
 * @param isSystemContext Is this being called in the context of a system user (registration, system user provisioning)
 * @param callback The results of the lookup
 */
function lookupUserPoolData(credentials, userId, tenantId, isSystemContext, callback) {

  // construct the helper object
  var dynamoHelper = new DynamoDBManager(userSchema, credentials, configuration);

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
      dynamoHelper.query(searchParams, credentials, function (err, users) {
          if (err) {
              winston.error('Error getting user: ' + err.message);
              callback(err);
          }
          else {
              if (users.length == 0) {
                  let err = new Error('No user found: ' + userId);
                  callback(err);
              }
              else
                  callback(null, users[0]);
          }
      });
  }
  else {
      // if this is a tenant context, then we must get with tenant id scope
      let searchParams = {
          id: userId,
          tenant_id: tenantId
      }

      // get the item from the database
      dynamoHelper.getItem(searchParams, credentials, function (err, user) {
          if (err) {
              winston.error('Error getting user: ' + err.message);
              callback(err);
          }
          else {
              callback(null, user);
          }
      });
  }
}


export const hello: APIGatewayProxyHandler = async (event, _context) => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Go Serverless Webpack (Typescript) v1.0! Your function executed successfully!',
      input: event,
    }),
  };
};
