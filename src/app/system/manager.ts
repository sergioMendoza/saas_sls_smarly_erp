import * as request from 'request';
import { SaasConfig } from '../common/config-manager/config';

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
};

export interface Tenant {
    id?: string,
    companyName: string,
    accountName: string,
    ownerName: string,
    tier: string,
    email: string,
    status: string,
    UserPoolId: string,
    IdentityPoolId: string,
    systemAdminRole: string,
    systemSupportRole: string,
    trustRole: string,
    systemAdminPolicy: string,
    systemSupportPolicy: string,
    userName: string,
    role: string,
    firstName: string,
    lastName: string
};

export class TenantAdminManager {
    regTenantUserUrl: string;


    static async reg(tenant: Tenant, configuration: SaasConfig): Promise<any> {
        let tenantAdmin: TenantAdmin = {
            "tenant_id": tenant.id,
            "companyName": tenant.companyName,
            "accountName": tenant.accountName,
            "ownerName": tenant.ownerName,
            "tier": tenant.tier,
            "email": tenant.email,
            "userName": tenant.userName,
            "role": tenant.role,
            "firstName": tenant.firstName,
            "lastName": tenant.lastName
        };
        let promise = new Promise((resolve, reject) => {

            // User service REST API URL
            let regTenantUserUrl = configuration.url.user + '/system';

            // FIRE IN THE HOLE!!!
            request({
                url: regTenantUserUrl,
                method: "POST",
                json: true,
                headers: { "content-type": "application/json" },
                body: tenantAdmin
            }, (error, response, body) => {
                if (error || (response.statusCode != 200))
                    reject(error)
                else
                    resolve(body)
            });
        });
        return promise
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

    static async saveTenantData(tenant: Tenant, configuration: SaasConfig): Promise<any> {
        let tenantURL: string = configuration.url.tenant;
        let promise = new Promise(function (resolve, reject) {
            // init the tenant sace request

            var tenantRequestData = {
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

            // fire request
            request({
                url: tenantURL,
                method: "POST",
                json: true,
                headers: { "content-type": "application/json" },
                body: tenantRequestData
            }, function (error, response, body) {
                if (error || (response.statusCode != 200))
                    reject(error);
                else
                    resolve(body);
            });
        });

        return promise;
    }

    static async deleteInfra(configuration: SaasConfig, winston):Promise<any> {

        var promise = new Promise(function (resolve, reject) {

            var deleteInfraUrl = configuration.url.user + '/tenants';

            // fire request
            request({
                url: deleteInfraUrl,
                method: "DELETE",
                json: true,
            }, function (error, response) {
                if (error || (response.statusCode != 200)) {
                    reject(error);
                    winston.debug('Error Removing Infrastructure');
                }
                else {
                    resolve(response.statusCode);
                    winston.debug('Removed Infrastructure');
                }
            });
        });

        return promise;
    }

}