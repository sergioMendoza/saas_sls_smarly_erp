import * as AWS from 'aws-sdk';

import * as configModule from '../config-manager/config';
import colorize from 'format';
const configuration = configModule.configure(process.env.NODE_ENV);

import * as winston from 'winston';

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
})

export default class DynamoDBManager {
    tableDefinition;
    private _tableExists: boolean;
    constructor(tableDefinition, credentials, configSettings, callback) {
        this.tableDefinition;
        this._tableExists = false;
    }
    
    //get tableExists(): boolean {
    //    return this._tableExists;
    //}

    createTable(dynamodb, callback) {

        let newTable = {
            TableName: this.tableDefinition.TableName,
        };
        dynamodb.describeTable(newTable, (error, data) => {
            if (!error) {
                winston.debug("Table already exists: " + this.tableDefinition.TableName);
                callback(null);
            }
            else {
                dynamodb.createTable(this.tableDefinition,  (err, data) => {
                    if (err) {
                        winston.error("Unable to create table: " + this.tableDefinition.TableName);
                        callback(err);
                    } else {
                        let tableName = { TableName: this.tableDefinition.TableName };
                        dynamodb.waitFor('tableExists', tableName, function (err, data) {
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
            let creds = {
                accessKeyId: credentials.claim.AccessKeyId,
                secretAccessKey: credentials.claim.SecretKey,
                sessionToken: credentials.claim.SessionToken,
                region: configuration.aws_region
            }
            let docClient = new AWS.DynamoDB.DocumentClient(creds);
            let ddb = new AWS.DynamoDB(creds)
            if (!this._tableExists) {
                this.createTable(ddb, (error) => {
                    if (error)
                        callback(error);
                    else {
                        this._tableExists = true;
                        callback(null, docClient)
                    }
                });
            }
            else
                callback(docClient);
        }
        catch (error) {
            callback(error);
        }
    }
    query(searchParameters, credentials, callback) {
        this.getDynamoDBDocumentClient(credentials,  (error, docClient) => {
            if (!error) {
                docClient.query(searchParameters, function (err, data) {
                    if (err) {
                        winston.error('Unable to query. Error:', JSON.stringify(err, null, 2));
                        callback(err);
                    } else {
                        callback(null, data.Items);
                    }
                });
            }
            else {
                winston.error(error);
                callback(error);
            }
        });
    }

    putItem(item, credentials, callback) {
        this.getDynamoDBDocumentClient(credentials,  (error, docClient) => {
            let itemParams = {
                TableName: this.tableDefinition.TableName,
                Item: item
            }

            docClient.put(itemParams, function (err, data) {
                if (err)
                    callback(err);
                else {
                    callback(null, data);
                }
            });
        });
    }

    updateItem(productUpdateParams, credentials, callback) {
        this.getDynamoDBDocumentClient(credentials,  (error, docClient) => {
            docClient.update(productUpdateParams, function(err, data) {
                if (err)
                    callback(err);
                else
                    callback(null, data.Attributes);
            });
        });
    }

    getItem(keyParams, credentials, callback) {
        this.getDynamoDBDocumentClient(credentials,  (error, docClient) => {
            let fetchParams = {
                TableName: this.tableDefinition.TableName,
                Key: keyParams
            }
    
            docClient.get(fetchParams, function(err, data) {
                if (err)
                    callback(err);
                else
                    callback(null, data.Item);
            });
        });
    }

    deleteItem(deleteItemParams, credentials, callback) {
        this.getDynamoDBDocumentClient(credentials,  (error, docClient) => {
            docClient.delete(deleteItemParams, function(err, data) {
                if (err)
                    callback(err);
                else
                    callback(null, data);
            });
        });
    }

    scan(scanParams, credentials, callback) {
        this.getDynamoDBDocumentClient(credentials,  (error, docClient) => {
            docClient.scan(scanParams, function(err, data) {
                if (err)
                    callback(err);
                else
                    callback(null, data.Items);
            });
        });
    }

    batchGetItem(batchGetParams, credentials, callback) {
        this.getDynamoDBDocumentClient(credentials,  (error, docClient) => {
            docClient.batchGet(batchGetParams, function(err, data) {
                if (err)
                    callback(err);
                else
                    callback(null, data);
            });
        });
    }
    tableExists(tableName, credentials) {
        let promise = new Promise(function (reject, resolve) {
            this.getDynamoDBDocumentClient(credentials)
                .then(function (dynamodb) {
                    let newTable = {
                        TableName: tableName,
                    };
                    dynamodb.describeTable(newTable, function (error, data) {
                        if (error) {
                            winston.error("Error describing table: ", error)
                        }
                        else {
                            resolve(true);
                        }
                    });
                })
                .catch(function (error) {
                    winston.error("Error describing table: ", error);
                    reject(error);
                });
        });
        return promise;
    }

}
