import * as config from './config/default';
import * as winston from 'winston';

export interface SaasEnvironmentConfig {
    protocol?: string;
    domain?: string;
    region?: string,
    aws_account?: string,
    port: {
        auth: number,
        user: number,
        tenant: number,
        reg: number,
        sys: number
    },
    role?: {
        sns: string
    },
    name: {
        auth: string,
        user: string,
        tenant: string,
        reg: string,
        sys: string,
    },
    table: {
        user: string,
        tenant: string
    },
    userRole: {
        systemAdmin: string,
        systemUser: string,
        tenantAdmin: string,
        tenantUser: string
    },
    tier: {
        system: string
    },
    log: {
        level: string
    }
}

export interface SaasConfig {
    environment: string;
    aws_region: string;
    cognito_region: string;
    aws_account: string;
    domain: string;
    service_url: string;
    name: {
        auth: string,
        user: string,
        tenant: string,
        reg: string,
        sys: string,
    };
    table: {
        user: string,
        tenant: string,
    };
    userRole: {
        systemAdmin: string,
        systemUser: string,
        tenantAdmin: string,
        tenantUser: string
    };
    role: {
        sns: string
    };
    tier: {
        system: string
    };
    port: {
        auth: number,
        user: number,
        tenant: number,
        reg: number,
        sys: number
    };
    loglevel: string;
    url: {
        tenant: string,
        user: string,
        reg: string,
        auth: string,
        sys: string,
    };
}

const prod: SaasEnvironmentConfig = config.default.Config.prod;

const dev: SaasEnvironmentConfig = config.default.Config.dev;

export const configure = (environment: string | null | undefined): SaasConfig => {
    if (environment === null || environment === undefined || environment === 'undefined') {
        environment = process.env.ENV;
        if (process.env.ENV == undefined) {
            environment = 'dev';
        }
    }
    switch (environment) {
        case 'prod':
            if (process.env.REGION == undefined ||
                process.env.SERVICE_URL == undefined ||
                process.env.SNS_ROLE_ARN == undefined ||
                process.env.AWS_ACCOUNT_ID == undefined ||
                process.env.USER_TABLE == undefined ||
                process.env.TENANT_TABLE == undefined) {
                throw `Production Environment Variables Not Properly Configured. \n
                Please ensure REGION, SERVCE_URL, SNS_ROLE_ARN, AWS_ACCOUNT_ID environment Variables are set.`;
            } else {
                winston.debug('Currently Running in', +environment);
                let port = prod.port;
                let name = prod.name;
                //var table = prod.table;
                let conf:  SaasConfig = {
                    environment: environment,
                    //web_client: process.env.WEB_CLIENT,
                    aws_region: process.env.REGION,
                    cognito_region: process.env.REGION,
                    aws_account: process.env.AWS_ACCOUNT_ID,
                    domain: process.env.SERVICE_URL,
                    service_url: prod.protocol + process.env.SERVICE_URL,
                    name: name,
                    table: {
                        user: process.env.USER_TABLE,
                        tenant: process.env.TENANT_TABLE,
                    },
                    userRole: prod.userRole,
                    role: {
                        sns: process.env.SNS_ROLE_ARN
                    },
                    tier: prod.tier,
                    port: port,
                    loglevel: prod.log.level,
                    url: {
                        tenant: prod.protocol + process.env.SERVICE_URL + '/tenant',
                        user: prod.protocol + process.env.SERVICE_URL + '/user',
                        reg: prod.protocol + process.env.SERVICE_URL + '/reg',
                        auth: prod.protocol + process.env.SERVICE_URL + '/auth',
                        sys: prod.protocol + process.env.SERVICE_URL + '/sys'
                    }
                };
                return conf

            }


        case "dev":
            let port = dev.port;
            let name = dev.name;
            let table = dev.table;

            let conf: SaasConfig = {
                environment: environment,
                aws_region: dev.region,
                cognito_region: dev.region,
                aws_account: dev.aws_account,
                domain: dev.domain,
                service_url: dev.protocol + dev.domain,
                name: name,
                table: table,
                userRole: dev.userRole,
                role: dev.role,
                tier: dev.tier,
                port: port,
                loglevel: dev.log.level,
                url: {
                    tenant: dev.protocol + dev.domain + ':' + port.tenant + '/tenant',
                    user: dev.protocol + dev.domain + ':' + port.user + '/user',
                    reg: dev.protocol + dev.domain + ':' + port.reg + '/reg',
                    auth: dev.protocol + dev.domain + ':' + port.auth + '/auth',
                    sys: dev.protocol + dev.domain + ':' + port.sys + '/sys',
                }
            };
            return conf; 

        default:
            throw `No Environment Configured. \n 
            Option 1: Please configure Environment Variable. \n 
            Option 2: Manually override environment in config function.`;
    }
};