import { CustomerMessage, CustomerOrderMessage, Message } from './message.js';
import * as https from 'https';

export class HttpClientNode {
  constructor(public url: string, public debug = false) {}

  async sendMessage(message: CustomerMessage): Promise<Message> {
    const encodedMessage = message.encode();
    const requestBuffer = Buffer.from(encodedMessage).toString('base64');

    if (this.debug) {
      console.log('Request Message:\n' + message.toString());
    }

    const requestOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
    };

    return new Promise((resolve, reject) => {
      const req = https.request(this.url, requestOptions, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200) {
            const responseBuffer = Buffer.from(data, 'base64');
            const responseText = responseBuffer.toString('latin1');

            try {
              const customerOrderMessage = message as CustomerOrderMessage;
              const responseMessage = Message.decode(
                responseText,
                customerOrderMessage.supportsPartedResponseSegments
                  ? customerOrderMessage.orderResponseSegId
                  : undefined
              );

              if (this.debug) {
                console.log('Response Message:\n' + responseMessage.toString(true) + '\n');
              }
              resolve(responseMessage);
            } catch (error) {
              console.error('Error decoding response message:', error);
              console.error('Response Message Content:\n', responseText.split("'").join('\n'));
              reject(error);
            }
          } else {
            reject(new Error(`Request failed with status code ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', (error) => {
        console.error('Request error:', error);
        reject(error);
      });

      req.write(requestBuffer);
      req.end();
    });
  }
}
