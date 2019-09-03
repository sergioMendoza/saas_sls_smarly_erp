import { APIGatewayProxyHandler, CustomAuthorizerHandler, CustomAuthorizerEvent, Callback, Context } from 'aws-lambda';
import { decodeToken, ValidateToken } from './authorizer';
import * as request from 'request';
import jwkToPem, { Jwk } from 'jwk-to-pem';


export const hello: APIGatewayProxyHandler = async (event, _context) => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Go Serverless Webpack (Typescript) v1.0! Your function executed successfully!',
      input: event,
    }),
  };
}

export const authorizer: CustomAuthorizerHandler = (event: CustomAuthorizerEvent, context: Context, _callback: Callback) => {
  let token: string = event.authorizationToken;
  if (token) {
    token = token.substring(token.indexOf(' ') + 1);
  }

  console.log('This is my Event');
  console.log(event);
  console.log('This is my headers');
  console.log(event.headers);
  //console.log('this is my body');
  //console.log(event.body);

  let decodedToken: any = decodeToken(event, context);
  if (decodedToken ) {
    console.log('decoded Token');
    console.log(decodedToken);
    console.log('this is my iss');
    let iss: string = decodedToken.payload.iss;
    console.log(iss);

    let n: number = iss.lastIndexOf('/');
    let result: string = iss.substring(n + 1);
    console.log(result);

    //let c1: number = iss.lastIndexOf('_');
    //let cresult: string = iss.substring(c1 - 9);
    //let aws_region: string = cresult.substring(0, cresult.indexOf('_'));

    //let userPoolId: string = result;
    //let region: string = aws_region;

    request({
      url: iss + '/.well-known/jwks.json',
      json: true
    }, (error, response, body) => {
      if(!error && response.statusCode === 200) {
        let pems: {[key: string]: string} = {};
        let keys = body['keys'];
        for (let i = 0; i < keys.length; i++) {
          const key_id: string = keys[i].kid;
          const modulus: string = keys[i].n;
          const exponent: string = keys[i].e;
          const key_type: 'RSA' = keys[i].kty;
          const jwk: Jwk = {kty: key_type, n: modulus,  e:exponent}
          const pem = jwkToPem(jwk);
          pems[key_id] = pem;
        }

        ValidateToken(pems, event, context)
      } else {
        context.fail('error');
      }
    });

  }else {
    console.log('Failed to Decode');
  }
}