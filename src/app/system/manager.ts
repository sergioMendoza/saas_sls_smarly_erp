import * as request from 'request';
import { SaasConfig } from '../common/config-manager/config';
import * as winston from "winston";

const axios = require('axios').default;

export interface TenantAdmin {
    tenant_id: string;
    email: string;
    userName: string;
    role: string;
    companyName?: string;
    accountName?: string;
    ownerName?: string;
    tier?: string;
    firstName?: string;
    lastName?: string;
}

export interface Tenant {
    id?: string,
    companyName: string,
    accountName: string,
    ownerName: string,
    tier?: string,
    email: string,
    status?: string,
    UserPoolId?: string,
    IdentityPoolId?: string,
    systemAdminRole?: string,
    systemSupportRole?: string,
    trustRole?: string,
    systemAdminPolicy?: string,
    systemSupportPolicy?: string,
    userName: string,
    role?: string,
    firstName: string,
    lastName: string
}

export class TenantAdminManager {

    static reg(tenant: Tenant, configuration: SaasConfig): Promise<any> {

        winston.info('configurations' + JSON.stringify(configuration));

        let regTenantUserUrl = configuration.url.user + '/system';

        let tenantAdmin = {
            "tenant_id": tenant.id,
            "companyName": tenant.companyName,
            "accountName": tenant.accountName,
            "ownerName": tenant.ownerName,
            "email": tenant.email,
            "userName": tenant.userName,
            "firstName": tenant.firstName,
            "lastName": tenant.lastName
        };


        return new Promise((resolve, reject) => {
            // User service REST API URL
            winston.debug('regTenantUserUrl: ' + regTenantUserUrl);
            winston.debug('tenant Admin: ' + JSON.stringify(tenantAdmin));
            // FIRE IN THE HOLE!!!
            // request({
            //     url: regTenantUserUrl,
            //     method: "POST",
            //     json: true,
            //     headers: { "content-type": "application/json" },
            //     body: tenantAdmin
            // }, (error, response, body) => {
            //     winston.info('retrieving tenant data...');
            //     winston.debug('response: ' + JSON.stringify(response));
            //     if (error || (response.statusCode != 200)) {
            //         winston.error('error regTenantUserUrl: ' + JSON.stringify(error));
            //         reject(error);
            //     } else {
            //         winston.debug('regTenantUserUrl: ' + JSON.stringify(body));
            //         resolve(body);
            //     }
            // });

            axios.post('https://dev-api.smartlyerp.com/users/', tenantAdmin)
                .then(function (response) {
                    winston.info('retrieving tenant data...');
                    winston.debug('response: ' + JSON.stringify(response));

                    if (response.statusCode != 200) {
                        winston.error('error statusCode != 200');

                    } else {
                        winston.debug('regTenantUserUrl: ' + JSON.stringify(response));
                        resolve(response);
                    }
                })
                .catch(function (error) {
                    winston.error('error Post Tenant User: ' + JSON.stringify(error));

                    if (error.response) {
                        // The request was made and the server responded with a status code
                        // that falls out of the range of 2xx
                        // console.log(error.response.data);
                        // console.log(error.response.status);
                        // console.log(error.response.headers);
                    } else if (error.request) {
                        // The request was made but no response was received
                        // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
                        // http.ClientRequest in node.js
                        //console.log(error.request);
                    } else {
                        // Something happened in setting up the request that triggered an Error
                        //console.log('Error', error.message);
                    }
                    console.log(error.config);

                    reject(error);
                });







        })
    }

    static exists(tenant: Tenant, configuration: SaasConfig, callback) {
        // Create URL for user-manager request
        let userExistsUrl = configuration.url.user + '/pool/' + tenant.userName;

        // see if the user already exists
        request({
            url: userExistsUrl,
            method: "GET",
            json: true,
            headers: { "content-type": "application/json" }
        }, (error, response, body) => {
            winston.info('ERROR EXIST USER' + JSON.stringify(error));
            if (error) callback(false);
            else if ((response != null) && (response.statusCode == 400)) callback(false);
            else {
                if (body.userName === tenant.userName)
                    callback(true);
                else
                    callback(false);
            }
        });
    }

    static saveTenantData(tenant: Tenant, configuration: SaasConfig): Promise<any> {

        return new Promise((resolve, reject) => {
            let tenantURL: string = configuration.url.tenant;
            // init the tenant save request
            let tenantRequestData = {
                "id": tenant.id,
                "companyName": tenant.companyName,
                "accountName": tenant.accountName,
                "ownerName": tenant.ownerName,
                "tier": tenant.tier,
                "email": tenant.email,
                "status": "Active",
                "UserPoolId": tenant.UserPoolId,
                "IdentityPoolId": tenant.IdentityPoolId,
                "systemAdminRole": tenant.systemAdminRole,
                "systemSupportRole": tenant.systemSupportRole,
                "trustRole": tenant.trustRole,
                "systemAdminPolicy": tenant.systemAdminPolicy,
                "systemSupportPolicy": tenant.systemSupportPolicy,
                "userName": tenant.userName,
            };
            winston.info('fire in the hole!! save tenant data...');
            winston.debug('tenant URL: ' + tenantURL);
            winston.debug('request data : ' + JSON.stringify(tenantRequestData));
            // fire request
            request({
                url: tenantURL,
                method: "POST",
                json: true,
                headers: { "content-type": "application/json" },
                body: tenantRequestData
            }, function (error, response, body) {
                winston.info('responding...');

                if (error || (response.statusCode != 200)) {
                    winston.error('error: ' + JSON.stringify(error));
                    reject(error);
                } else {
                    winston.debug('body: ' + JSON.stringify(body));
                    resolve(body);
                }
            });
        });
    }

    static deleteInfra(configuration: SaasConfig, winston): Promise<any> {
        return new Promise((resolve, reject) => {
            let deleteInfraUrl = configuration.url.user + '/tenants';
            // fire request
            request({
                url: deleteInfraUrl,
                method: "DELETE",
                json: true,
            }, (error, response) => {
                winston.debug('response from deleteInfraUrl: ' + JSON.stringify(deleteInfraUrl));
                winston.debug('response: ' + JSON.stringify(response));
                winston.debug('error: ' + JSON.stringify(error))
                if (error || (response.statusCode != 200)) {
                    reject(error);
                    winston.debug('Error Removing Infrastructure');
                } else {
                    resolve(response.statusCode);
                    winston.debug('Removed Infrastructure');
                }
            });
        });
    }
}
