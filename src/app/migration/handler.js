'use strict';
const {cmdMigrate} = require('./migrate');

module.exports.executeMigration = event => {
    cmdMigrate()
        .then((result) => {
            console.log(result);

            return {
                statusCode: 200,
                body: JSON.stringify(
                    {
                        message: 'Go Serverless v1.0! Your function executed successfully!',
                        input: event,
                    },
                    null,
                    2
                ),
            };

        })
        .catch(err => {
            console.log(err);
        });
    // Use this code if you don't use the http event with the LAMBDA-PROXY integration
    // return { message: 'Go Serverless v1.0! Your function executed successfully!', event };
};
