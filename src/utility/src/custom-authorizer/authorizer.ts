import * as jwt from 'jsonwebtoken';
import {AuthResponse, Context, CustomAuthorizerEvent, PolicyDocument, Statement} from 'aws-lambda';


export const decodeToken = (event: CustomAuthorizerEvent, context: Context): string | object | null => {
    let token = event.authorizationToken;
    if (token) {
        token = token.substring(token.indexOf(' ') + 1);
    }
    let decodedJwt: any = jwt.decode(token, {complete: true});
    if (!decodedJwt) {
        console.log('Not a valid JWT token');
        context.fail('Not a JWT Token');
        return;
    } else {
        return decodedJwt;
    }
};

class AuthPolicy {
    awsAccountId: string;
    principalId: string;
    version: string;
    pathRegex: RegExp;
    allowMethods: any[];
    denyMethods: any[];
    restApiId: string;
    stage: string;
    region: string;

    static readonly HttpVerb: { [key: string]: string } = {
        GET: 'GET',
        POST: 'POST',
        PUT: 'PUT',
        PATCH: 'PATh',
        HEAD: 'HEAD',
        DELETE: 'DELETE',
        OPTIONS: 'OPTIONS',
        ALL: '*',

    };

    constructor(principal: string, awsAccountId, apiOptions: ApiOptions) {

        this.principalId = principal;
        this.awsAccountId = awsAccountId;
        this.allowMethods = [];
        this.denyMethods = [];
        this.version = '2012-10-17';
        this.pathRegex = new RegExp('^[/.a-zA-Z0-9-\*]+$');
        if (!apiOptions || !apiOptions.restApiId) {
            this.restApiId = "*";
        } else {
            this.restApiId = apiOptions.restApiId;
        }
        if (!apiOptions || !apiOptions.region) {
            this.region = "*";
        } else {
            this.region = apiOptions.region;
        }
        if (!apiOptions || !apiOptions.stage) {
            this.stage = "*";
        } else {
            this.stage = apiOptions.stage;
        }
    }

    addMethod(effect, verb, resource, conditions) {

        if (verb != "*" && !AuthPolicy.HttpVerb.hasOwnProperty(verb)) {
            throw new Error("Invalid HTTP verb " + verb + ". Allowed verbs in AuthPolicy.HttpVerb");
        }

        if (!this.pathRegex.test(resource)) {
            throw new Error("Invalid resource path: " + resource + ". Path should match " + this.pathRegex);
        }

        let cleanedResource = resource;
        if (resource.substring(0, 1) == "/") {
            cleanedResource = resource.substring(1, resource.length);
        }
        let resourceArn = "arn:aws:execute-api:" +
            this.region + ":" +
            this.awsAccountId + ":" +
            this.restApiId + "/" +
            this.stage + "/" +
            verb + "/" +
            cleanedResource;

        if (effect.toLowerCase() == "allow") {
            this.allowMethods.push({
                resourceArn: resourceArn,
                conditions: conditions
            });
        } else if (effect.toLowerCase() == "deny") {
            this.denyMethods.push({
                resourceArn: resourceArn,
                conditions: conditions
            })
        }
    }

    static getEmptyStatement(effect: string): Statement {
        effect = effect.substring(0, 1).toUpperCase() + effect.substring(1, effect.length).toLowerCase();
        return {
            Action: 'execute-api:Invoke',
            Effect: effect,
            Resource: ['invoke']
        };
    }

    getStatementsForEffect(effect, methods): Statement[] {
        let statements: Statement[] = [];

        if (methods.length > 0) {
            let statement: any = AuthPolicy.getEmptyStatement(effect);

            for (let i = 0; i < methods.length; i++) {
                let curMethod = methods[i];
                if (curMethod.conditions === null || curMethod.conditions.length === 0) {

                    statement.Resource.push(curMethod.resourceArn);

                } else {
                    let conditionalStatement: any = AuthPolicy.getEmptyStatement(effect);
                    conditionalStatement.Resource.push(curMethod.resourceArn);
                    conditionalStatement.Condition = curMethod.conditions;
                    statements.push(conditionalStatement);
                }
            }

            if (statement.Resource !== null && statement.Resource.length > 0) {
                statements.push(statement);
            }
        }

        return statements;
    };

