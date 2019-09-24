export default {
  "Config": {
    "dev": {
      "protocol": "http://",
      "domain": "127.0.0.1",
      "region": "",
      "aws_account": "",
      "port": {
        "auth": 3000,
        "user": 3001,
        "tenant": 3003,
        "reg": 3004,
        "sys": 3011
      },
      "role": {
        "sns": ""
      },
      "name": {
        "auth": "Authentication Manager",
        "user": "User Manager",
        "tenant": "Tenant Manager",
        "reg": "Tenant Registration Manager",
        "sys": "System Registration Manager"
      },
      "table": {
        "user": "sls-saas-dev-user",
        "tenant": "sls-saas-dev-tenant"
      },
      "userRole": {
        "systemAdmin": "SystemAdmin",
        "systemUser": "SystemUser",
        "tenantAdmin": "TenantAdmin",
        "tenantUser": "TenantUser"
      },
      "tier": {
        "system": "System Tier"
      },
      "log": {
        "level": "debug"
      }
    },
    "prod": {
      "protocol": "https://",
      "port": {
        "auth": 3000,
        "user": 3001,
        "tenant": 3003,
        "reg": 3004,
        "sys": 3011,
        "product": 3006,
        "order": 3015
      },
      "name": {
        "auth": "Authentication Manager",
        "user": "User Manager",
        "tenant": "Tenant Manager",
        "reg": "Tenant Registration Manager",
        "sys": "System Registration Manager"
      },
      "table": {
        "user": "sls-saas-prod-user",
        "tenant": "sls-saas-prod-tenant"
      },
      "userRole": {
        "systemAdmin": "SystemAdmin",
        "systemUser": "SystemUser",
        "tenantAdmin": "TenantAdmin",
        "tenantUser": "TenantUser"
      },
      "tier": {
        "system": "System Tier"
      },
      "log": {
        "level": "debug"
      }
    }
  }
}
