export default {
  "Config": {
    "dev": {
      "protocol": "https://",
      "domain": "dev-api.smarlyerp.com",
      "region": "us-east-1",
      "aws_account": "",
      "role": {
        "sns": "arn:aws:iam::369005937507:role/SNSRole"
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
