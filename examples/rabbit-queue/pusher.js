/* eslint no-console: 0 */

'use strict';

// This script pushes randomly generated messages to RabbitMQ for sending
// Run it to fill outgoing queue with pending messages for the sender.js to handle

var amqp = require('amqp');

var queueHost = 'amqp://test:test@192.168.56.52';
var queueName = 'outgoing';

var totalMessages = 1000;

// Create connection to RabbitMQ
var queueConnection = amqp.createConnection({
    url: queueHost
});

queueConnection.on('ready', function () {
    for (var i = 0; i < totalMessages; i++) {
        var message = {
            to: 'Receiver Name <receiver@example.com>',
            subject: 'Test message #' + i,
            text: 'Current date: ' + Date()
        };

        queueConnection.publish(queueName, message, {
            contentType: 'application/json'
        });
    }

    console.log('Pushed %s messages to queue', totalMessages);
});
