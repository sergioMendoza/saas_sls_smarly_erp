import { APIGatewayProxyHandler } from 'aws-lambda';
// import * as bodyParser from 'body-parser';
// import * as uuidV4 from 'uuid/v4';
// import * as configModule from '../common/config-manager/config';

export const hello: APIGatewayProxyHandler = async (event, _context) => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Go Serverless Webpack (Typescript) v1.0! Your function executed successfully!',
      input: event,
    }),
  };
}
