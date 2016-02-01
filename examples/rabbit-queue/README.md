# RabbitMQ queue example

This example uses RabbitMQ queue as a source for messages. In this case the Node.js app itself does
never cache more than preset amount of messages (for this example the limit is 10 messages) which allows you to send even millions of messages in the fastest way without worrying that your app would run out of memory. You also wouldn't loose messages, if sender crashes then RabbitMQ requeues unacked messages.

## Files

  * [sender.js](sender.js) is the actual example that takes messages from a RabbitMQ queue and delivers these to SMTP
  * [server.js](server.js) is a test SMTP server that accepts messages from [sender.js](sender.js)
  * [pusher.js](pusher.js) generates random messages and pushes these to RabbitMQ queue

> **NB!** The queue created by [sender.js](sender.js) is deleted together with all queued messages once [sender.js](sender.js) exits. If you want this queue to remain, then create it with `autoDelete:false`

## Usage

  1. Edit `queueHost` and `queueName` variables in [pusher.js](pusher.js) and [sender.js](sender.js) to match your actual RabbitMQ Installation
  1. Run [server.js](server.js) in a separate console window to get yourself a SMTP test server
  1. Run [sender.js](sender.js) in a separate console window to set up the queue based sender
  1. Run [pusher.js](pusher.js) in a separate console window to push some messages to RabbitMQ queue

If everything goes like it should then the window for [server.js](server.js) should display something like this:

```
...
Received 439 byte message a449c22bc2adbc1038b80c0eda5e2094 (998)
Received 439 byte message eb728e609f975fd0e6a754437bcda69c (999)
Received 439 byte message a75f2ac5c07589708d7914f49e37b290 (1000)
```
