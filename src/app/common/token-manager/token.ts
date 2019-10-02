import * as jwtDecode from 'jwt-decode';
import * as request from 'request';
import * as async from 'async';
import * as AWS from 'aws-sdk';

import * as configModule from '../config-manager/config';
import * as winston from 'winston';

const configuration = configModule.configure(process.env.ENV);

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

let tokenCache = {};

export const getTenantId = (event): string => {
    let tenantId = '';
    let bearerToken = event.headers['Authorization'];
    if (bearerToken) {
        bearerToken = bearerToken.substring(bearerToken.indexOf(' ') + 1);
        let decodedIdToken = jwtDecode(bearerToken);
        if (decodedIdToken)
            tenantId = decodedIdToken['custom:tenant_id'];
    }
    return tenantId;
}

export const getTokenId = (req): string => {
    let tenantId = '';
    let bearerToken = req.get('Authorization');
    if (bearerToken) {
        bearerToken = bearerToken.substring(bearerToken.indexOf(' ') + 1);
        let decodedIdToken = jwtDecode(bearerToken);
        if (decodedIdToken)
            tenantId = decodedIdToken['custom:tenant_id'];
    }
    return tenantId;
};

export const getUserRole = (req, callback) => {
    let bearerToken = req.get('Authorization');
    if (bearerToken) {
        bearerToken = bearerToken.substring(bearerToken.indexOf(' ') + 1);
        let decodedIdToken = jwtDecode(bearerToken);
        if (decodedIdToken)
            callback(decodedIdToken['custom:role']);
        else
            callback('unknown');
    }
};

export const getUserFullName = (idToken) => {
    let userFullName: string | object = '';
    if (idToken) {
        let decodedIdToken = jwtDecode(idToken);
        if (decodedIdToken)
            userFullName = {firstName: decodedIdToken.given_name, lastName: decodedIdToken.family_name};
    }
    return userFullName;
};

export const getRequestAuthToken = (event): string => {
    let authToken = '';
    let authHeader = event.headers['Authorization'];
    if (authHeader)
        authToken = authHeader.substring(authHeader.indexOf(' ') + 1);
    return authToken;
};

export const decodeToken = (bearerToken) => {
    let resultToken = {};
    if (bearerToken) {
        let decodedIdToken = jwtDecode(bearerToken);
        if (decodedIdToken)
            resultToken = decodedIdToken;
    }
    return resultToken;
};

export const checkRole = (bearerToken) => {
    let resultToken = {};
    if (bearerToken) {
        let decodedIdToken = jwtDecode(bearerToken);
        if (decodedIdToken)
            resultToken = decodedIdToken['custom:role'];
    }
    return resultToken;
};

export const decodeOpenID = (bearerToken) => {
    let resultToken = {};
    if (bearerToken) {
        let decodedIdToken = jwtDecode(bearerToken);
        if (decodedIdToken)
            resultToken = decodedIdToken;
    }
    return resultToken;
};

export const getCredentialsFromToken = (event, updateCredentials) => {
    event.headers['Authorization']
    let bearerToken = event.headers['Authorization'];
    if (bearerToken) {
        let tokenValue = bearerToken.substring(bearerToken.indexOf(' ') + 1);
        if (!(tokenValue in tokenCache)) {
            let decodedIdToken = jwtDecode(tokenValue);
            let userName = decodedIdToken['cognito:username'];
            async.waterfall([
                (callback) => {
                    getUserPoolWithParams(userName, callback)
                },
                (userPool, callback) => {
                    authenticateUserInPool(userPool, tokenValue, callback)
                }
            ], (error, results) => {
                if (error) {
                    winston.error('Error fetching credentials for user');
                    updateCredentials(null);
                } else {
                    tokenCache[tokenValue] = results;
                    updateCredentials(results);
                }
            });
        } else if (tokenValue in tokenCache) {
            winston.debug('Getting credentials from cache');
            updateCredentials(tokenCache[tokenValue]);
        }
    }
};

export const getUserPool = (userName, callback) => {
    // Create URL for user-manager request
    // let userURL = userURL + '/system/' + userName;
    let userURL = configuration.url.user + '/pool/' + userName;
    winston.info('user URL: '+userURL);
    request({
        url: userURL,
        method: "GET",
        json: true,
        headers: {
            "content-type": "application/json",
        }
    }, (error, response, body) => {
        if (!error && response.statusCode === 200) {
            callback(null, body);
        } else {
            if (!error) {
                let lookupError = new Error("Failed looking up user pool: " + response.body.Error);
                callback(lookupError, response);
            } else {
                callback(error, response)
            }
        }
    });
};

