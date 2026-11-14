import { type CustomerMessage, type CustomerOrderMessage, Message } from './message.js';

export class HttpClient {
	/**
	 * How long to wait for the bank's answer to one message, in milliseconds. Unset (the
	 * default) waits as long as the connection lasts; set it so that a bank that doesn't
	 * answer can't keep a dialog (and the caller) waiting forever.
	 */
	static timeoutMs: number | undefined = undefined;

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
				console.log(encodedMessage.split("'").join('\n'));
			} else {
				console.log(message.toString());
			}
		}

		const response = await fetch(this.url, {
			method: 'POST',
			headers: { 'Content-Type': 'text/plain' },
			body: requestBuffer.toString('base64'),
			signal:
				HttpClient.timeoutMs === undefined ? undefined : AbortSignal.timeout(HttpClient.timeoutMs),
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
			throw Error(`Request failed with status code ${response.status}: ${await response.text()}`);
		}
	}
}
