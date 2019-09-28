import { APIGatewayProxyHandler, Handler } from 'aws-lambda';
import * as uuidV4 from 'uuid/v4';
import * as configModule from '../common/config-manager/config';
import * as winston from 'winston';
// import * as request from 'request';
import { TenantAdminManager, Tenant } from './manager';


const configuration: configModule.SaasConfig = configModule.configure(process.env.ENV);

// const tenantUrl: string = configuration.url.tenant;

// const userUrl: string = configuration.url.user;

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


/**
 * Register a new system admin user
 */
export const regSystemAdmin: Handler = async (event, _context) => {
  winston.debug('event query: ' + JSON.stringify(event));
  //let tenant: Tenant = JSON.parse(event.body);
  let tenant: Tenant = event.body;
  const headers = { "Access-Control-Allow-Origin": "*" };
  // Generate the tenant id for the system user
  tenant.id = 'SYSADMIN' + uuidV4();
  winston.debug('Creating system admin user, tenant id: ' + tenant.id);
  tenant.id = tenant.id.split('-').join('');
  TenantAdminManager.exists(tenant, configuration, (tenantExists) => {
    if (tenantExists) {
      winston.error("Error registering new system admin user");
      return {
        statusCode: 400,
        headers: headers,
        body: JSON.stringify({
          message: { error: "Error registering new system admin user" }
        })
      };
    } else {
      TenantAdminManager.reg(tenant, configuration)
        .then((tenData) => {
          tenant.UserPoolId = tenData.pool.UserPool.Id;
          tenant.IdentityPoolId = tenData.identityPool.IdentityPoolId;

          tenant.systemAdminRole = tenData.role.systemAdminRole;
          tenant.systemSupportRole = tenData.role.systemSupportRole;
          tenant.trustRole = tenData.role.trustRole;

          tenant.systemAdminPolicy = tenData.policy.systemAdminPolicy;
          tenant.systemSupportPolicy = tenData.policy.systemSupportPolicy;

          TenantAdminManager.saveTenantData(tenant, configuration)
        }).then(() => {

          winston.debug("System admin user registered: " + tenant.id);
          return {
            statusCode: 201,
            headers: headers,
            body: JSON.stringify({
              message: { message: "System admin user " + tenant.id + " registered" }
            })
          };
        }).catch((error) => {
          winston.error("Error registering new system admin user: " + error.message);
          return {
            statusCode: 400,
            headers: headers,
            body: JSON.stringify({
              error: "Error registering system admin user: " + error.message
            })
          };
        })
    }
  });
};

/**
 * Delete all system infrastructure and tables.
 */
export const delSystemAdmin: Handler = (_event, _context) => {
  const headers = { "Access-Control-Allow-Origin": "*" };
  TenantAdminManager.deleteInfra(configuration, winston)
  .then( () => {
      winston.debug("Delete Infra");
      //CloudFormation will remove the tables. This can be uncommented if required.
      //deleteTables()
  })
  .then( () => {
      winston.debug("System Infrastructure & Tables removed");
     
      return {
        statusCode: 200,
        headers: headers,
        body: JSON.stringify({
          message: "System Infrastructure & Tables removed"
        })
      };
  })
  .catch((_error) => {
      winston.error("Error removing system");
      return {
        statusCode: 400,
        headers: headers,
        body: JSON.stringify({
          error: " Error removing system"
        })
      };
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