export const getUserPoolWithParams = (userName, callback) => {

    let userURL = configuration.url.user + '/pool/' + userName;
    // fire the request
    request({
        url: userURL,
        method: "GET",
        json: true,
        headers: {
            "content-type": "application/json",
        }
    }, (error, response, body) => {
        if (!error && response.statusCode === 200) {
            callback(null, body);
        } else {
            callback(null, "Error loading user: " + error);
        }
    });
};

export const getInfra = (_input, callback) => {
    // Create URL for user-manager request
    // let userURL = userURL + '/system/' + userName;
    let tenantsUrl = configuration.url.tenant + 's/system/';
    console.log(tenantsUrl);
    request({
        url: tenantsUrl,
        method: "GET",
        json: true,
        headers: {
            "content-type": "application/json",
        }
    }, (error, response, body) => {
        if (!error && response.statusCode === 200) {
            callback(null, body);
        } else {
            if (!error) {
                let lookupError = new Error("Failed looking up infra: " + response.body.Error);
                callback(lookupError, response);
            } else {
                callback(error, response)
            }
        }
    });
};

export const fireRequest = (event, callback) => {

    let protocol = event.protocol;
    let path = event.path;
    let delimiter = '://';
    let domain = event.domain;
    let url = protocol + delimiter + domain + path;
    // fire the request
    request({
        url: url,
        method: event.method,
        json: true,
        headers: {
            "content-type": "application/json",
        }
    }, (error, response, body) => {
        if (!error && response.statusCode === 200) {
            callback(body);
        } else {
            callback(null, 'Error making request. \nError: ' + error);
        }
    });
};

export const authenticateUserInPool = (userPool, idToken, callback) => {
    let decodedIdToken = jwtDecode(idToken);
    let provider = decodedIdToken.iss;
    provider = provider.replace('https://', '');
    let params = {
        token: idToken,
        provider: provider,
        IdentityPoolId: userPool.IdentityPoolId
    };
    //let getIdentity =
     getId(params, (ret, _data) => {
        if (ret) {
            let params = {
                token: idToken,
                IdentityId: ret.IdentityId,
                provider: provider
            };
            //let returnedIdentity = ret;
            //let getCredentials = 
            getCredentialsForIdentity(params, (ret, _data) => {
                if (ret) {
                    // put claim and user full name into one response
                    callback(null, {"claim": ret.Credentials});
                } else {
                    winston.error('ret');
                }
            })
        } else {
            winston.error('ret');
        }
    })
};

export const getCredentialsForIdentity = (event, callback) => {
    let cognitoIdentity = new AWS.CognitoIdentity({apiVersion: '2014-06-30', region: configuration.aws_region});
    let params = {
        IdentityId: event.IdentityId, /* required */
        //CustomRoleArn: 'STRING_VALUE',
        Logins: {
            [event.provider]: event.token,
            /* '<IdentityProviderName>': ... */
        }
    };
    cognitoIdentity.getCredentialsForIdentity(params, (err, data) => {
        if (err) {
            winston.debug(err.message, err.stack);
            callback(err);
        } else {
            callback(data);
        }
    });
};

export const getId = (event, callback) => {
    let cognitoIdentity = new AWS.CognitoIdentity({apiVersion: '2014-06-30', region: configuration.aws_region});
    let params = {
        IdentityPoolId: event.IdentityPoolId, /* required */
        AccountId: configuration.aws_account,
        Logins: {
            [event.provider]: event.token,
            /* '<IdentityProviderName>': ... */
        }
    };
    cognitoIdentity.getId(params, (err, data) => {
        if (err) {
            winston.debug(err.message, err.stack);
            callback(err);
        } else {
            callback(data);
        }
    });
};

export const getSystemCredentials = (callback) => {
    let sysCredentials: any = '';
    let sysConfig = new AWS.Config();
    sysConfig.getCredentials((err) => {
            if (err) {
                callback(err.stack);
                winston.debug('Unable to Obtain Credentials');
            } // credentials not loaded
            else {
                let tempCredentials = sysConfig.credentials;
                if (tempCredentials != null) {
                    sysCredentials = tempCredentials;
                }
                let credentials = {"claim": sysCredentials};
                callback(credentials);
            }

        }
    );
};