    allowAllMethods() {
        this.addMethod("allow", "*", "*", null);
    }

    denyAllMethods() {
        this.addMethod("deny", "*", "*", null);
    }

    allowMethod(verb, resource) {
        this.addMethod("allow", verb, resource, null);
    }

    denyMethod(verb, resource) {
        this.addMethod("deny", verb, resource, null);
    }

    allowMethodWithConditions(verb, resource, conditions) {
        this.addMethod("allow", verb, resource, conditions);
    }

    denyMethodWithConditions(verb, resource, conditions) {
        this.addMethod("deny", verb, resource, conditions);
    }

    build(): AuthResponse {
        if ((!this.allowMethods || this.allowMethods.length === 0) &&
            (!this.denyMethods || this.denyMethods.length === 0)) {
            throw new Error("No statements defined for the policy");
        }
        let doc: PolicyDocument = {
            Version: this.version,
            Statement: [],
        };
        doc.Statement.concat(this.getStatementsForEffect("Allow", this.allowMethods));
        doc.Statement.concat(this.getStatementsForEffect("Deny", this.allowMethods));

        // authPolicy
        return {
            principalId: this.principalId,
            policyDocument: doc
        };
    }
}


interface ApiOptions {
    region: string,
    restApiId: string,
    stage: string
}

export const ValidateToken = (pems: { [key: string]: string }, event: CustomAuthorizerEvent, context: Context) => {

    let token = event.authorizationToken;
    if (token) {
        token = token.substring(token.indexOf(' ') + 1);
    }

    let decodedJwt: any = jwt.decode(token, {complete: true});
    let iss: string = decodedJwt.payload.iss;

    let n: number = iss.lastIndexOf('/');
    let resultUserPoolId: string = iss.substring(n + 1);
    console.log(iss);
    if (!decodedJwt) {
        console.log('Not a valid JWT token');
        context.fail('Not a valid JWT Token');
        return;
    }


    //Fail if token is not from your UserPool
    if (decodedJwt.payload.iss != iss) {
        console.log("invalid issuer");
        context.fail("invalid issuer");
        return;
    }

    //Reject the jwt if it's not an 'Access Token'
    if (decodedJwt.payload.token_use != 'id') {
        console.log("Not an access token");
        context.fail("Not an access token");
        return;
    }

    //Get the kid from the token and retrieve corresponding PEM
    let kid: string = decodedJwt.header.kid;
    let pem: string = pems[kid];
    if (!pem) {
        console.log('Invalid access token');
        context.fail("Invalid access token");
        return;
    }
    jwt.verify(token, pem, {issuer: iss}, (err, payload) => {
        if (err) {
            context.fail('cannot verify signature');
        } else {
            let principalId: string = payload.sub;
            let tmp: string[] = event.methodArn.split(':');
            let apiGatewayArnTmp: string[] = tmp[5].split('/');
            let awsAccountId: string = tmp[4];
            let apiOptions: ApiOptions = {
                region: tmp[3],
                restApiId: apiGatewayArnTmp[0],
                stage: apiGatewayArnTmp[1]
            };
            /*
            let method: string = apiGatewayArnTmp[2];
            let resource = '/';
            if (apiGatewayArnTmp[3]) {
                resource += apiGatewayArnTmp[3];
            }
            */
            let authPolicy = new AuthPolicy(principalId, awsAccountId, apiOptions);

            const authResponse: AuthResponse = authPolicy.build();

            authResponse.context = {
                tenant_id: decodedJwt.payload['custom:tenant_id'],
                sub: decodedJwt.payload['sub'],
                username: decodedJwt.payload['cognito:username'],
                given_name: decodedJwt.payload['given_name'],
                family_name: decodedJwt.payload['family_name'],
                role: decodedJwt.payload['custom:role'],
                userPoolId: resultUserPoolId
            };

            context.succeed(authResponse)

        }
    });


};