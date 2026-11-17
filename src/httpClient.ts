import { type CustomerMessage, type CustomerOrderMessage, Message } from './message.js';

export class HttpClient {
	constructor(
		public url: string,
		public debug = false,
		public debugRaw = false,
	) {}

	async sendMessage(message: CustomerMessage): Promise<Message> {
		const encodedMessage = message.encode();
		const requestBuffer = Buffer.from(encodedMessage, 'latin1');

		if (this.debug) {
			console.log('Request Message:\n');

			if (this.debugRaw) {
				console.log(redactSignature(encodedMessage).split("'").join('\n'));
			} else {
				console.log(message.toString());
			}
		}

		const response = await fetch(this.url, {
			method: 'POST',
			headers: { 'Content-Type': 'text/plain' },
			body: requestBuffer.toString('base64'),
		});

		if (response.ok) {
			const responseBuffer = Buffer.from(await response.text(), 'base64');
			const responseText = responseBuffer.toString('latin1');

			try {
				const customerOrderMessage = message as CustomerOrderMessage;
				const responseMessage = Message.decode(
					responseText,
					customerOrderMessage.supportsPartedResponseSegments
						? customerOrderMessage.orderResponseSegId
						: undefined,
				);
				if (this.debug) {
					console.log('Response Message:\n');

					if (this.debugRaw) {
						console.log(responseText.split("'").join('\n'));
					} else {
						console.log(`Response Message:\n${responseMessage.toString(true)}\n`);
					}
				}
				return responseMessage;
			} catch (error) {
				console.error('Error decoding response message:', error);
				console.error('Response Message Content:\n', responseText.split("'").join('\n'));
				throw error;
			}
		} else {
			// The body is left out of the error: errors end up in application logs, and
			// a bank's error page may echo parts of the request, which carries the PIN.
			const body = await response.text();
			if (this.debug) {
				console.log(`Error response:\n${body}`);
			}
			throw Error(`Request failed with status code ${response.status}`);
		}
	}
}

/**
 * Replace the signature end segment (HNSHA), which carries the PIN and TAN, in an encoded
 * message. A segment ends at the first `'` that is not escaped with `?`.
 */
export function redactSignature(encodedMessage: string): string {
	return encodedMessage.replace(/HNSHA:(?:\?.|[^'?])*'/g, "HNSHA:***'");
}
