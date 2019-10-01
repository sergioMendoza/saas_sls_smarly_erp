import {Handler} from 'aws-lambda';
import * as AmazonCognitoIdentity from 'amazon-cognito-identity-js';
import * as configModule from '../common/config-manager/config';
import * as tokenManager from '../common/token-manager/token';
import * as winston from 'winston';
import fetch from 'node-fetch';

global['fetch'] = fetch;

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

// cognito pool init
const CognitoUserPool = AmazonCognitoIdentity.CognitoUserPool;

export const auth: Handler = (event, _context, callback) => {
    let user = JSON.parse(event.body);
    tokenManager.getUserPool(user.userName, (error, userPoolLookup) => {
        if (!error) {
            // get the pool data from the response
            let poolData = {
                UserPoolId: userPoolLookup.userPoolId,
                ClientId: userPoolLookup.client_id
            };
            // construct a user pool object
            let userPool = new CognitoUserPool(poolData);
            // configure the authentication credentials
            let authenticationData = {
                Username: user.userName,
                Password: user.password
            };
            // create object with user/pool combined
            let userData = {
                Username: user.userName,
                Pool: userPool
            };
            // init Cognito auth details with auth data
            let authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails(authenticationData);
            // authenticate user to in Cognito user pool
            let cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);
            const cognitoCallback = {
                onSuccess: (result) => {
                    // get the ID token
                    let idToken = result.getIdToken().getJwtToken();
                    let AccessToken = result.getAccessToken().getJwtToken();
                    callback(null, {
                        statusCode: 200,
                        body: JSON.stringify({token: idToken, access: AccessToken})
                    });
                },
                onFailure: (err) => {
                    callback(new Error('[400] ' + JSON.stringify(err)))
                },
                mfaRequired: (_codeDeliveryDetails) => {
                    // MFA is required to complete user authentication.
                    // Get the code from user and call
                    //MFA is Disabled. This may be submitted as an enhancement, if their are sufficient requests.
                    let mfaCode = '';

                    if (user.mfaCode == undefined) {
                        callback(null, {
                            statusCode: 200,
                            body: JSON.stringify({
                                mfaRequired: true
                            })
                        });
                    }
                    cognitoUser.sendMFACode(mfaCode, cognitoCallback)

                },
                newPasswordRequired: (userAttributes, _requiredAttributes) => {
                    // User was signed up by an admin and must provide new
                    // password and required attributes, if any, to complete
                    // authentication.
                    if (user.newPassword == undefined) {
                        callback(null, {
                            statusCode: 200,
                            body: JSON.stringify({newPasswordRequired: true})
                        });
                    }
                    // These attributes are not mutable and should be removed from map.
                    delete userAttributes.email_verified;
                    delete userAttributes['custom:tenant_id'];
                    cognitoUser.completeNewPasswordChallenge(user.newPassword, userAttributes, cognitoCallback);
                }
            };
            cognitoUser.authenticateUser(authenticationDetails, cognitoCallback);
        } else {
            winston.error("Error Authenticating User: ", error);
            callback(new Error('[404] ' + JSON.stringify(error)));
        }
    });
};
