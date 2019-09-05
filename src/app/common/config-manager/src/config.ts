import * as config from 'config';

export interface SaasEnvironmentConfig {
    protocol: string;
    domain: string;
    region: string,
    aws_account: string,
    port: {
        auth: number,
        user: number,
        tenant: number,
        reg: number,
        sys: number
    },
    role: {
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


const prod: SaasEnvironmentConfig = config.get('Config.prod');


const dev: SaasEnvironmentConfig = config.get('Config.dev');

interface SaasConfig {
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

import * as winston from 'winston';

export const configure = (environment): SaasConfig => {
    if (environment == null || environment == undefined || environment == 'undefined') {
        let enviroment: string = process.env.NODE_ENV;
        if (process.env.NODE_ENV == undefined) {
            enviroment = 'development';
        }
    }
    switch (environment) {
        case 'production':
            if (process.env.AWS_REGION == undefined ||
                process.env.SERVICE_URL == undefined ||
                process.env.SNS_ROLE_ARN == undefined ||
                process.env.AWS_ACCOUNT_ID == undefined ||
                process.env.USER_TABLE == undefined ||
                process.env.TENANT_TABLE == undefined ||
                process.env.PRODUCT_TABLE == undefined ||
                process.env.ORDER_TABLE == undefined) {
                let error: string = `Production Environment Variables Not Properly Configured. \n
                Please ensure AWS_REGION, SERVCE_URL, SNS_ROLE_ARN, AWS_ACCOUNT_ID environment Variables are set.`
                throw error;
                break;
            } else {
                winston.debug('Currently Running in', + environment);
                let port = prod.port;
                let name = prod.name;
                //var table = prod.table;
                let config: SaasConfig = {
                    environment: environment,
                    //web_client: process.env.WEB_CLIENT,
                    aws_region: process.env.AWS_REGION,
                    cognito_region: process.env.AWS_REGION,
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
                }
                return config;
                break;
            }


        case "development":
            let port = dev.port;
            let name = dev.name;
            let table = dev.table;

            let config: SaasConfig = {
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
            }

            return config;
            break;

        default:
            let error = `No Environment Configured. \n 
            Option 1: Please configure Environment Variable. \n 
            Option 2: Manually override environment in config function.`;
            throw error;
    }
}