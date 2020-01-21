import * as AWS from 'aws-sdk';
import * as configModule from '../config-manager/config';
import * as winston from 'winston';

const configuration = configModule.configure(process.env.NODE_ENV);

winston.configure({
    level: configuration.loglevel,
    transports: [
        new winston.transports.Console({
            level: configuration.loglevel,
            format: winston.format.combine(
                winston.format.colorize({all: true}),
                winston.format.simple()
            )
        })
    ]
});

export default class DynamoDBManager {
    tableDefinition;
    private _tableExists: boolean;

    constructor(tableDefinition, _credentials, _configSettings, _callback?) {
        // winston.debug("Table definition db: " + JSON.stringify(tableDefinition));
        winston.debug("credentials db: " + JSON.stringify(_credentials));
        // winston.debug("config settings db: " + JSON.stringify(_configSettings));
        this.tableDefinition = tableDefinition;
        this._tableExists = true;
    }

    //get tableExists(): boolean {
    //    return this._tableExists;
    //}

    createTable(dynamoDB, callback) {

        let newTable = {
            TableName: this.tableDefinition.TableName,
        };
        dynamoDB.describeTable(newTable, (error, _data) => {
            if (!error) {
                winston.debug("Table already exists: " + this.tableDefinition.TableName);
                callback(null);
            } else {
                dynamoDB.createTable(this.tableDefinition, (err, _data) => {
                    if (err) {
                        winston.error("Unable to create table: " + this.tableDefinition.TableName);
                        callback(err);
                    } else {
                        let tableName = {TableName: this.tableDefinition.TableName};
                        dynamoDB.waitFor('tableExists', tableName, function (err, data) {
                            if (err)
                                callback(err);
                            else {
                                winston.debug("Created table. Table description JSON:", JSON.stringify(data, null, 2));
                                callback(null);
                            }
                        });
                    }
                });
            }
        });
    }

    getDynamoDBDocumentClient(credentials, callback) {
        try {
            let _credentials = {
                accessKeyId: credentials.claim.AccessKeyId,
                secretAccessKey: credentials.claim.SecretKey,
                sessionToken: credentials.claim.SessionToken,
                region: configuration.aws_region
            };
            let docClient = new AWS.DynamoDB.DocumentClient(_credentials);
            let ddb = new AWS.DynamoDB(_credentials);
            if (!this._tableExists) {
                winston.debug("docClient _tableExists: " + JSON.stringify(this._tableExists));
                this.createTable(ddb, (error) => {
                    if (error)
                        callback(error);
                    else {
                        this._tableExists = true;
                        callback(null, docClient)
                    }
                });
            } else
                callback(null, docClient);
        } catch (error) {
            callback(error);
        }
    }

    query(searchParameters, credentials, callback) {
        winston.debug('search Parameters begin:', credentials);
        this.getDynamoDBDocumentClient(credentials, (error, docClient) => {
            let _searchParameters = searchParameters;
            winston.debug('search query:', _searchParameters);
            if (!error) {
                docClient.query(_searchParameters, (err, data) => {
                    if (err) {
                        winston.error('Unable to query. Error:', JSON.stringify(err, null, 2));
                        callback(err);
                    } else {
                        winston.debug('data query:', data);
                        callback(null, data.Items);
                    }
                });
            } else {
                winston.error(error);
                callback(error);
            }
        });
    }

    putItem(item, credentials, callback) {
        this.getDynamoDBDocumentClient(credentials, (_error, docClient) => {
            let itemParams = {
                TableName: this.tableDefinition.TableName,
                Item: item
            };

            docClient.put(itemParams, (err, data) => {
                if (err)
                    callback(err);
                else {
                    callback(null, data);
                }
            });
        });
    }

    updateItem(productUpdateParams, credentials, callback) {
        this.getDynamoDBDocumentClient(credentials, (_error, docClient) => {
            docClient.update(productUpdateParams, (err, data) => {
                if (err)
                    callback(err);
                else
                    callback(null, data.Attributes);
            });
        });
    }

    getItem(keyParams, credentials, callback) {
        this.getDynamoDBDocumentClient(credentials, (_error, docClient) => {
            let fetchParams = {
                TableName: this.tableDefinition.TableName,
                Key: keyParams
            };

            docClient.get(fetchParams, (err, data) => {
                if (err)
                    callback(err);
                else
                    callback(null, data.Item);
            });
        });
    }

    deleteItem(deleteItemParams, credentials, callback) {
        this.getDynamoDBDocumentClient(credentials, (_error, docClient) => {
            docClient.delete(deleteItemParams, (err, data) => {
                if (err)
                    callback(err);
                else
                    callback(null, data);
            });
        });
    }

    scan(scanParams, credentials, callback) {
        winston.info(credentials);
        this.getDynamoDBDocumentClient(credentials, (_error, docClient) => {
            winston.info('scan callback.');
            winston.info(JSON.stringify({error: _error, doc: docClient}));
            docClient.scan(scanParams, (err, data) => {
                winston.info('data :' + JSON.stringify(data));
                if (err)
                    callback(err);
                else
                    callback(null, data.Items);
            });
        });
    }

    batchGetItem(batchGetParams, credentials, callback) {
        this.getDynamoDBDocumentClient(credentials, (_error, docClient) => {
            docClient.batchGet(batchGetParams, (err, data) => {
                if (err)
                    callback(err);
                else
                    callback(null, data);
            });
        });
    }

    tableExists(tableName, credentials, callback) {

        this.getDynamoDBDocumentClient(credentials, (_error, docClient) => {
            let newTable = {
                TableName: tableName,
            };
            docClient.describeTable(newTable, (err, _data) => {
                if (err)
                    callback(err);
                else
                    callback(null, true);
            });
        });
    }

}
